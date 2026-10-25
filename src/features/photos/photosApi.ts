import { File, UploadType } from 'expo-file-system';
import { getBackendConfiguration } from '../../config/env';
import { loadPendingPhotos, type PendingPhoto } from './photoQueue';
import * as Crypto from 'expo-crypto';
import { getSupabaseClient, isCurrentSupabaseClient, type SiteQuoteClient } from '../../lib/supabase';
import { PHOTO_MAX_BYTES, type StagedPhoto } from '../../lib/photoProcessing';
import { validateServerSession } from '../auth/sessionValidation';

export const PHOTO_BUCKET = 'project-site-photos';
export const PHOTO_URL_LIFETIME_SECONDS = 300;

export type SavedPhoto = {
  id: string; user_id: string; project_id: string; task_id: string | null;
  storage_path: string; source: 'site_visit' | 'client_provided';
  state: 'active' | 'deleting'; created_at: string; updated_at: string;
};

export class PhotoFailure extends Error {
  constructor(public readonly reason: 'configuration' | 'session' | 'not_found' | 'invalid' |
    'storage' | 'metadata' | 'read' | 'delete') {
    super(reason);
    this.name = 'PhotoFailure';
  }
}
export function photoFailureMessage(error: unknown): string {
  if (error instanceof PhotoFailure) {
    switch (error.reason) {
      case 'configuration': return 'Supabase is not configured.';
      case 'session': return 'Session unavailable. Sign in again.';
      case 'not_found': return 'Project or task unavailable to this account.';
      case 'invalid': return 'Processed JPEG is invalid. Choose and process another photo.';
      case 'storage': return 'Could not upload the photo. Check your connection and storage access.';
      case 'metadata': return 'The file is staged but the photo record was not confirmed. Retry to recover without another copy.';
      case 'read': return 'Could not load private photos. Check your connection and access.';
      case 'delete': return 'Photo removal is incomplete. Retry cleanup when connected.';
    }
  }
  return 'Photo operation failed. Check your connection.';
}

type Authorized = { client: SiteQuoteClient; token: string };
async function authorize(userId: string): Promise<Authorized> {
  const client = getSupabaseClient();
  if (!client) throw new PhotoFailure('configuration');
  try {
    const session = await validateServerSession(client);
    if (!session || session.userId !== userId || !isCurrentSupabaseClient(client)) throw new Error('session');
    return { client, token: session.accessToken };
  } catch { throw new PhotoFailure('session'); }
}
async function ensureCurrent(auth: Authorized, userId: string): Promise<void> {
  if (!isCurrentSupabaseClient(auth.client)) throw new PhotoFailure('session');
  try {
    const session = await validateServerSession(auth.client, undefined, auth.token);
    if (!session || session.userId !== userId || !isCurrentSupabaseClient(auth.client)) throw new Error('session');
  } catch { throw new PhotoFailure('session'); }
}

async function assertTarget(client: SiteQuoteClient, userId: string, projectId: string, taskId: string | null) {
  const project = await client.from('projects').select('id').eq('user_id', userId)
    .eq('id', projectId).maybeSingle();
  if (project.error) throw new PhotoFailure('read');
  if (!project.data) throw new PhotoFailure('not_found');
  if (taskId) {
    const task = await client.from('project_tasks').select('id').eq('user_id', userId)
      .eq('project_id', projectId).eq('id', taskId).maybeSingle();
    if (task.error) throw new PhotoFailure('read');
    if (!task.data) throw new PhotoFailure('not_found');
  }
}

/** Only freshly processed JPEG bytes are sent; never a multipart RN File/Blob. */
export async function uploadStagedPhoto(userId: string, target: { projectId: string; taskId: string | null }, photo: StagedPhoto): Promise<SavedPhoto> {
  if (photo.projectId !== target.projectId || photo.taskId !== target.taskId ||
    !['site_visit', 'client_provided'].includes(photo.source) || photo.mimeType !== 'image/jpeg' ||
    !photo.uri.startsWith('file://') || !Number.isInteger(photo.width) || !Number.isInteger(photo.height) ||
    photo.width < 1 || photo.height < 1 || Math.max(photo.width, photo.height) > 2048 ||
    !Number.isSafeInteger(photo.sizeBytes) || photo.sizeBytes < 3 || photo.sizeBytes > PHOTO_MAX_BYTES) {
    throw new PhotoFailure('invalid');
  }
  const auth = await authorize(userId);
  await assertTarget(auth.client, userId, target.projectId, target.taskId);
  // Avoid an upload after the owner changes while validating the target.
  await ensureCurrent(auth, userId);
  let bytes: ArrayBuffer;
  try {
    const file = new File(photo.uri);
    if (!file.exists || file.size !== photo.sizeBytes || file.size > PHOTO_MAX_BYTES) throw new Error('size');
    bytes = await file.arrayBuffer();
    const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
    if (bytes.byteLength !== photo.sizeBytes || head.length !== 3 ||
      head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new Error('jpeg');
  } catch { throw new PhotoFailure('invalid'); }
  await ensureCurrent(auth, userId);
  const id = Crypto.randomUUID();
  const storagePath = `${userId}/${target.projectId}/${id}.jpg`;
  const storage = auth.client.storage.from(PHOTO_BUCKET);
  const uploaded = await storage.upload(storagePath, bytes, {
    contentType: 'image/jpeg', upsert: false, cacheControl: '300'
  });
  if (uploaded.error) throw new PhotoFailure('storage');
  // A session change after the successful Storage write must never result in a
  // metadata write using a different identity. An orphan is a Phase 2C concern.
  await ensureCurrent(auth, userId);
  const inserted = await auth.client.from('project_photos').insert({
    id, user_id: userId, project_id: target.projectId, task_id: target.taskId,
    source: photo.source, storage_path: storagePath
  }).select('id,user_id,project_id,task_id,storage_path,source,state,created_at,updated_at').single();
  if (inserted.error || !inserted.data) throw new PhotoFailure('metadata');
  await ensureCurrent(auth, userId);
  return inserted.data as SavedPhoto;
}

/** Returns metadata only; RLS + exact project/task filter also enforced server-side. */
export async function listSavedPhotos(userId: string, projectId: string, taskId?: string): Promise<SavedPhoto[]> {
  const auth = await authorize(userId);
  await assertTarget(auth.client, userId, projectId, taskId ?? null);
  const result: SavedPhoto[] = [];
  for (let offset = 0; ; offset += 200) {
    let query = auth.client.from('project_photos')
      .select('id,user_id,project_id,task_id,storage_path,source,state,created_at,updated_at')
      .eq('user_id', userId).eq('project_id', projectId).eq('state', 'active')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 199);
    if (taskId !== undefined) query = query.eq('task_id', taskId);
    const { data, error } = await query;
    if (error) throw new PhotoFailure('read');
    const page = (data ?? []) as SavedPhoto[];
    result.push(...page);
    if (page.length < 200) break;
  }
  await ensureCurrent(auth, userId);
  return result;
}

/** A different, short-lived private URL is requested on EVERY full-screen open/change. */
export async function signPhotoUrl(userId: string, photo: SavedPhoto): Promise<string> {
  if (photo.user_id !== userId || photo.state !== 'active' ||
    photo.storage_path !== `${photo.user_id}/${photo.project_id}/${photo.id}.jpg`) {
    throw new PhotoFailure('not_found');
  }
  const auth = await authorize(userId);
  const { data, error } = await auth.client.storage.from(PHOTO_BUCKET)
    .createSignedUrl(photo.storage_path, PHOTO_URL_LIFETIME_SECONDS);
  if (error || !data?.signedUrl) throw new PhotoFailure('read');
  await ensureCurrent(auth, userId);
  return data.signedUrl;
}


const PHOTO_COLUMNS = 'id,user_id,project_id,task_id,storage_path,source,state,created_at,updated_at';
const pathFor = (userId: string, projectId: string, id: string) => `${userId}/${projectId}/${id}.jpg`;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const oldEnoughForCleanup = (timestamp: string | null | undefined) => {
  const createdAt = Date.parse(timestamp ?? '');
  return Number.isFinite(createdAt) && Date.now() - createdAt > ORPHAN_MIN_AGE_MS;
};

async function findPhoto(client: SiteQuoteClient, userId: string, id: string): Promise<SavedPhoto | null> {
  const { data, error } = await client.from('project_photos').select(PHOTO_COLUMNS)
    .eq('user_id', userId).eq('id', id).maybeSingle();
  if (error) throw new PhotoFailure('read');
  return data as SavedPhoto | null;
}
function assertSamePhoto(record: SavedPhoto, userId: string, pending: PendingPhoto) {
  if (record.id !== pending.id || record.user_id !== userId ||
      record.project_id !== pending.photo.projectId || record.task_id !== pending.photo.taskId ||
      record.source !== pending.photo.source ||
      record.storage_path !== pathFor(userId, pending.photo.projectId, pending.id) || record.state !== 'active') {
    throw new PhotoFailure('not_found');
  }
}
async function existsInStorage(auth: Authorized, path: string): Promise<boolean> {
  const folder = path.slice(0, path.lastIndexOf('/'));
  const filename = path.slice(path.lastIndexOf('/') + 1);
  const { data, error } = await auth.client.storage.from(PHOTO_BUCKET)
    .list(folder, { search: filename, limit: 100 });
  if (error) throw new PhotoFailure('storage');
  return (data ?? []).some((entry) => entry.name === filename);
}

/** Crash-recoverable upload: one journal UUID, never upsert or allocate an ID on retry.
 * A previous Storage-only success is reconciled to metadata instead of uploaded again.
 * Progress is native bytes SENT (100% does not imply metadata committed).
 */
export async function recoverPendingUpload(userId: string, pending: PendingPhoto,
  onProgress?: (percent: number) => void): Promise<SavedPhoto> {
  const photo = pending.photo;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pending.id) ||
      !['site_visit', 'client_provided'].includes(photo.source) || photo.mimeType !== 'image/jpeg' ||
      !photo.uri.startsWith('file://') || !Number.isInteger(photo.width) || !Number.isInteger(photo.height) ||
      photo.width < 1 || photo.height < 1 || Math.max(photo.width, photo.height) > 2048 ||
      !Number.isSafeInteger(photo.sizeBytes) || photo.sizeBytes < 3 || photo.sizeBytes > PHOTO_MAX_BYTES) {
    throw new PhotoFailure('invalid');
  }
  const auth = await authorize(userId);
  await assertTarget(auth.client, userId, photo.projectId, photo.taskId);
  await ensureCurrent(auth, userId);
  const already = await findPhoto(auth.client, userId, pending.id);
  if (already) { assertSamePhoto(already, userId, pending); await ensureCurrent(auth, userId); onProgress?.(100); return already; }
  const path = pathFor(userId, photo.projectId, pending.id);
  const objectExists = await existsInStorage(auth, path);
  if (!objectExists) {
    let file: File;
    try {
      file = new File(photo.uri);
      if (!file.exists || file.size !== photo.sizeBytes) throw new Error('missing');
      const bytes = await file.arrayBuffer();
      const header = new Uint8Array(bytes, 0, 3);
      if (bytes.byteLength !== photo.sizeBytes || header.length !== 3 ||
          header[0] !== 255 || header[1] !== 216 || header[2] !== 255) throw new Error('jpeg');
    } catch { throw new PhotoFailure('invalid'); }
    await ensureCurrent(auth, userId);
    const config = getBackendConfiguration();
    if (config.status !== 'ready') throw new PhotoFailure('configuration');
    try {
      // Native binary upload supplies actual network byte progress; SDK .upload() does not.
      // No upsert; on uncertain connection failure the next retry probes Storage first.
      const endpoint = `${config.url.replace(/\/$/, '')}/storage/v1/object/${PHOTO_BUCKET}/${path}`;
      const transfer = file.createUploadTask(endpoint, {
        httpMethod: 'POST', uploadType: UploadType.BINARY_CONTENT, mimeType: 'image/jpeg',
        headers: { Authorization: `Bearer ${auth.token}`, apikey: config.publishableKey,
          'content-type': 'image/jpeg', 'cache-control': '300', 'x-upsert': 'false' },
        onProgress: ({ bytesSent, totalBytes }) => {
          if (totalBytes > 0 && isCurrentSupabaseClient(auth.client))
            onProgress?.(Math.max(0, Math.min(99, Math.round(bytesSent * 100 / totalBytes))));
        }
      });
      const result = await transfer.uploadAsync();
      if (!result || result.status < 200 || result.status >= 300) {
        // 409 may be a previous successful upload; confirmed via existence below.
        if (!(await existsInStorage(auth, path))) throw new PhotoFailure('storage');
      }
    } catch (error) {
      if (!(await existsInStorage(auth, path).catch(() => false))) {
        if (error instanceof PhotoFailure) throw error;
        throw new PhotoFailure('storage');
      }
    }
  }
  await ensureCurrent(auth, userId);
  // If an earlier request committed but the response was lost, return that exact row.
  const committed = await findPhoto(auth.client, userId, pending.id);
  if (committed) { assertSamePhoto(committed, userId, pending); onProgress?.(100); return committed; }
  const { data, error } = await auth.client.from('project_photos').insert({
    id: pending.id, user_id: userId, project_id: photo.projectId, task_id: photo.taskId,
    source: photo.source, storage_path: path
  }).select(PHOTO_COLUMNS).single();
  if (error || !data) {
    // Database might have committed before a connection loss or concurrent same-ID attempt.
    const recovered = await findPhoto(auth.client, userId, pending.id).catch(() => null);
    if (!recovered) throw new PhotoFailure('metadata');
    assertSamePhoto(recovered, userId, pending);
    await ensureCurrent(auth, userId);
    onProgress?.(100);
    return recovered;
  }
  await ensureCurrent(auth, userId);
  onProgress?.(100);
  return data as SavedPhoto;
}

/** Two-phase owner-only delete. Partial failures deliberately retain `deleting` rows. */
export async function deleteSavedPhoto(userId: string, photo: SavedPhoto): Promise<void> {
  if (photo.user_id !== userId || photo.storage_path !== pathFor(userId, photo.project_id, photo.id))
    throw new PhotoFailure('not_found');
  const auth = await authorize(userId);
  const existing = await findPhoto(auth.client, userId, photo.id);
  if (!existing) return; // already removed (idempotent)
  if (existing.storage_path !== photo.storage_path || existing.project_id !== photo.project_id ||
      existing.task_id !== photo.task_id) throw new PhotoFailure('not_found');
  if (existing.state === 'active') {
    await ensureCurrent(auth, userId);
    const marked = await auth.client.from('project_photos').update({ state: 'deleting' })
      .eq('user_id', userId).eq('id', photo.id).eq('state', 'active').select('id').maybeSingle();
    if (marked.error || !marked.data) throw new PhotoFailure('delete');
  }
  await ensureCurrent(auth, userId);
  const removed = await auth.client.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
  if (removed.error) {
    // Some Storage versions return an error for a file already removed on a prior attempt.
    // Only consider it removed after an authenticated owner-scoped existence check.
    if (await existsInStorage(auth, photo.storage_path).catch(() => true)) throw new PhotoFailure('delete');
  }
  // A successful Storage API response can still contain zero removed objects.
  // Never attempt to finalize metadata unless an authenticated listing confirms absence.
  if (await existsInStorage(auth, photo.storage_path).catch(() => true)) throw new PhotoFailure('delete');
  await ensureCurrent(auth, userId);
  const deleted = await auth.client.from('project_photos').delete().eq('user_id', userId)
    .eq('id', photo.id).eq('state', 'deleting').select('id').maybeSingle();
  if (deleted.error || !deleted.data) throw new PhotoFailure('delete');
  await ensureCurrent(auth, userId);
}

export async function listTaskPhotosForDeletion(userId: string, projectId: string, taskId: string): Promise<SavedPhoto[]> {
  const auth = await authorize(userId);
  await assertTarget(auth.client, userId, projectId, taskId);
  const rows: SavedPhoto[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await auth.client.from('project_photos').select(PHOTO_COLUMNS)
      .eq('user_id', userId).eq('project_id', projectId).eq('task_id', taskId)
      .order('id', { ascending: true }).range(offset, offset + 199);
    if (error) throw new PhotoFailure('read');
    const page = (data ?? []) as SavedPhoto[];
    rows.push(...page);
    if (page.length < 200) break;
  }
  await ensureCurrent(auth, userId);
  return rows;
}

/** Enumerate every task so the server's row cap cannot hide a local upload
 * journal and cause repair to report a pending upload as untracked. */
async function listProjectTaskIdsForCleanup(client: SiteQuoteClient, userId: string, projectId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client.from('project_tasks').select('id')
      .eq('user_id', userId).eq('project_id', projectId)
      .order('id', { ascending: true }).range(offset, offset + 199);
    if (error) throw new PhotoFailure('read');
    const page = data ?? [];
    ids.push(...page.map((row) => row.id as string));
    if (page.length < 200) return ids;
  }
}

/** Best-effort owner-scoped repair, invoked explicitly from a project gallery.
 * Completes explicitly requested deletions. Counts old untracked objects in
 * `orphaned`, but retains them: another installation may still be uploading.
 * Safe reclamation requires server-coordinated upload reservations.
 */
export async function cleanupProjectPhotos(userId: string, projectId: string): Promise<{ recovered: number; orphaned: number }> {
  const auth = await authorize(userId);
  await assertTarget(auth.client, userId, projectId, null);
  const rows: SavedPhoto[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await auth.client.from('project_photos').select(PHOTO_COLUMNS)
      .eq('user_id', userId).eq('project_id', projectId).order('id', { ascending: true })
      .range(offset, offset + 199);
    if (error) throw new PhotoFailure('read');
    rows.push(...(data ?? []) as SavedPhoto[]);
    if (!data || data.length < 200) break;
  }
  let recovered = 0;
  for (const row of rows.filter((p) => p.state === 'deleting')) {
    await ensureCurrent(auth, userId);
    await deleteSavedPhoto(userId, row);
    recovered++;
  }
  // List all project tasks, including those beyond the first PostgREST result page.
  const taskIds = await listProjectTaskIdsForCleanup(auth.client, userId, projectId);
  const pending = await Promise.all([null, ...taskIds]
    .map((taskId) => loadPendingPhotos(userId, projectId, taskId)));
  const reserved = new Set(pending.flat().map((entry) => `${entry.id}.jpg`));
  const occupied = new Set(rows.map((r) => `${r.id}.jpg`));
  const folder = `${userId}/${projectId}`;
  let orphaned = 0;
  const candidates: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await auth.client.storage.from(PHOTO_BUCKET)
      .list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new PhotoFailure('storage');
    // Collect candidates before rechecking their current metadata and journals.
    for (const item of data ?? []) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(item.name) &&
          !occupied.has(item.name) && !reserved.has(item.name) &&
          oldEnoughForCleanup(item.created_at)) {
        candidates.push(item.name);
      }
    }
    if (!data || data.length < 100) break;
    if (offset >= 4900) throw new PhotoFailure('read');
  }
  for (const filename of candidates) {
    await ensureCurrent(auth, userId);
    // Refresh the task list + local journals, not just the initial snapshot: another
    // screen can stage the same project while pagination/signing is in progress.
    // Fail closed if either query fails; do not misreport a pending upload.
    const freshTaskIds = await listProjectTaskIdsForCleanup(auth.client, userId, projectId);
    const latestPending = await Promise.all([null, ...freshTaskIds]
      .map((taskId) => loadPendingPhotos(userId, projectId, taskId)));
    if (latestPending.some((entries) => entries.some((entry) => `${entry.id}.jpg` === filename))) continue;
    const latestObject = await auth.client.storage.from(PHOTO_BUCKET)
      .list(folder, { search: filename, limit: 100 });
    if (latestObject.error) throw new PhotoFailure('storage');
    const object = (latestObject.data ?? []).find((entry) => entry.name === filename);
    if (!object || !oldEnoughForCleanup(object.created_at)) continue;
    if (await findPhoto(auth.client, userId, filename.slice(0, -4))) continue;
    await ensureCurrent(auth, userId);
    // Local journals cannot establish that an upload on another device was
    // abandoned. Retain its bytes regardless of age; only `deleting` metadata
    // above supplies explicit, shared intent to remove a saved photo.
    orphaned++;
  }
  await ensureCurrent(auth, userId);
  return { recovered, orphaned };
}
