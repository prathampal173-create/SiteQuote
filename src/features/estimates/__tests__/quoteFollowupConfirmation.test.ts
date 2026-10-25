import { confirmQuoteSentForFollowup } from '../preparedQuotesApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn(), isCurrentSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));
jest.mock('../preparedQuotes', () => ({
  parsePreparedQuote: (row: { id: string; status: string; user_id: string; project_id: string }, owner: string, project: string) => {
    if (row.user_id !== owner || row.project_id !== project) throw new Error('Unauthorized quote');
    return row;
  }
}));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', project = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quote = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const row = { id: quote, user_id: owner, project_id: project, status: 'sent' };
let transitioned = true;
const client = { rpc: jest.fn(async () => ({ data: { transitioned, quote: row }, error: null })) };
beforeEach(() => {
  jest.clearAllMocks(); transitioned = true;
  (getSupabaseClient as jest.Mock).mockReturnValue(client);
  (isCurrentSupabaseClient as jest.Mock).mockReturnValue(true);
  (validateServerSession as jest.Mock).mockResolvedValue({ userId: owner, accessToken: 'token' });
});
it('reports only a new, explicit server-confirmed Sent transition', async () => {
  expect((await confirmQuoteSentForFollowup(owner, project, quote)).transitioned).toBe(true);
  expect(client.rpc).toHaveBeenCalledWith('confirm_quote_sent_for_followup', { p_quote_id: quote });
});
it('already-Sent confirmation is idempotent and not a new follow-up prompt', async () => {
  transitioned = false;
  expect((await confirmQuoteSentForFollowup(owner, project, quote)).transitioned).toBe(false);
});
it('refuses to accept foreign-account or project confirmation', async () => {
  await expect(confirmQuoteSentForFollowup(owner, quote, quote)).rejects.toThrow();
  (validateServerSession as jest.Mock).mockResolvedValue({ userId: project, accessToken: 'token' });
  await expect(confirmQuoteSentForFollowup(owner, project, quote)).rejects.toThrow();
});
