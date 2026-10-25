import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SettingsScreen } from '../SettingsScreen';
import { useAuthFlow } from '../../auth/AuthFlowProvider';
import { loadBusinessProfile, saveBusinessProfile } from '../businessProfile';

jest.mock('../../auth/AuthFlowProvider', () => ({ useAuthFlow: jest.fn() }));
jest.mock('../businessProfile', () => ({
  ...jest.requireActual('../businessProfile'),
  loadBusinessProfile: jest.fn(),
  saveBusinessProfile: jest.fn()
}));

const mockAuth = jest.mocked(useAuthFlow);
const mockLoad = jest.mocked(loadBusinessProfile);
const mockSave = jest.mocked(saveBusinessProfile);
const signOut = jest.fn();
const profileA = { user_id: 'A', business_name: 'Business A', phone: '111', address: 'Street A' };
const profileB = { user_id: 'B', business_name: 'Business B', phone: null, address: null };

function asAccount(id: string | null, scope: number) {
  const value = { signOut, accountId: id, accountScope: scope, authorized: Boolean(id) };
  mockAuth.mockReturnValue(value as unknown as ReturnType<typeof useAuthFlow>);
}

beforeEach(() => {
  jest.clearAllMocks();
  asAccount('A', 1);
  mockLoad.mockResolvedValue(profileA);
  mockSave.mockResolvedValue(profileA);
  signOut.mockResolvedValue(true);
});

test('loads existing business profile into accessible fields', async () => {
  render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByDisplayValue('Business A')).toBeTruthy());
  expect(screen.getByDisplayValue('111')).toBeTruthy();
  expect(screen.getByDisplayValue('Street A')).toBeTruthy();
  expect(mockLoad).toHaveBeenCalledWith('A');
});

test('creates missing profile, normalizing blank optional fields', async () => {
  mockLoad.mockResolvedValueOnce(null);
  mockSave.mockResolvedValueOnce({ user_id: 'A', business_name: 'My Builders', phone: null, address: null });
  render(<SettingsScreen />);
  await waitFor(() => expect(screen.getByText('Save')).toBeTruthy());
  await waitFor(() => expect(screen.getByLabelText('Business name').props.editable).toBe(true));
  fireEvent.changeText(screen.getByLabelText('Business name'), '  My Builders ');
  fireEvent.changeText(screen.getByLabelText('Business phone (optional)'), '   ');
  fireEvent.changeText(screen.getByLabelText('Business address (optional)'), '');
  fireEvent.press(screen.getByText('Save'));
  await screen.findByText('Business profile saved.');
  expect(mockSave).toHaveBeenCalledWith('A', {
    businessName: '  My Builders ', phone: '   ', address: ''
  }, false);
});

test('saves edits to name, phone, and address', async () => {
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.changeText(screen.getByLabelText('Business name'), 'Other Builders');
  fireEvent.changeText(screen.getByLabelText('Business phone (optional)'), '222');
  fireEvent.changeText(screen.getByLabelText('Business address (optional)'), 'Street 2');
  fireEvent.press(screen.getByText('Save'));
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith('A', {
    businessName: 'Other Builders', phone: '222', address: 'Street 2'
  }, true));
});

test('refuses whitespace name and does not send a write', async () => {
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.changeText(screen.getByLabelText('Business name'), '    ');
  fireEvent.press(screen.getByText('Save'));
  await screen.findByText('Business name is required.');
  expect(mockSave).not.toHaveBeenCalled();
});

test('network failure preserves typed form and allows retry', async () => {
  mockSave.mockRejectedValueOnce(new Error('offline'));
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.changeText(screen.getByLabelText('Business name'), 'Draft Builders');
  fireEvent.press(screen.getByText('Save'));
  await screen.findByText(/Could not reach the business profile/);
  expect(screen.getByDisplayValue('Draft Builders')).toBeTruthy();
  fireEvent.press(screen.getByText('Save'));
  await screen.findByText('Business profile saved.');
  expect(mockSave).toHaveBeenCalledTimes(2);
});

test('duplicate presses cannot launch two profile saves', async () => {
  let complete!: (value: typeof profileA) => void;
  mockSave.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.press(screen.getByText('Save'));
  fireEvent.press(screen.getByText('Saving…'));
  expect(mockSave).toHaveBeenCalledTimes(1);
  await act(async () => { complete(profileA); });
});

test('failed profile load can be retried; save stays disabled before load', async () => {
  mockLoad.mockRejectedValueOnce(new Error('offline'));
  render(<SettingsScreen />);
  await screen.findByText(/Could not reach the business profile/);
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.press(screen.getByText('Retry loading profile'));
  await screen.findByDisplayValue('Business A');
  expect(mockLoad).toHaveBeenCalledTimes(2);
});

test('late Account A load cannot leak into Account B form', async () => {
  let completeA!: (value: typeof profileA) => void;
  mockLoad.mockImplementationOnce(() => new Promise((resolve) => { completeA = resolve; }));
  mockLoad.mockResolvedValueOnce(profileB);
  const view = render(<SettingsScreen />);
  await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
  asAccount('B', 2);
  view.rerender(<SettingsScreen />);
  expect(screen.queryByDisplayValue('Business A')).toBeNull();
  await screen.findByDisplayValue('Business B');
  await act(async () => { completeA(profileA); });
  expect(screen.getByDisplayValue('Business B')).toBeTruthy();
  expect(screen.queryByDisplayValue('Business A')).toBeNull();
});

test('late Account A save cannot replace Account B profile', async () => {
  let completeA!: (value: typeof profileA) => void;
  mockSave.mockImplementationOnce(() => new Promise((resolve) => { completeA = resolve; }));
  mockLoad.mockResolvedValueOnce(profileA).mockResolvedValueOnce(profileB);
  const view = render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.press(screen.getByText('Save'));
  asAccount('B', 2);
  view.rerender(<SettingsScreen />);
  await screen.findByDisplayValue('Business B');
  await act(async () => { completeA(profileA); });
  expect(screen.getByDisplayValue('Business B')).toBeTruthy();
  expect(screen.queryByDisplayValue('Business A')).toBeNull();
});

test('no active account reveals no previous profile and cannot save', async () => {
  asAccount(null, 3);
  render(<SettingsScreen />);
  expect(mockLoad).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('existing Phase 0D Sign Out still performs auth cleanup and disables repeat presses', async () => {
  let complete!: (value: boolean) => void;
  signOut.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.press(screen.getByText('Sign Out'));
  fireEvent.press(screen.getByText('Signing out…'));
  expect(signOut).toHaveBeenCalledTimes(1);
  await act(async () => { complete(true); });
  await waitFor(() => expect(screen.getByText('Sign Out')).toBeTruthy());
});

test('failed Phase 0D local sign-out displays an error', async () => {
  signOut.mockResolvedValue(false);
  render(<SettingsScreen />);
  await screen.findByDisplayValue('Business A');
  fireEvent.press(screen.getByText('Sign Out'));
  await screen.findByText(/Local credential cleanup could not finish/);
});
