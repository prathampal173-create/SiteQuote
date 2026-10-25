import { getSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
import {
  BusinessProfileFailure, checkSavedBusinessNameForQuote,
  loadBusinessProfile, saveBusinessProfile, validateBusinessProfile
} from '../businessProfile';

jest.mock('../../../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../../auth/sessionValidation', () => ({ validateServerSession: jest.fn() }));

const owner = 'a-verified-user';
const other = 'b-verified-user';
const profile = { user_id: owner, business_name: 'Brickworks', phone: null, address: null };
const maybeSingle = jest.fn();
const single = jest.fn();
const eq: jest.Mock = jest.fn(() => ({ maybeSingle, select, eq }));
const select: jest.Mock = jest.fn(() => ({ eq, single, maybeSingle }));
const insert = jest.fn(() => ({ select }));
const update = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select, insert, update }));
const client = { from };
const mockClient = jest.mocked(getSupabaseClient);
const mockValidate = jest.mocked(validateServerSession);

beforeEach(() => {
  jest.resetAllMocks();
  eq.mockImplementation(() => ({ maybeSingle, select, eq }));
  select.mockImplementation(() => ({ eq, single, maybeSingle }));
  insert.mockImplementation(() => ({ select }));
  update.mockImplementation(() => ({ eq }));
  from.mockImplementation(() => ({ select, insert, update }));
  mockClient.mockReturnValue(client as unknown as NonNullable<ReturnType<typeof getSupabaseClient>>);
  mockValidate.mockResolvedValue({ userId: owner, accessToken: 'ignored-token', expiresAtMs: Date.now() + 60000 });
  maybeSingle.mockResolvedValue({ data: profile, error: null });
  single.mockResolvedValue({ data: profile, error: null });
});

test('rejects missing or whitespace-only business name and normalizes optional values', () => {
  expect(validateBusinessProfile({ businessName: '  ', phone: '', address: '' })).toEqual({
    ok: false, message: 'Business name is required.'
  });
  expect(validateBusinessProfile({ businessName: '  Brickworks  ', phone: '  ', address: '\n ' })).toEqual({
    ok: true, values: { business_name: 'Brickworks', phone: null, address: null }
  });
});

test('loads only the authenticated account profile', async () => {
  expect(await loadBusinessProfile(owner)).toEqual(profile);
  expect(from).toHaveBeenCalledWith('business_profiles');
  expect(eq).toHaveBeenCalledWith('user_id', owner);
  expect(mockValidate).toHaveBeenCalled();
});

test('empty table result supports first-time creation', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await loadBusinessProfile(owner)).toBeNull();
  const created = await saveBusinessProfile(owner, { businessName: '  Brickworks  ', phone: '', address: '  ' }, false);
  expect(created).toEqual(profile);
  expect(insert).toHaveBeenCalledWith({ user_id: owner, business_name: 'Brickworks', phone: null, address: null });
  expect(update).not.toHaveBeenCalled();
});

test('existing profiles are updated without writing or changing user_id', async () => {
  const result = await saveBusinessProfile(owner, {
    businessName: 'New Trading Name', phone: '12345', address: 'Main Street'
  }, true);
  expect(result).toEqual(profile);
  expect(update).toHaveBeenCalledWith({ business_name: 'New Trading Name', phone: '12345', address: 'Main Street' });
  expect(eq).toHaveBeenCalledWith('user_id', owner);
  expect(insert).not.toHaveBeenCalled();
});


test('existing profile clears optional fields to database null', async () => {
  await saveBusinessProfile(owner, { businessName: 'Brickworks', phone: ' ', address: '\n  ' }, true);
  expect(update).toHaveBeenCalledWith({ business_name: 'Brickworks', phone: null, address: null });
});

test('missing or invalid session denies database access, including a switched user', async () => {
  mockValidate.mockResolvedValue(null);
  await expect(loadBusinessProfile(owner)).rejects.toMatchObject({ reason: 'session' });
  expect(from).not.toHaveBeenCalled();
  mockValidate.mockResolvedValue({ userId: other, accessToken: 'other', expiresAtMs: Date.now() + 60000 });
  await expect(saveBusinessProfile(owner, { businessName: 'B', phone: '', address: '' }, false))
    .rejects.toMatchObject({ reason: 'session' });
  expect(from).not.toHaveBeenCalled();
});

test('missing Supabase configuration is not treated as persistence', async () => {
  mockClient.mockReturnValue(null);
  await expect(loadBusinessProfile(owner)).rejects.toMatchObject({ reason: 'configuration' });
});

test('database and network errors reject; update zero rows is not claimed saved', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await expect(loadBusinessProfile(owner)).rejects.toMatchObject({ reason: 'request' });
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(saveBusinessProfile(owner, { businessName: 'B', phone: '', address: '' }, true))
    .rejects.toMatchObject({ reason: 'not_found' });
});

test('quote eligibility checks saved business name, not the draft form', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect(await checkSavedBusinessNameForQuote(owner)).toEqual({ eligible: false, reason: 'missing_business_name' });
  maybeSingle.mockResolvedValueOnce({ data: { ...profile, business_name: '   ' }, error: null });
  expect(await checkSavedBusinessNameForQuote(owner)).toEqual({ eligible: false, reason: 'missing_business_name' });
  expect(await checkSavedBusinessNameForQuote(owner)).toEqual({ eligible: true, businessName: 'Brickworks' });
});

test('quote eligibility fails closed if auth or backend is unavailable', async () => {
  mockValidate.mockResolvedValue(null);
  expect(await checkSavedBusinessNameForQuote(owner)).toEqual({ eligible: false, reason: 'unauthorized' });
  mockClient.mockReturnValue(null);
  expect(await checkSavedBusinessNameForQuote(owner)).toEqual({ eligible: false, reason: 'unavailable' });
});
