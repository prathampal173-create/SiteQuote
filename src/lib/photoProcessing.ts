import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

export const PHOTO_MAX_EDGE = 2048;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

// Only formats that native image decoders can reasonably convert to a still JPEG.
// Actual support for HEIC/AVIF/WEBP varies by device; failures are handled below.
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/avif'
]);

export type PhotoSourceLabel = 'site_visit' | 'client_provided';
export const PHOTO_SOURCE_LABELS: Record<PhotoSourceLabel, string> = {
  site_visit: 'Site visit',
  client_provided: 'Client-provided'
};

export type PhotoAssociation = { projectId: string; taskId: string | null };
export type StagedPhoto = PhotoAssociation & {
  uri: string;
  source: PhotoSourceLabel;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  sizeBytes: number;
};

export class PhotoProcessingError extends Error {
  constructor(public readonly reason: 'unsupported' | 'processing' | 'too_large') {
    super(reason === 'unsupported' ? 'Unsupported image. Select a JPEG, PNG, HEIC, WEBP or AVIF photo.'
      : reason === 'too_large' ? 'This image could not be compressed below 10 MB.'
        : 'Could not process this image. Select another photo and try again.');
    this.name = 'PhotoProcessingError';
  }
}

/** Choose one dimension so native resize calculates the other, preserving aspect ratio. */
export function boundedDimensions(width: number, height: number, edge = PHOTO_MAX_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PhotoProcessingError('unsupported');
  }
  const longest = Math.max(width, height);
  const scale = Math.min(1, edge / longest);
  // Keep the bounded long edge exact: multiplying by a floating ratio can
  // turn 2048 into 2047.9999999999998 for otherwise ordinary photo sizes.
  return { width: Math.max(1, width === longest ? Math.min(width, edge) : Math.floor(width * scale)),
    height: Math.max(1, height === longest ? Math.min(height, edge) : Math.floor(height * scale)) };
}

export function assertPhotoAsset(asset: Pick<ImagePickerAsset, 'type' | 'uri' | 'mimeType'>): void {
  if ((asset.type != null && asset.type !== 'image') || !asset.uri ||
    (asset.mimeType != null && !IMAGE_MIME_TYPES.has(asset.mimeType.toLowerCase()))) {
    throw new PhotoProcessingError('unsupported');
  }
}

/**
 * Convert the decoded, orientation-applied native image to a bounded JPEG.
 * Cache files are intentionally ephemeral; no upload/DB write or photo cleanup in 2A.
 * Re-check native dimensions, byte count and JPEG header rather than trusting picker metadata.
 */
export async function processPhoto(
  asset: ImagePickerAsset, source: PhotoSourceLabel, target: PhotoAssociation
): Promise<StagedPhoto> {
  assertPhotoAsset(asset);
  try {
    // Decoding through native manipulator applies the device's image orientation;
    // use its dimensions (not EXIF/picker-reported dimensions) for the resize.
    const originalContext = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const decoded = await originalContext.renderAsync();
    const dimensions = boundedDimensions(decoded.width, decoded.height);
    let edge = Math.max(dimensions.width, dimensions.height);

    for (let reduction = 0; reduction < 6; reduction++) {
      const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
      const targetSize = boundedDimensions(decoded.width, decoded.height, edge);
      if (targetSize.width !== decoded.width || targetSize.height !== decoded.height) {
        // Set just the long edge; the other side is derived by the native image pipeline.
        if (decoded.width >= decoded.height) context.resize({ width: targetSize.width, height: null });
        else context.resize({ width: null, height: targetSize.height });
      }
      const image = await context.renderAsync();
      if (image.width > PHOTO_MAX_EDGE || image.height > PHOTO_MAX_EDGE ||
        image.width > decoded.width || image.height > decoded.height || image.width <= 0 || image.height <= 0) {
        throw new PhotoProcessingError('processing');
      }
      for (const quality of [0.85, 0.65, 0.45, 0.25]) {
        const result = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: quality });
        const file = new File(result.uri);
        const bytes = file.size;
        if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new PhotoProcessingError('processing');
        if (bytes > PHOTO_MAX_BYTES) continue;
        // Check the actual file's JPEG SOI signature, not only its extension/MIME label.
        const handle = file.open();
        let header: Uint8Array;
        try { header = handle.readBytes(3); } finally { handle.close(); }
        if (header.length < 3 || header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
          throw new PhotoProcessingError('processing');
        }
        if (result.width !== image.width || result.height !== image.height) {
          throw new PhotoProcessingError('processing');
        }
        return { ...target, source, uri: result.uri, mimeType: 'image/jpeg',
          width: result.width, height: result.height, sizeBytes: bytes };
      }
      // Only downscale, never upscale; a small uncompressible image fails closed.
      if (edge <= 320) break;
      edge = Math.max(320, Math.floor(edge * 0.75));
    }
    throw new PhotoProcessingError('too_large');
  } catch (error) {
    if (error instanceof PhotoProcessingError) throw error;
    throw new PhotoProcessingError('processing');
  }
}
