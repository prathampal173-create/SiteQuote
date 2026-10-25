import { chronologicalHistory, EMPTY_LEAD, filterLeads, validateLead, type Activity, type Lead } from '../leadModel';

const example = { ...EMPTY_LEAD, customerName: ' Jordan Lee ', phone: ' 555-0100 ' };
function lead(id: string, name: string, stage: Lead['contact_stage']): Lead {
  return { id, user_id: 'A', customer_name: name, contact_stage: stage, source: 'Other', phone: '123',
    email: null, notes: null, created_at: '', updated_at: '' };
}

test('valid lead creation normalizes input and defaults to New', () => {
  expect(validateLead(example)).toEqual({ ok: true, values: {
    customer_name: 'Jordan Lee', phone: '555-0100', email: null, notes: null,
    source: 'Referral', contact_stage: 'new'
  } });
});

test('phone or email is required, either one is sufficient', () => {
  expect(validateLead({ ...example, phone: ' ', email: '' })).toMatchObject({ ok: false,
    errors: { contact: expect.stringMatching(/phone.*email/) } });
  expect(validateLead({ ...example, phone: '', email: '  jordan@example.com  ' })).toMatchObject({
    ok: true, values: { email: 'jordan@example.com', phone: null }
  });
});

test('rejects blank name, malformed email, invalid stage and source', () => {
  expect(validateLead({ ...example, customerName: ' ' })).toMatchObject({ ok: false, errors: { customerName: expect.any(String) } });
  expect(validateLead({ ...example, email: 'wrong' })).toMatchObject({ ok: false, errors: { contact: expect.any(String) } });
  expect(validateLead({ ...example, contactStage: 'won' as never, source: 'Invalid' as never }))
    .toMatchObject({ ok: false, errors: { source: expect.any(String), contactStage: expect.any(String) } });
});

test('case-insensitive substring name search and exact-stage filter combine', () => {
  const rows = [lead('1','Jordan Lee','new'), lead('2','jORDAN Smith','contacted'),
    lead('3','Jordan West','site_visit_completed'), lead('4','Alex','new')];
  expect(filterLeads(rows, 'jOrDaN', 'all').map((row) => row.id)).toEqual(['1','2','3']);
  expect(filterLeads(rows, ' jorDan ', 'contacted').map((row) => row.id)).toEqual(['2']);
  expect(filterLeads(rows, 'jordan', 'new').map((row) => row.id)).toEqual(['1']);
  expect(filterLeads(rows, '', 'site_visit_completed').map((row) => row.id)).toEqual(['3']);
  expect(filterLeads(rows, 'Alex', 'contacted')).toEqual([]);
});

test('history is dated and stable chronologically', () => {
  const make = (id: string, created_at: string): Activity => ({ id, created_at,
    user_id: 'A', lead_id: 'L', project_id: null, type: 'manual_note', detail: { note: id } });
  expect(chronologicalHistory([make('z','2026-10-22T02:00:00Z'),
    make('b','2026-10-21T01:00:00Z'), make('a','2026-10-21T01:00:00Z')]).map((x) => x.id))
    .toEqual(['a','b','z']);
});
