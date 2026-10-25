/** Quote-follow-up UX only. Never inserts reminders or changes quote status. */
export const FOLLOWUP_TITLE = 'Follow up on sent quote';
export type FollowupPrefill = {
  sourceOwnerId: string; sourceQuoteId: string; leadId: string; projectId: string; sentAt: string;
};
/** Three local calendar days (not a fixed 72 hours). Preserve wall time across DST.
 * Nonexistent local wall times move to the first valid minute, visibly disclosed.
 * JS Date chooses the first occurrence for ambiguous fallback wall times.
 */
export function suggestFollowup(sentAt: string, now = new Date()): { due: Date; adjusted: boolean; ambiguous: boolean } {
  const sent = new Date(sentAt);
  if (!Number.isFinite(sent.getTime())) throw new Error('Sent timestamp unavailable. Select a date manually.');
  const y = sent.getFullYear(), m = sent.getMonth(), d = sent.getDate() + 3;
  const h = sent.getHours(), min = sent.getMinutes();
  const targetDay = new Date(y, m, d, 12, 0, 0, 0);
  if (!Number.isFinite(targetDay.getTime())) throw new Error('Invalid follow-up date.');
  for (let minutes = 0; minutes <= 180; minutes++) {
    const due = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), h, min + minutes, 0, 0);
    if (due.getDate() === targetDay.getDate() && due.getHours() === Math.floor((h * 60 + min + minutes) / 60) % 24 &&
      due.getMinutes() === (min + minutes) % 60 && due.getTime() > now.getTime())
      return { due, adjusted: minutes > 0, ambiguous: [15, 30, 60, 90, 120, 180].some((delta) => {
        const later = new Date(due.getTime() + delta * 60_000);
        return later.getFullYear() === due.getFullYear() && later.getMonth() === due.getMonth() &&
          later.getDate() === due.getDate() && later.getHours() === due.getHours() &&
          later.getMinutes() === due.getMinutes() && later.getTimezoneOffset() !== due.getTimezoneOffset();
      }) }; 
  }
  // An old delayed suggestion is not silently reused or submitted in the past.
  throw new Error('Suggested time has passed. Choose a new future date.');
}
export function validPrefill(p: FollowupPrefill, currentOwnerId: string): boolean {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  return p.sourceOwnerId === currentOwnerId && [p.sourceOwnerId, p.sourceQuoteId, p.leadId, p.projectId].every((id) => uuid.test(id)) &&
    Number.isFinite(Date.parse(p.sentAt));
}
