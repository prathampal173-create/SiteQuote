import { STAGE_LABELS, type Activity, type ContactStage } from './leadModel';

/** Display database-created activity only; never infer a transition from local UI state. */
export function formatSiteVisitStageActivity(activity: Pick<Activity, 'type' | 'detail'>): string | null {
  if (activity.type !== 'site_visit_stage_advanced') return null;
  const d = activity.detail;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'Site visit completion advanced the contact stage.';
  const from = 'from_stage' in d ? d.from_stage : null;
  const to = 'to_stage' in d ? d.to_stage : null;
  if ((from !== 'new' && from !== 'contacted') || to !== 'site_visit_completed')
    return 'Site visit completion advanced the contact stage.';
  return `${STAGE_LABELS[from as ContactStage]} → ${STAGE_LABELS.site_visit_completed} — automatically updated after completing a Site visit reminder.`;
}
