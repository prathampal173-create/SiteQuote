import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, radius, spacing } from '../../config/theme';
import { PHOTO_SOURCE_LABELS } from '../../lib/photoProcessing';
import { listProjectTasks } from '../tasks/tasksApi';
import { groupProjectPhotos, type PhotoGroup } from './photoGroups';
import { cleanupProjectPhotos, deleteSavedPhoto, listSavedPhotos, photoFailureMessage, signPhotoUrl, type SavedPhoto } from './photosApi';

type State = { scope: string; loading: boolean; error: string; groups: PhotoGroup[]; thumbs: Record<string, string | null> };
const empty = (scope: string): State => ({ scope, loading: false, error: '', groups: [], thumbs: {} });
type Viewer = { id: string; url: string | null; loading: boolean; error: string } | null;

export function PhotoGallerySection({ accountId, accountScope, projectId, taskId, refreshKey = 0 }: {
  accountId: string; accountScope: number; projectId: string; taskId?: string; refreshKey?: number;
}) {
  const scope = `${accountScope}:${accountId}:${projectId}:${taskId ?? 'project'}`;
  const [stored, setStored] = useState<State>(() => empty(scope));
  const [viewerStored, setViewerStored] = useState<{ scope: string; viewer: Viewer }>({ scope, viewer: null });
  const [failed, setFailed] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
  const generation = useRef(0);
  const viewerGeneration = useRef(0);
  const scopeRef = useRef(scope);
  const thumbCache = useRef<Record<string, { url: string; expires: number }>>({});
  const thumbScope = useRef(scope);
  const attemptedRenewals = useRef<Set<string>>(new Set());
  const busyDelete = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState('');
  scopeRef.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  const viewer = viewerStored.scope === scope ? viewerStored.viewer : null;
  const broken = failed.scope === scope ? failed.ids : [];

  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    setStored((current) => ({ ...(current.scope === scope ? current : empty(scope)), loading: true, error: '' }));
    try {
      const [photos, tasks] = await Promise.all([
        listSavedPhotos(accountId, projectId, taskId),
        taskId ? Promise.resolve([]) : listProjectTasks(accountId, projectId)
      ]);
      const groups = taskId
        ? [{ key: taskId, title: 'This task', photos: photos.filter((photo) => photo.task_id === taskId) }]
        : groupProjectPhotos(photos, tasks);
      const thumbs: Record<string, string | null> = {};
      // Signing each thumbnail independently keeps a missing object from hiding other photos.
      await Promise.all(photos.map(async (photo) => {
        const cached = thumbCache.current[photo.id];
        if (cached && cached.expires > Date.now()) { thumbs[photo.id] = cached.url; return; }
        try {
          const url = await signPhotoUrl(accountId, photo);
          thumbs[photo.id] = url;
          thumbCache.current[photo.id] = { url, expires: Date.now() + 240_000 };
        } catch { thumbs[photo.id] = null; }
      }));
      if (ticket !== generation.current || scopeRef.current !== scope) return;
      attemptedRenewals.current.clear();
      setFailed({ scope, ids: [] });
      setStored({ scope, groups, thumbs, error: '', loading: false });
    } catch (error) {
      if (ticket !== generation.current || scopeRef.current !== scope) return;
      setStored((current) => ({ ...(current.scope === scope ? current : empty(scope)),
        loading: false, error: photoFailureMessage(error) }));
    }
  }, [accountId, projectId, taskId, scope, refreshKey]);

  useFocusEffect(useCallback(() => {
    scopeRef.current = scope;
    setStored(empty(scope));
    setViewerStored({ scope, viewer: null });
    setFailed({ scope, ids: [] });
    if (thumbScope.current !== scope) {
      thumbScope.current = scope;
      thumbCache.current = {};
      attemptedRenewals.current.clear();
    }
    setCleanupMessage('');
    void reload();
    return () => { generation.current++; viewerGeneration.current++; scopeRef.current = ''; };
  }, [reload, scope]));

  // A thumbnail with a stale signed URL gets ONE on-error renewal; no render-loop requests.
  const renewThumbnail = async (photo: SavedPhoto) => {
    if (scopeRef.current !== scope) return;
    if (attemptedRenewals.current.has(photo.id)) {
      setFailed((prev) => prev.scope === scope ?
        { scope, ids: [...new Set([...prev.ids, photo.id])] } : prev);
      return;
    }
    attemptedRenewals.current.add(photo.id);
    delete thumbCache.current[photo.id];
    try {
      const url = await signPhotoUrl(accountId, photo);
      if (scopeRef.current !== scope) return;
      thumbCache.current[photo.id] = { url, expires: Date.now() + 240_000 };
      setStored((prev) => prev.scope === scope ?
        { ...prev, thumbs: { ...prev.thumbs, [photo.id]: url } } : prev);
    } catch {
      if (scopeRef.current === scope) setFailed((prev) => prev.scope === scope ?
        { scope, ids: [...new Set([...prev.ids, photo.id])] } : prev);
    }
  };
  const all = model.groups.flatMap((group) => group.photos);
  const activeIndex = viewer ? all.findIndex((photo) => photo.id === viewer.id) : -1;
  const openPhoto = async (photo: SavedPhoto) => {
    const ticket = ++viewerGeneration.current;
    setViewerStored({ scope, viewer: { id: photo.id, url: null, loading: true, error: '' } });
    try {
      const url = await signPhotoUrl(accountId, photo);
      if (ticket !== viewerGeneration.current || scopeRef.current !== scope) return;
      setViewerStored({ scope, viewer: { id: photo.id, url, loading: false, error: '' } });
    } catch (error) {
      if (ticket !== viewerGeneration.current || scopeRef.current !== scope) return;
      setViewerStored({ scope, viewer: { id: photo.id, url: null, loading: false,
        error: photoFailureMessage(error) } });
    }
  };
  const close = () => {
    viewerGeneration.current++;
    setViewerStored({ scope, viewer: null });
  };
  const currentPhoto = activeIndex >= 0 ? all[activeIndex] : null;
  const remove = async (photo: SavedPhoto) => {
    if (busyDelete.current || scopeRef.current !== scope) return;
    busyDelete.current = true;
    setDeletingId(photo.id);
    try {
      await deleteSavedPhoto(accountId, photo);
      if (scopeRef.current !== scope) return;
      close();
      delete thumbCache.current[photo.id];
      await reload();
    } catch (error) {
      if (scopeRef.current === scope) setViewerStored((prev) => prev.scope === scope ?
        { scope, viewer: { id: photo.id, url: null, loading: false, error: photoFailureMessage(error) } } : prev);
    } finally {
      busyDelete.current = false;
      if (scopeRef.current === scope) setDeletingId(null);
    }
  };
  const confirmDelete = (photo: SavedPhoto) => Alert.alert('Delete saved photo?',
    'This removes the photo from private Storage and this project. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Photo', style: 'destructive', onPress: () => void remove(photo) }
    ]);
  const cleanup = async () => {
    if (cleanupBusy || scopeRef.current !== scope) return;
    setCleanupBusy(true);
    setCleanupMessage('');
    try {
      const result = await cleanupProjectPhotos(accountId, projectId);
      if (scopeRef.current !== scope) return;
      setCleanupMessage(`Finished ${result.recovered} interrupted deletions. ${result.orphaned} untracked files kept because they may still be uploading on another device.`);
      await reload();
    } catch (error) {
      if (scopeRef.current === scope) setCleanupMessage(photoFailureMessage(error));
    } finally {
      if (scopeRef.current === scope) setCleanupBusy(false);
    }
  };

  return <AppCard>
    <AppText variant="section">Saved photo gallery</AppText>
    <AppText muted>Account-private images. Select a thumbnail to view full screen.</AppText>
    <AppButton variant="secondary" label={model.loading ? 'Loading photos…' : 'Refresh photos'}
      disabled={model.loading} onPress={() => void reload()} />
    {!taskId ? <AppButton variant="secondary" label={cleanupBusy ? 'Checking photo cleanup…' : 'Repair interrupted photo removals'}
      disabled={cleanupBusy || model.loading} onPress={() => void cleanup()} /> : null}
    {cleanupMessage ? <AppText accessibilityRole="alert">{cleanupMessage}</AppText> : null}
    {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
    {!model.loading && !model.error && all.length === 0 ? <AppText muted>No saved photos yet.</AppText> : null}
    {!model.loading ? model.groups.filter((group) => group.photos.length > 0).map((group) =>
      <View key={group.key} style={styles.group}>
        <AppText variant="section">{group.title} ({group.photos.length})</AppText>
        <View style={styles.grid}>
          {group.photos.map((photo) => {
            const url = model.thumbs[photo.id];
            const unavailable = !url || broken.includes(photo.id);
            return <Pressable key={photo.id} accessibilityRole="button"
              accessibilityLabel={`Open ${PHOTO_SOURCE_LABELS[photo.source]} photo`}
              onPress={() => void openPhoto(photo)} style={styles.tile}>
              {unavailable ? <View style={styles.missing}>
                <AppText muted style={styles.small}>Image unavailable. Tap to reload.</AppText>
              </View> : <Image source={{ uri: url }} style={styles.thumbnail} resizeMode="cover"
                onError={() => void renewThumbnail(photo)} />}
              <AppText muted style={styles.small}>{PHOTO_SOURCE_LABELS[photo.source]}</AppText>
            </Pressable>;
          })}
        </View>
      </View>
    ) : null}
    <Modal visible={!!viewer && activeIndex >= 0} presentationStyle="fullScreen"
      animationType="slide" onRequestClose={close}>
      <View style={styles.modal}>
        <AppButton variant="secondary" label="Close photo viewer" onPress={close} />
        {currentPhoto ? <AppText style={styles.modalText}>{PHOTO_SOURCE_LABELS[currentPhoto.source]} · {activeIndex + 1} of {all.length}</AppText> : null}
        {viewer?.loading ? <AppText style={styles.modalText}>Loading private photo…</AppText> : null}
        {viewer?.error ? <AppText accessibilityRole="alert" style={styles.modalError}>{viewer.error}</AppText> : null}
        {viewer?.url ? <Image key={`${viewer.id}:${viewer.url}`} source={{ uri: viewer.url }}
          style={styles.fullImage} resizeMode="contain" accessibilityLabel="Full-screen private photo"
          onError={() => setViewerStored((old) => old.scope === scope && old.viewer?.id === viewer.id ?
            { scope, viewer: { id: viewer.id, url: null, loading: false,
              error: 'Image unavailable or link expired. Refresh this photo.' } } : old)} />
          : <View style={styles.fullImage} />}
        {currentPhoto ? <AppButton variant="secondary"
          label={deletingId === currentPhoto.id ? 'Deleting photo…' : 'Delete photo'}
          disabled={!!deletingId || cleanupBusy} onPress={() => confirmDelete(currentPhoto)} /> : null}
        {currentPhoto && !viewer?.loading && (viewer?.error || !viewer?.url) ?
          <AppButton label="Refresh this photo" onPress={() => void openPhoto(currentPhoto)} /> : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <AppButton variant="secondary" label="Previous photo" disabled={activeIndex < 1}
              onPress={() => { const previous = all[activeIndex - 1]; if (previous) void openPhoto(previous); }} />
          </View>
          <View style={styles.action}>
            <AppButton variant="secondary" label="Next photo" disabled={activeIndex < 0 || activeIndex >= all.length - 1}
              onPress={() => { const next = all[activeIndex + 1]; if (next) void openPhoto(next); }} />
          </View>
        </View>
      </View>
    </Modal>
  </AppCard>;
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm, paddingTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: '2.75%' },
  tile: { width: '31.5%', marginBottom: spacing.sm, gap: spacing.xxs, minWidth: 0 },
  thumbnail: { width: '100%', aspectRatio: 1, backgroundColor: colors.background,
    borderRadius: radius.input },
  missing: { width: '100%', aspectRatio: 1, backgroundColor: colors.background,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.input,
    justifyContent: 'center', padding: spacing.xxs },
  small: { fontSize: 12, lineHeight: 16 },
  error: { color: colors.dangerText },
  modal: { flex: 1, backgroundColor: '#111318', paddingTop: 52, paddingBottom: 24,
    paddingHorizontal: spacing.md, gap: spacing.sm },
  modalText: { color: '#FFFFFF', textAlign: 'center' },
  modalError: { color: '#FFBFC3', textAlign: 'center' },
  fullImage: { flex: 1, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 }
});
