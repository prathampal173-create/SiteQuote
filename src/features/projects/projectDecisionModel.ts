import type { Project, ProjectStatus } from './projectModel';

export type Decision = 'mark_lost' | 'reopen';

/** Status belongs to one project, never to its parent lead or sibling projects. */
export function permittedDecision(status: ProjectStatus): Decision | null {
  if (status === 'draft' || status === 'quote_sent') return 'mark_lost';
  if (status === 'won' || status === 'lost') return 'reopen';
  return null;
}

/** Sent quote versions are a Phase 3 dependency; no placeholder selection is valid. */
export function canMarkWon(project: Project, sentCount = 0): boolean {
  return project.status === 'quote_sent' && !project.accepted_quote_id && sentCount > 0;
}

export type DecisionHistory = {
  type: string;
  detail: unknown;
};

export function formatDecisionHistory(entry: DecisionHistory): string | null {
  if (!['project_marked_lost','project_reopened','project_marked_won','quote_marked_sent'].includes(entry.type)) return null;
  const detail = entry.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return 'Project decision recorded.';
  const info = detail as Record<string, unknown>;
  const project = typeof info.project_title === 'string' ? info.project_title : 'Project';
  const from = typeof info.from_status === 'string' ? info.from_status.replace(/_/g, ' ') : '?';
  const to = typeof info.to_status === 'string' ? info.to_status.replace(/_/g, ' ') : '?';
  const won = entry.type === 'project_marked_won' && typeof info.accepted_quote_version === 'number'
    ? ` Accepted v${info.accepted_quote_version} (${String(info.accepted_quote_id ?? '')}).` : '';
  const sent = entry.type === 'quote_marked_sent' && typeof info.version === 'number'
    ? ` Sent v${info.version}.` : '';
  const approval = typeof info.previous_accepted_quote_id === 'string'
    ? ` Prior approved version ID retained: ${info.previous_accepted_quote_id}.` : '';
  return `${project}: ${from} → ${to}.${won}${sent}${approval}`;
}
