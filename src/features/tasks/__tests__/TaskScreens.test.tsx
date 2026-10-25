import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ProjectTasksSection } from '../ProjectTasksSection';
import { TaskFormScreen } from '../TaskFormScreen';
import { TaskDetailScreen } from '../TaskDetailScreen';
import { createTask, updateTask, loadTask, removeTaskWithPhotos, listProjectTasks } from '../tasksApi';
import { loadProject } from '../../projects/projectsApi';
import type { Task } from '../taskModel';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockAccount = { accountId: 'a', accountScope: 1 };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => () => void) => require('react').useEffect(callback, [callback])
}));
jest.mock('../../auth/AuthFlowProvider', () => ({ useAuthFlow: () => mockAccount }));
jest.mock('../../photos/PhotoStagingSection', () => ({ PhotoStagingSection: () => null }));
jest.mock('../../photos/PhotoGallerySection', () => ({ PhotoGallerySection: () => null }));

jest.mock('../tasksApi', () => ({ createTask: jest.fn(), updateTask: jest.fn(), loadTask: jest.fn(),
  removeTaskWithPhotos: jest.fn(), listProjectTasks: jest.fn(), taskFailureMessage: () => 'Network unavailable. Retry.' }));
jest.mock('../../projects/projectsApi', () => ({ loadProject: jest.fn() }));
const task: Task = { id: 't1', user_id: 'a', project_id: 'p1', category: 'Kitchen Remodeling',
  title: 'Cabinet installation', notes: 'Cabinets only', amount_minor: 150000, sort_order: 0,
  created_at: '2026-10-22', updated_at: '2026-10-22' };
const another: Task = { ...task, id: 't2', title: 'Countertop replacement', notes: 'Countertop only', amount_minor: 50000 };
const create = jest.mocked(createTask);
const update = jest.mocked(updateTask);
const load = jest.mocked(loadTask);
const remove = jest.mocked(removeTaskWithPhotos);
const list = jest.mocked(listProjectTasks);
const project = jest.mocked(loadProject);
beforeEach(() => {
  mockAccount = { accountId: 'a', accountScope: 1 };
  Object.values(mockRouter).forEach((fn) => fn.mockReset());
  create.mockReset().mockResolvedValue(task); update.mockReset().mockResolvedValue(task);
  load.mockReset().mockResolvedValue(task); remove.mockReset().mockResolvedValue(undefined);
  list.mockReset().mockResolvedValue([]);
  project.mockReset().mockResolvedValue({ id: 'p1', status: 'draft' } as never);
  jest.restoreAllMocks();
});

test('form validates, persists task fields including zero cents and selected category', async () => {
  render(<TaskFormScreen projectId="p1" />);
  await waitFor(() => expect(screen.getByText('Create Task')).toBeTruthy());
  await waitFor(() => expect(screen.getByLabelText('Task title')).toBeTruthy());
  fireEvent.press(screen.getByText('Save Task'));
  expect(screen.getByText('Task title is required.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Task title'), 'Bathroom tile');
  fireEvent.changeText(screen.getByLabelText('Task notes (optional)'), 'Independent bathroom notes');
  fireEvent.changeText(screen.getByLabelText('Estimated cost (USD)'), '0.00');
  fireEvent.press(screen.getByLabelText('Task category: Flooring'));
  fireEvent.press(screen.getByText('Save Task'));
  await waitFor(() => expect(create).toHaveBeenCalledWith('a', 'p1', {
    category: 'Flooring', title: 'Bathroom tile', notes: 'Independent bathroom notes', cost: '0.00'
  }));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: 't1', saved: '1' } }));
});

test('invalid cost blocks write and retry keeps input after API failure and blocks duplicate submission', async () => {
  let reject!: (reason: Error) => void;
  create.mockImplementationOnce(() => new Promise<Task>((_, bad) => { reject = bad; })).mockResolvedValueOnce(task);
  render(<TaskFormScreen projectId="p1" />);
  await waitFor(() => expect(screen.getByLabelText('Task title')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Task title'), 'Flooring');
  fireEvent.changeText(screen.getByLabelText('Estimated cost (USD)'), '1.001');
  fireEvent.press(screen.getByText('Save Task'));
  expect(screen.getByText('Enter a nonnegative USD amount with at most two decimal places.')).toBeTruthy();
  expect(create).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Estimated cost (USD)'), '1.01');
  fireEvent.press(screen.getByText('Save Task'));
  fireEvent.press(screen.getByText('Saving task…'));
  expect(create).toHaveBeenCalledTimes(1);
  reject(new Error('offline'));
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  expect(screen.getByDisplayValue('Flooring')).toBeTruthy();
  fireEvent.press(screen.getByText('Save Task'));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
});

test('editing uses independent saved task fields', async () => {
  load.mockResolvedValue(another);
  render(<TaskFormScreen id="t2" />);
  await waitFor(() => expect(screen.getByDisplayValue('Countertop replacement')).toBeTruthy());
  expect(screen.getByDisplayValue('Countertop only')).toBeTruthy();
  expect(screen.getByDisplayValue('500.00')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Task notes (optional)'), 'Revised countertop only');
  fireEvent.press(screen.getByText('Save Task'));
  await waitFor(() => expect(update).toHaveBeenCalledWith('a', 't2', expect.objectContaining({
    notes: 'Revised countertop only', title: 'Countertop replacement'
  })));
});

test('two same-category tasks stay distinct in project detail; loading and retry work', async () => {
  list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([task, another]);
  render(<ProjectTasksSection accountId="a" accountScope={1} projectId="p1" closed={false} />);
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  fireEvent.press(screen.getByText('Retry tasks'));
  await waitFor(() => expect(screen.getByText('Tasks (2)')).toBeTruthy());
  expect(screen.getAllByText('Kitchen Remodeling')).toHaveLength(2);
  expect(screen.getByText('Cabinets only', { exact: false })).toBeTruthy();
  fireEvent.press(screen.getByText('Edit task Countertop replacement'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: 't2' } });
});

test('confirmed removal, cancellation, failure and retry', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  remove.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  render(<TaskDetailScreen id="t1" />);
  await waitFor(() => expect(screen.getByText('Remove Task')).toBeTruthy());
  fireEvent.press(screen.getByText('Remove Task'));
  expect(remove).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]![2]!;
  expect(buttons).toHaveLength(2);
  buttons[0]?.onPress?.();
  expect(remove).not.toHaveBeenCalled();
  await act(async () => { buttons[1]?.onPress?.(); });
  await waitFor(() => expect(screen.getByText('Network unavailable. Retry.')).toBeTruthy());
  fireEvent.press(screen.getByText('Remove Task'));
  await act(async () => { alert.mock.calls[1]?.[2]?.[1]?.onPress?.(); });
  await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/project/[id]', params: { id: 'p1' } }));
});

test('locked project offers read-only task fields and prevents removal', async () => {
  project.mockResolvedValue({ id: 'p1', status: 'won' } as never);
  render(<TaskDetailScreen id="t1" />);
  await waitFor(() => expect(screen.getByText(/Read-only: reopen/)).toBeTruthy());
  expect(screen.queryByText('Remove Task')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

test('account change discards stale task results', async () => {
  let release!: (task: Task) => void;
  load.mockImplementationOnce(() => new Promise<Task>((resolve) => { release = resolve; }));
  const { rerender } = render(<TaskDetailScreen id="t1" />);
  mockAccount = { accountId: 'b', accountScope: 2 };
  load.mockResolvedValueOnce({ ...task, id: 't1', user_id: 'b', title: 'B task' });
  rerender(<TaskDetailScreen id="t1" />);
  release(task);
  await waitFor(() => expect(screen.getByText('B task')).toBeTruthy());
  expect(screen.queryByText('Cabinet installation')).toBeNull();
});
