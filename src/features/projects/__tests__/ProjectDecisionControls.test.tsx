import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProjectDecisionControls } from '../ProjectDecisionControls';
import { markProjectLost, markProjectWon, reopenProject } from '../projectDecisionsApi';
import type { Project } from '../projectModel';

jest.mock('../projectDecisionsApi', () => ({ markProjectLost: jest.fn(), markProjectWon: jest.fn(), reopenProject: jest.fn(),
  decisionFailureMessage: () => 'Could not save the decision. Check your connection and retry.' }));
jest.mock('../../estimates/preparedQuotesApi', () => ({ listPreparedQuotes: jest.fn() }));
import { listPreparedQuotes } from '../../estimates/preparedQuotesApi';
const project: Project = { id: 'p1', user_id: 'a', lead_id: 'l1', title: 'Kitchen',
  site_address: null, notes: null, status: 'draft', accepted_quote_id: null,
  tax_bps: 0, created_at: '2026-10-22', updated_at: '2026-10-22' };
const onChanged = jest.fn();
let dialog: { buttons?: { text: string; onPress?: () => void }[] } = {};
const mockLost = jest.mocked(markProjectLost);
const mockReopen = jest.mocked(reopenProject);
const mockWon = jest.mocked(markProjectWon);
const mockListQuotes = jest.mocked(listPreparedQuotes);

beforeEach(() => {
  dialog = {}; onChanged.mockReset(); mockLost.mockReset(); mockReopen.mockReset(); mockWon.mockReset(); mockListQuotes.mockReset();
  mockLost.mockResolvedValue({ ...project, status: 'lost' });
  mockReopen.mockResolvedValue({ ...project, status: 'draft' });
  mockWon.mockResolvedValue({ ...project, status: 'won', accepted_quote_id: 'sent-1' });
  mockListQuotes.mockResolvedValue([]);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    dialog.buttons = buttons as typeof dialog.buttons;
  });
});
afterEach(() => { jest.restoreAllMocks(); });

test('Mark Lost requires confirmation; cancel does not call RPC', async () => {
  render(<ProjectDecisionControls project={project} accountId="a" accountScope={1} onChanged={onChanged} />);
  fireEvent.press(screen.getByText('Mark Lost'));
  expect(mockLost).not.toHaveBeenCalled();
  dialog.buttons?.[0]?.onPress?.();
  expect(mockLost).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Mark Lost'));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  await waitFor(() => expect(mockLost).toHaveBeenCalledWith('a', 'p1'));
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('saving prevents duplicates; failure displays retryable error', async () => {
  let reject!: (e: Error) => void;
  mockLost.mockImplementationOnce(() => new Promise<Project>((_, fail) => { reject = fail; }))
    .mockResolvedValueOnce({ ...project, status: 'lost' });
  render(<ProjectDecisionControls project={project} accountId="a" accountScope={1} onChanged={onChanged} />);
  fireEvent.press(screen.getByText('Mark Lost'));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  fireEvent.press(screen.getByText('Saving decision…'));
  expect(mockLost).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('offline')); });
  await waitFor(() => expect(screen.getByText(/Could not save the decision/)).toBeTruthy());
  fireEvent.press(screen.getByText('Mark Lost'));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  await waitFor(() => expect(mockLost).toHaveBeenCalledTimes(2));
});

test('Reopen offers history-preserving confirmation', async () => {
  render(<ProjectDecisionControls project={{ ...project, status: 'lost' }} accountId="a"
    accountScope={1} onChanged={onChanged} />);
  fireEvent.press(screen.getByText('Reopen Project'));
  expect(Alert.alert).toHaveBeenCalledWith('Reopen project?', expect.stringContaining('permanent history'),
    expect.any(Array), expect.any(Object));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  await waitFor(() => expect(mockReopen).toHaveBeenCalledWith('a', 'p1'));
});

test('switching account scope blocks stale UI results', async () => {
  let complete!: (value: Project) => void;
  mockLost.mockImplementation(() => new Promise<Project>((resolve) => { complete = resolve; }));
  const view = render(<ProjectDecisionControls project={project} accountId="a" accountScope={1} onChanged={onChanged} />);
  fireEvent.press(screen.getByText('Mark Lost'));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  view.rerender(<ProjectDecisionControls project={{ ...project, user_id: 'b' }} accountId="b"
    accountScope={2} onChanged={onChanged} />);
  await act(async () => { complete({ ...project, status: 'lost' }); });
  await waitFor(() => expect(onChanged).not.toHaveBeenCalled());
});

test('Mark Won requires selecting a Sent quote and explicit confirmation', async () => {
  const quote = { id: 'sent-1', user_id: 'a', project_id: 'p1', status: 'sent' as const,
    version: 1, total_minor: 340200 };
  mockListQuotes.mockResolvedValue([quote] as never);
  render(<ProjectDecisionControls project={{ ...project, status: 'quote_sent' }} accountId="a"
    accountScope={1} onChanged={onChanged} />);
  await waitFor(() => expect(screen.getByText('Mark Won with selected Sent version')).toBeTruthy());
  fireEvent.press(screen.getByText('Mark Won with selected Sent version'));
  expect(mockWon).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Mark project Won?', expect.stringContaining('$3,402.00'),
    expect.any(Array), expect.any(Object));
  await act(async () => { dialog.buttons?.[1]?.onPress?.(); });
  await waitFor(() => expect(mockWon).toHaveBeenCalledWith('a','p1','sent-1'));
});

test('Prepared-only history never allows Mark Won', async () => {
  mockListQuotes.mockResolvedValue([{ id: 'prepared-1', status: 'prepared' }] as never);
  render(<ProjectDecisionControls project={{ ...project, status: 'quote_sent' }} accountId="a"
    accountScope={1} onChanged={onChanged} />);
  await waitFor(() => expect(screen.getByText(/No Sent quote versions/)).toBeTruthy());
  expect(screen.getByLabelText('Mark Won with selected Sent version').props.accessibilityState.disabled).toBe(true);
});

test('newly Sent version refreshes selectable choices without navigation', async () => {
  const first = { id:'sent-1', user_id:'a', project_id:'p1', status:'sent' as const,
    version:1, total_minor:340200 };
  const second = { ...first, id:'sent-2', version:2, total_minor:400000 };
  mockListQuotes.mockResolvedValueOnce([first] as never).mockResolvedValueOnce([second,first] as never);
  const open={ ...project, status:'quote_sent' as const };
  const ui=render(<ProjectDecisionControls project={open} accountId="a" accountScope={1}
    refreshKey={0} onChanged={onChanged} />);
  await waitFor(() => expect(mockListQuotes).toHaveBeenCalledTimes(1));
  ui.rerender(<ProjectDecisionControls project={open} accountId="a" accountScope={1}
    refreshKey={1} onChanged={onChanged} />);
  await waitFor(() => expect(mockListQuotes).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText(/✓ v2/)).toBeTruthy());
  fireEvent.press(screen.getByText('Mark Won with selected Sent version'));
  expect(Alert.alert).toHaveBeenCalledWith('Mark project Won?', expect.stringContaining('$4,000.00'),
    expect.any(Array), expect.any(Object));
});
