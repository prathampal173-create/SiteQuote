import { getSupabaseClient, isCurrentSupabaseClient, type SiteQuoteClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';
import { validateProject, type Project, type ProjectDraft, type ProjectWithLead } from './projectModel';

export class ProjectFailure extends Error {
  constructor(public readonly reason: 'configuration' | 'session' | 'request' | 'not_found' | 'invalid') {
    super(reason);
    this.name = 'ProjectFailure';
  }
}

export function projectFailureMessage(error: unknown): string {
  if (error instanceof ProjectFailure) {
    if (error.reason === 'configuration') return 'Supabase is not configured. Add the public backend settings.';
    if (error.reason === 'session') return 'Your verified session is unavailable. Sign in again.';
    if (error.reason === 'not_found') return 'Project or associated lead unavailable. Refresh and retry.';
    if (error.reason === 'invalid') return 'Enter valid project details and retry.';
  }
  return 'Could not reach your projects. Check your connection and retry.';
}

type Authorized = { client: SiteQuoteClient; token: string };
async function authorized(accountId: string): Promise<Authorized> {
  const client = getSupabaseClient();
  if (!client) throw new ProjectFailure('configuration');
  try {
    const session = await validateServerSession(client);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(client)) throw new ProjectFailure('session');
    return { client, token: session.accessToken };
  } catch { throw new ProjectFailure('session'); }
}
async function checkCurrent(auth: Authorized, accountId: string): Promise<void> {
  if (!isCurrentSupabaseClient(auth.client)) throw new ProjectFailure('session');
  try {
    const session = await validateServerSession(auth.client, undefined, auth.token);
    if (!session || session.userId !== accountId || !isCurrentSupabaseClient(auth.client)) throw new ProjectFailure('session');
  } catch { throw new ProjectFailure('session'); }
}
export async function projectRequest<T>(accountId: string, work: (client: SiteQuoteClient) => Promise<T>): Promise<T> {
  const auth = await authorized(accountId);
  try {
    const result = await work(auth.client);
    await checkCurrent(auth, accountId);
    return result;
  } catch (error) {
    if (error instanceof ProjectFailure) throw error;
    throw new ProjectFailure('request');
  }
}

const request = projectRequest;

const COLUMNS = 'id,user_id,lead_id,title,site_address,notes,status,accepted_quote_id,tax_bps,created_at,updated_at';
const PAGE_SIZE = 200;

async function fetchProjects(client: SiteQuoteClient, accountId: string, leadId?: string): Promise<Project[]> {
  const all: Project[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    let query = client.from('projects').select(COLUMNS).eq('user_id', accountId);
    if (leadId) query = query.eq('lead_id', leadId);
    const { data, error } = await query.order('created_at', { ascending: false })
      .order('id', { ascending: false }).range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Project[];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

export function listLeadProjects(accountId: string, leadId: string): Promise<Project[]> {
  return request(accountId, (client) => fetchProjects(client, accountId, leadId));
}

/** Project list joins owned lead names without exposing unrelated lead columns. */
export function listProjects(accountId: string): Promise<ProjectWithLead[]> {
  return request(accountId, async (client) => {
    const projects = await fetchProjects(client, accountId);
    if (!projects.length) return [];
    const names = new Map<string, string>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.from('leads').select('id,customer_name')
        .eq('user_id', accountId).order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = data ?? [];
      page.forEach((lead) => names.set(lead.id, lead.customer_name));
      if (page.length < PAGE_SIZE) break;
    }
    return projects.filter((project) => names.has(project.lead_id))
      .map((project) => ({ project, leadName: names.get(project.lead_id)! }));
  });
}

/** Status is server-protected: no status update is exposed by this client API. */
export function loadProject(accountId: string, projectId: string): Promise<Project> {
  return request(accountId, async (client) => {
    const { data, error } = await client.from('projects').select(COLUMNS)
      .eq('user_id', accountId).eq('id', projectId).maybeSingle();
    if (error) throw error;
    if (!data) throw new ProjectFailure('not_found');
    return data as Project;
  });
}

export async function createProject(accountId: string, leadId: string, draft: ProjectDraft): Promise<Project> {
  const checked = validateProject(draft);
  if (!checked.ok || !leadId) throw new ProjectFailure('invalid');
  return request(accountId, async (client) => {
    const ownerLead = await client.from('leads').select('id').eq('user_id', accountId)
      .eq('id', leadId).maybeSingle();
    if (ownerLead.error) throw ownerLead.error;
    if (!ownerLead.data) throw new ProjectFailure('not_found');
    const { data, error } = await client.from('projects').insert({ user_id: accountId, lead_id: leadId,
      ...checked.values }).select(COLUMNS).single();
    if (error || !data) throw error ?? new Error('Missing created project');
    return data as Project;
  });
}

export async function updateProject(accountId: string, projectId: string, draft: ProjectDraft): Promise<Project> {
  const checked = validateProject(draft);
  if (!checked.ok) throw new ProjectFailure('invalid');
  return request(accountId, async (client) => {
    // Read server state to honor the closed-project editing restriction. Server trigger independently enforces it.
    const { data: existing, error: loadError } = await client.from('projects').select(COLUMNS)
      .eq('user_id', accountId).eq('id', projectId).maybeSingle();
    if (loadError) throw loadError;
    if (!existing) throw new ProjectFailure('not_found');
    const closed = existing.status === 'won' || existing.status === 'lost';
    const values = closed ? { notes: checked.values.notes } : checked.values;
    const { data, error } = await client.from('projects').update(values)
      .eq('user_id', accountId).eq('id', projectId).select(COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new ProjectFailure('not_found');
    return data as Project;
  });
}
