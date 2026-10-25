import { File } from 'expo-file-system';
import { ImageManipulator } from 'expo-image-manipulator';
import { assertPhotoAsset, boundedDimensions, PHOTO_MAX_BYTES, processPhoto, PhotoProcessingError }
  from '../photoProcessing';
import type { ImagePickerAsset } from 'expo-image-picker';

const mockSave = jest.fn();
const mockRender = jest.fn();
const mockResize = jest.fn();
const mockManipulate = jest.fn();
const mockFile = jest.fn();
const mockHeader = jest.fn();
const mockClose = jest.fn();

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' }
}));

const asset = { uri: 'file:///source.heic', type: 'image', mimeType: 'image/heic', width: 4032, height: 3024 } as ImagePickerAsset;
const target = { projectId: 'project-1', taskId: null };

beforeEach(() => {
  jest.resetAllMocks();
  mockHeader.mockReturnValue(Uint8Array.from([0xff, 0xd8, 0xff]));
  mockFile.mockImplementation(() => ({ size: 2_000_000, open: () => ({ readBytes: mockHeader, close: mockClose }) }));
  jest.mocked(File).mockImplementation(mockFile);
  mockSave.mockResolvedValue({ uri: 'file:///output.jpg', width: 2048, height: 1536 });
  mockRender.mockResolvedValue({ width: 4032, height: 3024, saveAsync: mockSave });
  mockResize.mockImplementation(() => {});
  mockManipulate.mockImplementation(() => ({ renderAsync: mockRender, resize: mockResize }));
  jest.mocked(ImageManipulator.manipulate).mockImplementation(mockManipulate);
});

test('long-edge calculations preserve landscape/portrait aspect and do not upscale', () => {
  expect(boundedDimensions(4032, 3024)).toEqual({ width: 2048, height: 1536 });
  expect(boundedDimensions(1500, 1000)).toEqual({ width: 1500, height: 1000 });
  expect(boundedDimensions(600, 4000)).toEqual({ width: 307, height: 2048 });
  expect(() => boundedDimensions(0, 10)).toThrow(PhotoProcessingError);
});

test.each([3400, 4032, 6016, 8000])('SQ-QA-005: %i-pixel images keep the exact bounded long edge', (longEdge) => {
  expect(boundedDimensions(longEdge, 700).width).toBe(2048);
  expect(boundedDimensions(700, longEdge).height).toBe(2048);
  expect(boundedDimensions(longEdge, longEdge)).toEqual({ width: 2048, height: 2048 });
});

test('converted JPEG has checked signature, dimensions, size and direct project target', async () => {
  mockRender.mockResolvedValueOnce({ width: 4032, height: 3024, saveAsync: mockSave })
    .mockResolvedValueOnce({ width: 2048, height: 1536, saveAsync: mockSave });
  expect(await processPhoto(asset, 'site_visit', target)).toEqual({ ...target, source: 'site_visit',
    uri: 'file:///output.jpg', mimeType: 'image/jpeg', width: 2048, height: 1536, sizeBytes: 2_000_000 });
  expect(mockResize).toHaveBeenCalledWith({ width: 2048, height: null });
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.85 });
  expect(mockHeader).toHaveBeenCalledWith(3);
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('portrait native decoded dimensions are used, and distinct task target is retained', async () => {
  mockRender.mockResolvedValueOnce({ width: 700, height: 3400, saveAsync: mockSave })
    .mockResolvedValueOnce({ width: 422, height: 2048, saveAsync: mockSave });
  mockSave.mockResolvedValueOnce({ uri: 'file:///portrait.jpg', width: 422, height: 2048 });
  const photo = await processPhoto(asset, 'client_provided', { projectId: 'project-1', taskId: 'task-2' });
  expect(photo.taskId).toBe('task-2');
  expect(photo.source).toBe('client_provided');
  expect(mockResize).toHaveBeenCalledWith({ width: null, height: 2048 });
});

test('smaller native photos never resize upward', async () => {
  mockRender.mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave })
    .mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave });
  mockSave.mockResolvedValueOnce({ uri: 'file:///small.jpg', width: 800, height: 600 });
  const photo = await processPhoto(asset, 'site_visit', target);
  expect(photo.width).toBe(800);
  expect(mockResize).not.toHaveBeenCalled();
});

test('large JPEG is recompressed with reduced quality before staging', async () => {
  mockRender.mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave })
    .mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave });
  mockSave.mockResolvedValue({ uri: 'file:///recompressed.jpg', width: 800, height: 600 });
  mockFile.mockImplementationOnce(() => ({ size: PHOTO_MAX_BYTES + 1 }))
    .mockImplementationOnce(() => ({ size: PHOTO_MAX_BYTES, open: () => ({ readBytes: mockHeader, close: mockClose }) }));
  const photo = await processPhoto(asset, 'site_visit', target);
  expect(photo.sizeBytes).toBe(PHOTO_MAX_BYTES);
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.65 });
});

test('if quality alone cannot fit, dimension shrinks; too-large output fails closed', async () => {
  mockRender.mockImplementation(async () => ({ width: 600, height: 400, saveAsync: mockSave }));
  mockSave.mockResolvedValue({ uri: 'file:///large.jpg', width: 600, height: 400 });
  mockFile.mockImplementation(() => ({ size: PHOTO_MAX_BYTES + 1 }));
  await expect(processPhoto(asset, 'site_visit', target)).rejects.toMatchObject({ reason: 'too_large' });
  expect(mockResize).toHaveBeenCalledWith({ width: 450, height: null });
});

test('bad formats, invalid headers and processing failures do not produce a photo', async () => {
  expect(() => assertPhotoAsset({ type: 'video', uri: 'file:///video.mp4', mimeType: 'video/mp4' }))
    .toThrow(PhotoProcessingError);
  expect(() => assertPhotoAsset({ type: 'image', uri: 'file:///vector.svg', mimeType: 'image/svg+xml' }))
    .toThrow(PhotoProcessingError);
  await expect(processPhoto({ ...asset, mimeType: 'image/gif' }, 'site_visit', target))
    .rejects.toMatchObject({ reason: 'unsupported' });
  mockRender.mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave })
    .mockResolvedValueOnce({ width: 800, height: 600, saveAsync: mockSave });
  mockSave.mockResolvedValueOnce({ uri: 'file:///wrong.bin', width: 800, height: 600 });
  mockHeader.mockReturnValueOnce(Uint8Array.from([0x00, 0x00, 0x00]));
  await expect(processPhoto(asset, 'site_visit', target)).rejects.toMatchObject({ reason: 'processing' });
  mockRender.mockRejectedValueOnce(new Error('native decoder broke'));
  await expect(processPhoto(asset, 'site_visit', target)).rejects.toMatchObject({ reason: 'processing' });
});
