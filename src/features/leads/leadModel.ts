import type { Database } from '../../lib/database.types';

export type Lead = Database['public']['Tables']['leads']['Row'];
export type Activity = Database['public']['Tables']['activities']['Row'];
export type LeadSource = Database['public']['Enums']['lead_source'];
export type ContactStage = Database['public']['Enums']['lead_contact_stage'];
export type StageFilter = ContactStage | 'all';
export type LeadFilter = StageFilter | 'quote_sent';
export type LeadDraft = { customerName: string; phone: string; email: string; source: LeadSource; notes: string; contactStage: ContactStage };

export const SOURCES: readonly LeadSource[] = ['Referral', 'Google', 'Phone', 'Email', 'Other'];
export const STAGES: readonly ContactStage[] = ['new', 'contacted', 'site_visit_completed'];
export const STAGE_LABELS: Record<ContactStage, string> = {
  new: 'New', contacted: 'Contacted', site_visit_completed: 'Site Visit Completed'
};
export const EMPTY_LEAD: LeadDraft = { customerName: '', phone: '', email: '', source: 'Referral', notes: '', contactStage: 'new' };

export function draftFromLead(lead: Lead): LeadDraft {
  return { customerName: lead.customer_name, phone: lead.phone ?? '', email: lead.email ?? '',
    source: lead.source, notes: lead.notes ?? '', contactStage: lead.contact_stage };
}

export function validateLead(input: LeadDraft):
  | { ok: true; values: Pick<Lead, 'customer_name' | 'phone' | 'email' | 'source' | 'notes' | 'contact_stage'> }
  | { ok: false; errors: { customerName?: string; contact?: string; source?: string; contactStage?: string } } {
  const customer_name = input.customerName.trim();
  const phone = input.phone.trim() || null;
  const email = input.email.trim() || null;
  const errors: { customerName?: string; contact?: string; source?: string; contactStage?: string } = {};
  if (!customer_name) errors.customerName = 'Customer name is required.';
  if (!phone && !email) errors.contact = 'Enter at least a phone number or email address.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.contact = 'Enter a valid email address.';
  if (!SOURCES.includes(input.source)) errors.source = 'Choose a valid source.';
  if (!STAGES.includes(input.contactStage)) errors.contactStage = 'Choose a valid contact stage.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { customer_name, phone, email, source: input.source, notes: input.notes.trim() || null, contact_stage: input.contactStage } };
}

export function filterLeads(leads: readonly Lead[], nameQuery: string, stage: LeadFilter, quoteSentIds: ReadonlySet<string> = new Set()): Lead[] {
  const query = nameQuery.trim().toLocaleLowerCase();
  return leads.filter((lead) => (stage === 'all' || (stage === 'quote_sent' ? quoteSentIds.has(lead.id) : lead.contact_stage === stage))
    && lead.customer_name.toLocaleLowerCase().includes(query));
}

/** Stable chronological order even when several entries share a timestamp. */
export function chronologicalHistory(rows: readonly Activity[]): Activity[] {
  return [...rows].sort((a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || a.id.localeCompare(b.id));
}
