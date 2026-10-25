import { File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import * as Crypto from 'expo-crypto';
import type { StagedPhoto } from '../../lib/photoProcessing';

export type PendingPhoto = { id: string; photo: StagedPhoto; createdAt: string };
const PREFIX = 'sitequote:photo-pending:v1';
const keyFor = (accountId: string, projectId: string, taskId: string | null) =>
  `${PREFIX}:${accountId}:${projectId}:${taskId ?? 'direct'}`;
const journal = (accountId: string, photo: StagedPhoto) => keyFor(accountId, photo.projectId, photo.taskId);

/** The sqlite journal stores only per-account metadata, never a signed URL. */
export async function loadPendingPhotos(accountId: string, projectId: string, taskId: string | null): Promise<PendingPhoto[]> {
  const raw = await Storage.getItem(keyFor(accountId, projectId, taskId));
  if (!raw) return [];
  const entries: unknown = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('Local photo recovery journal is damaged.');
  return entries.filter((entry): entry is PendingPhoto => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as PendingPhoto;
    return typeof e.id === 'string' && typeof e.createdAt === 'string' &&
      e.photo?.projectId === projectId && e.photo.taskId === taskId &&
      e.photo.mimeType === 'image/jpeg' && typeof e.photo.uri === 'string' &&
      e.photo.uri.startsWith('file://');
  });
}

/** Copy from the image-picker cache into durable app documents before journaling. */
export async function stagePendingPhoto(accountId: string, photo: StagedPhoto): Promise<PendingPhoto> {
  const id = Crypto.randomUUID();
  const file = new File(Paths.document, `sitequote-pending-${accountId}-${id}.jpg`);
  await new File(photo.uri).copy(file);
  const record = { id, createdAt: new Date().toISOString(), photo: { ...photo, uri: file.uri } };
  try {
    const current = await loadPendingPhotos(accountId, photo.projectId, photo.taskId);
    await Storage.setItem(journal(accountId, photo), JSON.stringify([...current, record]));
  } catch (error) {
    try { if (file.exists) file.delete(); } catch { /* retain original failure */ }
    throw error;
  }
  return record;
}

/** Commit journal removal BEFORE deleting the local image, to preserve retry after a crash. */
export async function clearPendingPhoto(accountId: string, record: PendingPhoto): Promise<void> {
  const existing = await loadPendingPhotos(accountId, record.photo.projectId, record.photo.taskId);
  await Storage.setItem(journal(accountId, record.photo), JSON.stringify(existing.filter((e) => e.id !== record.id)));
  try { const file = new File(record.photo.uri); if (file.exists) file.delete(); }
  catch { /* missing cache cleanup does not undo successful metadata commit */ }
}
