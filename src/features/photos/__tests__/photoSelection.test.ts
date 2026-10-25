import * as ImagePicker from 'expo-image-picker';
import { selectPhoto } from '../photoSelection';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn()
}));
const cameraPermission = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const galleryPermission = jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync);
const camera = jest.mocked(ImagePicker.launchCameraAsync);
const gallery = jest.mocked(ImagePicker.launchImageLibraryAsync);

beforeEach(() => {
  jest.resetAllMocks();
  cameraPermission.mockResolvedValue({ granted: true } as never);
  galleryPermission.mockResolvedValue({ granted: true } as never);
  camera.mockResolvedValue({ canceled: true, assets: null });
  gallery.mockResolvedValue({ canceled: true, assets: null });
});

test('camera and gallery use images-only picker without crop, preserve cancellation as null', async () => {
  expect(await selectPhoto('camera')).toBeNull();
  expect(await selectPhoto('gallery')).toBeNull();
  expect(camera).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsEditing: false }));
  expect(gallery).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsEditing: false }));
});

test('permissions denied; limited library accepted', async () => {
  cameraPermission.mockResolvedValueOnce({ granted: false } as never);
  await expect(selectPhoto('camera')).rejects.toMatchObject({ reason: 'permission' });
  expect(camera).not.toHaveBeenCalled();
  galleryPermission.mockResolvedValueOnce({ granted: false, accessPrivileges: 'none' } as never);
  await expect(selectPhoto('gallery')).rejects.toMatchObject({ reason: 'permission' });
  galleryPermission.mockResolvedValueOnce({ granted: false, accessPrivileges: 'limited' } as never);
  expect(await selectPhoto('gallery')).toBeNull();
});

test('valid still returned; unexpected media and picker exceptions are handled', async () => {
  gallery.mockResolvedValueOnce({ canceled: false, assets: [
    { type: 'image', uri: 'file:///photo.png', mimeType: 'image/png', width: 500, height: 400 }
  ] } as never);
  expect((await selectPhoto('gallery'))?.uri).toBe('file:///photo.png');
  gallery.mockResolvedValueOnce({ canceled: false, assets: [
    { type: 'video', uri: 'file:///video.mov', mimeType: 'video/quicktime' }
  ] } as never);
  await expect(selectPhoto('gallery')).rejects.toMatchObject({ reason: 'unsupported' });
  camera.mockRejectedValueOnce(new Error('unavailable'));
  await expect(selectPhoto('camera')).rejects.toMatchObject({ reason: 'picker' });
});
