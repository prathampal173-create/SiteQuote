import type { Database } from '../../lib/database.types';

export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectStatus = Database['public']['Enums']['project_status'];
export type ProjectFilter = 'all' | ProjectStatus;
export type ProjectDraft = { title: string; siteAddress: string; notes: string };
export type ProjectWithLead = { project: Project; leadName: string };

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['draft', 'quote_sent', 'won', 'lost'];
export const PROJECT_FILTERS: readonly ProjectFilter[] = ['all', ...PROJECT_STATUSES];
export const PROJECT_LABELS: Record<ProjectStatus, string> = {
  draft: 'Draft', quote_sent: 'Quote Sent', won: 'Won', lost: 'Lost'
};
export const EMPTY_PROJECT: ProjectDraft = { title: '', siteAddress: '', notes: '' };

export function draftFromProject(project: Project): ProjectDraft {
  return { title: project.title, siteAddress: project.site_address ?? '', notes: project.notes ?? '' };
}

export function validateProject(draft: ProjectDraft):
  | { ok: true; values: { title: string; site_address: string | null; notes: string | null } }
  | { ok: false; errors: { title: string } } {
  const title = draft.title.trim();
  if (!title) return { ok: false, errors: { title: 'Project name is required.' } };
  return { ok: true, values: { title, site_address: draft.siteAddress.trim() || null,
    notes: draft.notes.trim() || null } };
}

export function filterProjects(rows: readonly ProjectWithLead[], filter: ProjectFilter): ProjectWithLead[] {
  return rows.filter(({ project }) => filter === 'all' || project.status === filter);
}

/** A lead qualifies if any owned child project is CURRENTLY Quote Sent. Not a history check. */
export function quoteSentLeadIds(projects: readonly Pick<Project, 'lead_id' | 'status'>[]): Set<string> {
  return new Set(projects.filter((project) => project.status === 'quote_sent').map((project) => project.lead_id));
}
