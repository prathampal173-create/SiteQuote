import * as ImagePicker from 'expo-image-picker';
import { assertPhotoAsset } from '../../lib/photoProcessing';

export type PhotoInput = 'camera' | 'gallery';

export class PhotoSelectionError extends Error {
  constructor(public readonly reason: 'permission' | 'picker' | 'unsupported', input: PhotoInput) {
    super(reason === 'permission'
      ? `${input === 'camera' ? 'Camera' : 'Photo library'} access was denied. Enable it in device settings to add a photo.`
      : reason === 'unsupported' ? 'Unsupported image. Select a supported still photo.'
        : `Could not open the ${input === 'camera' ? 'camera' : 'photo library'}. Try again.`);
    this.name = 'PhotoSelectionError';
  }
}

/** Null means the picker was cancelled: existing staged photos must be preserved. */
export async function selectPhoto(input: PhotoInput): Promise<ImagePicker.ImagePickerAsset | null> {
  try {
    const permission = input === 'camera' ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted && !('accessPrivileges' in permission && permission.accessPrivileges === 'limited')) {
      throw new PhotoSelectionError('permission', input);
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false,
      allowsMultipleSelection: false
    };
    const result = input === 'camera' ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) throw new PhotoSelectionError('unsupported', input);
    try { assertPhotoAsset(asset); } catch { throw new PhotoSelectionError('unsupported', input); }
    return asset;
  } catch (error) {
    if (error instanceof PhotoSelectionError) throw error;
    throw new PhotoSelectionError('picker', input);
  }
}
