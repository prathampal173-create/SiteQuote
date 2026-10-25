import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PhotoStagingSection } from '../PhotoStagingSection';
import { selectPhoto } from '../photoSelection';
import { processPhoto } from '../../../lib/photoProcessing';
import { recoverPendingUpload } from '../photosApi';
import { stagePendingPhoto, clearPendingPhoto, loadPendingPhotos } from '../photoQueue';

jest.mock('../photoSelection', () => ({ selectPhoto: jest.fn() }));
jest.mock('../photosApi', () => ({ recoverPendingUpload: jest.fn(),
  PhotoFailure: class PhotoFailure extends Error {},
  photoFailureMessage: (err: Error) => err.message }));
jest.mock('../photoQueue', () => ({ stagePendingPhoto: jest.fn(), loadPendingPhotos: jest.fn(), clearPendingPhoto: jest.fn() }));
jest.mock('../../../lib/photoProcessing', () => ({
  PHOTO_SOURCE_LABELS: { site_visit: 'Site visit', client_provided: 'Client-provided' },
  processPhoto: jest.fn()
}));
const picker = jest.mocked(selectPhoto);
const process = jest.mocked(processPhoto);
const image = { uri: 'file:///raw.png', type: 'image' as const, mimeType: 'image/png', width: 300, height: 200 };
const local = { uri: 'file:///saved-preview.jpg', source: 'site_visit' as const, mimeType: 'image/jpeg' as const,
  width: 300, height: 200, sizeBytes: 2048, projectId: 'p1', taskId: null };
const props = { accountId: 'a', accountScope: 1, projectId: 'p1' };

beforeEach(() => {
  jest.resetAllMocks();
  picker.mockResolvedValue(image as never);
  process.mockResolvedValue(local);
  let photoNumber = 0;
  jest.mocked(stagePendingPhoto).mockImplementation(async (_, photo) => ({
    id: ++photoNumber === 1 ? 'f' : `f-${photoNumber}`, createdAt: 'now', photo
  }));
  jest.mocked(loadPendingPhotos).mockResolvedValue([]);
  jest.mocked(clearPendingPhoto).mockResolvedValue();
  jest.mocked(recoverPendingUpload).mockResolvedValue({ id: 'f', user_id: 'a', project_id: 'p1',
    task_id: null, storage_path: 'a/p1/f.jpg', source: 'site_visit', state: 'active',
    created_at: 'now', updated_at: 'now' });
});

test('requires a label; previews processed output as NOT SAVED with its association', async () => {
  render(<PhotoStagingSection {...props} />);
  fireEvent.press(screen.getByText('Take Photo'));
  expect(screen.getByText('Choose a photo label first.')).toBeTruthy();
  expect(picker).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(process).toHaveBeenCalledWith(image, 'site_visit', { projectId: 'p1', taskId: null }));
  expect(screen.getByText('NOT SAVED — local preview only')).toBeTruthy();
  expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy();
  expect(screen.getByLabelText('Unsaved Site visit JPEG preview').props.source.uri).toBe(local.uri);
});

test('multiple local photos; a canceled selection does not erase existing previews', async () => {
  picker.mockResolvedValueOnce(image as never).mockResolvedValueOnce(null).mockResolvedValueOnce(image as never);
  render(<PhotoStagingSection {...props} />);
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Photo label: Client-provided'));
  fireEvent.press(screen.getByText('Choose from Gallery'));
  await waitFor(() => expect(picker).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy();
  fireEvent.press(screen.getByText('Choose from Gallery'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(2\)/)).toBeTruthy());
  expect(process).toHaveBeenLastCalledWith(image, 'client_provided', { projectId: 'p1', taskId: null });
});

test('failed processing preserves existing previews and label for another selection', async () => {
  process.mockResolvedValueOnce(local).mockRejectedValueOnce(new Error('Native failure'));
  render(<PhotoStagingSection {...props} taskId="t7" />);
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Photo label: Client-provided'));
  fireEvent.press(screen.getByText('Choose from Gallery'));
  await waitFor(() => expect(screen.getByText('Native failure')).toBeTruthy());
  expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy();
  expect(screen.getByLabelText('Photo label: Client-provided, selected')).toBeTruthy();
  expect(process).toHaveBeenNthCalledWith(1, image, 'site_visit', { projectId: 'p1', taskId: 't7' });
});

test('account/project/task scope change immediately hides previous staged photos', async () => {
  const ui = render(<PhotoStagingSection {...props} />);
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy());
  await act(async () => { ui.rerender(<PhotoStagingSection {...props} accountId="b" accountScope={2} />); });
  expect(screen.queryByText('NOT SAVED — local preview only')).toBeNull();
  await act(async () => { ui.rerender(<PhotoStagingSection {...props} projectId="p2" />); });
  expect(screen.queryByText('NOT SAVED — local preview only')).toBeNull();
});

test('uploads exact staged association and clears preview ONLY after metadata commits', async () => {
  let complete!: (value: any) => void;
  jest.mocked(recoverPendingUpload).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const saved = jest.fn();
  render(<PhotoStagingSection {...props} taskId="t7" onSaved={saved} />);
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Upload photo f'));
  expect(jest.mocked(recoverPendingUpload)).toHaveBeenCalledWith('a',
    { id: 'f', createdAt: 'now', photo: { ...local } }, expect.any(Function));
  expect(screen.getByText('NOT SAVED — local preview only')).toBeTruthy();
  expect(screen.getByText(/Uploading photo…/)).toBeTruthy();
  await act(async () => { complete({}); });
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('NOT SAVED — local preview only')).toBeNull();
});

test('metadata failure keeps unsaved preview and offers explicit retry', async () => {
  jest.mocked(recoverPendingUpload).mockRejectedValueOnce(new Error('Metadata missing'));
  render(<PhotoStagingSection {...props} />);
  fireEvent.press(screen.getByLabelText('Photo label: Site visit'));
  fireEvent.press(screen.getByText('Take Photo'));
  await waitFor(() => expect(screen.getByText(/Unsaved photo previews \(1\)/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Upload photo f'));
  await waitFor(() => expect(screen.getByText(/Metadata missing/)).toBeTruthy());
  expect(screen.getByText('NOT SAVED — local preview only')).toBeTruthy();
  expect(screen.getByLabelText('Retry upload f')).toBeTruthy();
});
