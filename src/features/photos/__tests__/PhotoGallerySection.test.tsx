import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PhotoGallerySection } from '../PhotoGallerySection';
import { deleteSavedPhoto, cleanupProjectPhotos, listSavedPhotos, signPhotoUrl } from '../photosApi';
import { listProjectTasks } from '../../tasks/tasksApi';
import type { SavedPhoto } from '../photosApi';

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback])
}));
jest.mock('../photosApi', () => ({ listSavedPhotos: jest.fn(), signPhotoUrl: jest.fn(),
  deleteSavedPhoto: jest.fn(), cleanupProjectPhotos: jest.fn(),
  photoFailureMessage: () => 'Private photos unavailable.' }));
jest.mock('../../tasks/tasksApi', () => ({ listProjectTasks: jest.fn() }));
const base: SavedPhoto = { id: 'direct', user_id: 'u', project_id: 'p', task_id: null,
  storage_path: 'u/p/direct.jpg', source: 'site_visit', state: 'active',
  created_at: 'now', updated_at: 'now' };
const task1 = { ...base, id: 'a', task_id: 't1', source: 'client_provided' as const };
const task2 = { ...base, id: 'b', task_id: 't2' };
const props = { accountId: 'u', accountScope: 1, projectId: 'p' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listSavedPhotos).mockResolvedValue([base, task1, task2]);
  jest.mocked(listProjectTasks).mockResolvedValue([
    { id: 't1', title: 'Roof' }, { id: 't2', title: 'Walls' }
  ] as never);
  jest.mocked(deleteSavedPhoto).mockResolvedValue();
  jest.mocked(cleanupProjectPhotos).mockResolvedValue({ recovered: 0, orphaned: 0 });
  jest.mocked(signPhotoUrl).mockImplementation(async (_, photo) => `https://private.test/${photo.id}?signed=1`);
});
test('project gallery renders separate direct and task groups in three-column tiles', async () => {
  render(<PhotoGallerySection {...props} />);
  await waitFor(() => expect(screen.getByText('Direct project photos (1)')).toBeTruthy());
  expect(screen.getByText('Task: Roof (1)')).toBeTruthy();
  expect(screen.getByText('Task: Walls (1)')).toBeTruthy();
  expect(screen.getAllByLabelText(/Open .* photo/)).toHaveLength(3);
});
test('task gallery displays only the exact task association, not direct or sibling photos', async () => {
  render(<PhotoGallerySection {...props} taskId="t1" />);
  await waitFor(() => expect(screen.getByText('This task (1)')).toBeTruthy());
  expect(screen.getAllByLabelText(/Open .* photo/)).toHaveLength(1);
  expect(listSavedPhotos).toHaveBeenCalledWith('u', 'p', 't1');
  expect(listProjectTasks).not.toHaveBeenCalled();
});
test('viewer signs fresh URL, navigates between saved photos, and closes explicitly', async () => {
  render(<PhotoGallerySection {...props} />);
  await waitFor(() => expect(screen.getAllByLabelText(/Open .* photo/)).toHaveLength(3));
  fireEvent.press(screen.getAllByLabelText(/Open .* photo/)[0]!);
  await waitFor(() => expect(screen.getByText('Site visit · 1 of 3')).toBeTruthy());
  fireEvent.press(screen.getByText('Next photo'));
  await waitFor(() => expect(screen.getByText('Client-provided · 2 of 3')).toBeTruthy());
  expect(signPhotoUrl).toHaveBeenCalledWith('u', task1);
  fireEvent.press(screen.getByText('Close photo viewer'));
  expect(screen.queryByText('Client-provided · 2 of 3')).toBeNull();
});
test('missing signed thumbnail is isolated and gallery offers refresh', async () => {
  jest.mocked(signPhotoUrl).mockRejectedValueOnce(new Error('not found'));
  render(<PhotoGallerySection {...props} />);
  await waitFor(() => expect(screen.getByText('Direct project photos (1)')).toBeTruthy());
  expect(screen.getByText('Image unavailable. Tap to reload.')).toBeTruthy();
  fireEvent.press(screen.getByText('Refresh photos'));
  await waitFor(() => expect(jest.mocked(listSavedPhotos).mock.calls.length).toBeGreaterThan(1));
});

test('confirmed gallery photo removal invokes owner-only deletion and refreshes records', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<PhotoGallerySection {...props} />);
  await waitFor(() => expect(screen.getByText('Direct project photos (1)')).toBeTruthy());
  fireEvent.press(screen.getAllByLabelText(/Open .* photo/)[0]!);
  await waitFor(() => expect(screen.getByText('Site visit · 1 of 3')).toBeTruthy());
  fireEvent.press(screen.getByText('Delete photo'));
  expect(alert).toHaveBeenCalled();
  expect(deleteSavedPhoto).not.toHaveBeenCalled();
  await act(async () => { alert.mock.calls[0]?.[2]?.[1]?.onPress?.(); });
  await waitFor(() => expect(deleteSavedPhoto).toHaveBeenCalledWith('u', base));
  await waitFor(() => expect(jest.mocked(listSavedPhotos).mock.calls.length).toBeGreaterThan(1));
  alert.mockRestore();
});
test('project-only repair is available without revealing other account photos', async () => {
  jest.mocked(cleanupProjectPhotos).mockResolvedValueOnce({ recovered: 1, orphaned: 2 });
  render(<PhotoGallerySection {...props} />);
  await waitFor(() => expect(screen.getByText('Direct project photos (1)')).toBeTruthy());
  fireEvent.press(screen.getByText('Repair interrupted photo removals'));
  await waitFor(() => expect(cleanupProjectPhotos).toHaveBeenCalledWith('u', 'p'));
  await screen.findByText('Finished 1 interrupted deletions. 2 untracked files kept because they may still be uploading on another device.');
});
