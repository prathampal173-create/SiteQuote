import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LeadFormScreen } from '../LeadFormScreen';
import { LeadDetailScreen } from '../LeadDetailScreen';
import { LeadsScreen } from '../LeadsScreen';
import { createLead, updateLead, updateLeadStage, listLeads, loadLead, listLeadHistory, addManualHistory } from '../leadsApi';
import type { Lead, Activity } from '../leadModel';
import { listQuoteSentLeadIds } from '../../projects/quoteSentApi';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockAccount = { accountId: 'account-a', accountScope: 1 };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => mockRouter,
  useFocusEffect: (cb: () => () => void) => require('react').useEffect(cb, [cb])
}));
jest.mock('../../auth/AuthFlowProvider', () => ({ useAuthFlow: () => mockAccount }));
jest.mock('../../projects/quoteSentApi', () => ({ listQuoteSentLeadIds: jest.fn(() => Promise.resolve(new Set())) }));
jest.mock('../../projects/projectsApi', () => ({ listLeadProjects: jest.fn(() => Promise.resolve([])), projectFailureMessage: () => 'Network unavailable. Retry.' }));
jest.mock('../leadsApi', () => ({
  listLeads: jest.fn(), loadLead: jest.fn(), listLeadHistory: jest.fn(),
  createLead: jest.fn(), updateLead: jest.fn(), updateLeadStage: jest.fn(), addManualHistory: jest.fn(),
  leadFailureMessage: () => 'Network unavailable. Retry.'
}));

const row: Lead = { id: 'L', user_id: 'account-a', customer_name: 'Jordan Lee', phone: '555',
  email: null, source: 'Referral', notes: 'Editable details', contact_stage: 'new',
  created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' };
const activity: Activity = { id: 'h1', user_id: 'account-a', lead_id: 'L', project_id: null,
  type: 'manual_note', detail: { note: 'Called the customer' }, created_at: '2026-10-21T11:00:00Z' };
const mockCreate = jest.mocked(createLead);
const mockUpdate = jest.mocked(updateLead);
const mockUpdateStage = jest.mocked(updateLeadStage);
const mockLoad = jest.mocked(loadLead);
const mockList = jest.mocked(listLeads);
const mockHistory = jest.mocked(listLeadHistory);
const mockAdd = jest.mocked(addManualHistory);
const mockQuoteIds = jest.mocked(listQuoteSentLeadIds);

beforeEach(() => {
  mockAccount = { accountId: 'account-a', accountScope: 1 };
  mockRouter.push.mockReset(); mockRouter.back.mockReset(); mockRouter.replace.mockReset();
  mockCreate.mockReset(); mockUpdate.mockReset(); mockUpdateStage.mockReset(); mockLoad.mockReset(); mockList.mockReset();
  mockHistory.mockReset(); mockAdd.mockReset(); mockQuoteIds.mockReset(); mockQuoteIds.mockResolvedValue(new Set());
  mockList.mockResolvedValue([row]); mockLoad.mockResolvedValue(row); mockHistory.mockResolvedValue([activity]);
});

test('create form validates phone or email and saves a valid lead', async () => {
  mockCreate.mockResolvedValue(row);
  render(<LeadFormScreen />);
  fireEvent.press(screen.getByText('Save Lead'));
  expect(screen.getByText('Customer name is required.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Customer name'), 'Jordan Lee');
  fireEvent.press(screen.getByText('Save Lead'));
  expect(screen.getByText('Enter at least a phone number or email address.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Phone'), '555');
  fireEvent.press(screen.getByText('Save Lead'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/lead/[id]', params: { id: 'L', saved: 'created' } });
});

test('failed creation retains draft for retry and blocks duplicate presses', async () => {
  let reject!: (err: Error) => void;
  mockCreate.mockImplementationOnce(() => new Promise<Lead>((_resolve, no) => { reject = no; }))
    .mockResolvedValueOnce(row);
  render(<LeadFormScreen />);
  fireEvent.changeText(screen.getByLabelText('Customer name'), 'Jordan Lee');
  fireEvent.changeText(screen.getByLabelText('Phone'), '555');
  fireEvent.press(screen.getByText('Save Lead'));
  fireEvent.press(screen.getByText('Saving lead…'));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  reject(new Error('offline'));
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  expect(screen.getByDisplayValue('Jordan Lee')).toBeTruthy();
  fireEvent.press(screen.getByText('Save Lead'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(mockRouter.replace).toHaveBeenCalled();
});

test('lead list searches case-insensitively and combines exact stage filters', async () => {
  mockList.mockResolvedValue([row, { ...row, id: '2', customer_name: 'JORDAN Smith', contact_stage: 'contacted' },
    { ...row, id: '3', customer_name: 'Alex Doe', contact_stage: 'new' }]);
  render(<LeadsScreen />);
  await waitFor(() => expect(screen.getByText('Jordan Lee')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Search customer name'), 'joRDan');
  expect(screen.queryByText('Alex Doe')).toBeNull();
  fireEvent.press(screen.getByLabelText('Lead filter: Contacted'));
  expect(screen.getByText('JORDAN Smith')).toBeTruthy();
  expect(screen.queryByText('Jordan Lee')).toBeNull();
});

test('lead editing loads saved fields and updates contact stage', async () => {
  mockUpdate.mockResolvedValue({ ...row, contact_stage: 'contacted' });
  render(<LeadFormScreen id="L" />);
  await waitFor(() => expect(screen.getByDisplayValue('Jordan Lee')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Contact stage: Contacted'));
  fireEvent.press(screen.getByText('Save Lead'));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('account-a', 'L',
    expect.objectContaining({ contactStage: 'contacted' })));
  expect(mockRouter.replace).toHaveBeenCalled();
});

test('detail stage correction persists and manual history notes append without modifying lead notes', async () => {
  const corrected = { ...row, contact_stage: 'site_visit_completed' as const };
  mockUpdateStage.mockResolvedValue(corrected);
  mockAdd.mockResolvedValue({ ...activity, id: 'h2', detail: { note: 'Measurements taken' },
    created_at: '2026-10-22T11:00:00Z' });
  render(<LeadDetailScreen id="L" />);
  await waitFor(() => expect(screen.getByText('Called the customer')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Contact stage: Site Visit Completed'));
  await waitFor(() => expect(screen.getByText('Contact stage saved.')).toBeTruthy());
  expect(mockUpdateStage).toHaveBeenCalledWith('account-a', 'L', 'site_visit_completed');
  fireEvent.changeText(screen.getByLabelText('New history note'), 'Measurements taken');
  fireEvent.press(screen.getByText('Add History Note'));
  await waitFor(() => expect(screen.getByText('Measurements taken')).toBeTruthy());
  expect(mockAdd).toHaveBeenCalledWith('account-a', 'L', 'Measurements taken');
  expect(screen.getByText('Notes: Editable details')).toBeTruthy();
  expect(screen.getAllByText(/Called the customer|Measurements taken/)).toHaveLength(2);
});

test('account switch clears previous leads and ignores an old delayed request', async () => {
  let resolveA!: (rows: Lead[]) => void;
  mockList.mockImplementationOnce(() => new Promise<Lead[]>((res) => { resolveA = res; }))
    .mockResolvedValueOnce([{ ...row, id: 'B', user_id: 'account-b', customer_name: 'B Customer' }]);
  const ui = render(<LeadsScreen />);
  await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
  mockAccount = { accountId: 'account-b', accountScope: 2 };
  ui.rerender(<LeadsScreen />);
  await waitFor(() => expect(screen.getByText('B Customer')).toBeTruthy());
  resolveA([row]);
  await waitFor(() => expect(screen.queryByText('Jordan Lee')).toBeNull());
});

test('detail preserves manual note draft when saving fails then retries', async () => {
  mockAdd.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...activity, id: 'h2', detail: { note: 'Try again' } });
  render(<LeadDetailScreen id="L" />);
  await waitFor(() => expect(screen.getByText('Called the customer')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('New history note'), 'Try again');
  fireEvent.press(screen.getByText('Add History Note'));
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  expect(screen.getByDisplayValue('Try again')).toBeTruthy();
  fireEvent.press(screen.getByText('Add History Note'));
  await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(2));
});


test('Quote Sent lead filter matches current child status IDs and combines name search', async () => {
  mockList.mockResolvedValue([row, { ...row, id: '2', customer_name: 'ALEX Roe' },
    { ...row, id: '3', customer_name: 'Other' }]);
  mockQuoteIds.mockResolvedValue(new Set(['L', '2']));
  render(<LeadsScreen />);
  await waitFor(() => expect(screen.getByText('ALEX Roe')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Lead filter: Quote Sent'));
  expect(screen.getByText('Jordan Lee')).toBeTruthy();
  expect(screen.getByText('ALEX Roe')).toBeTruthy();
  expect(screen.queryByText('Other')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Search customer name'), 'aLeX');
  expect(screen.getByText('ALEX Roe')).toBeTruthy();
  expect(screen.queryByText('Jordan Lee')).toBeNull();
});
