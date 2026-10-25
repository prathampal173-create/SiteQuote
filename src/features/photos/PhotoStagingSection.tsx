import { useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, radius, spacing } from '../../config/theme';
import { PHOTO_SOURCE_LABELS, processPhoto, type PhotoAssociation, type PhotoSourceLabel,
  type StagedPhoto } from '../../lib/photoProcessing';
import { selectPhoto, type PhotoInput } from './photoSelection';
import { recoverPendingUpload, photoFailureMessage } from './photosApi';
import { stagePendingPhoto, loadPendingPhotos, clearPendingPhoto, type PendingPhoto } from './photoQueue';

type Draft = { entry: PendingPhoto; upload: 'staged' | 'uploading' | 'failed'; uploadError: string; progress: number };
type State = { scope: string; label: PhotoSourceLabel | null; photos: Draft[]; error: string; busy: boolean };
const empty = (scope: string): State => ({ scope, label: null, photos: [], error: '', busy: false });

/** Local, unsaved previews scoped to the authenticated account AND exact project/task. */
export function PhotoStagingSection({ accountScope, accountId, projectId, taskId = null, onSaved }: {
  accountScope: number; accountId: string; projectId: string; taskId?: string | null; onSaved?: () => void;
}) {
  const association: PhotoAssociation = { projectId, taskId };
  const scope = `${accountScope}:${accountId}:${projectId}:${taskId ?? 'direct'}`;
  const [stored, setStored] = useState<State>(() => empty(scope));
  const currentScope = useRef(scope);
  const selecting = useRef(false);
  const uploading = useRef(false);
  currentScope.current = scope;
  const state = stored.scope === scope ? stored : empty(scope);

  useEffect(() => {
    currentScope.current = scope;
    selecting.current = false;
    uploading.current = false;
    setStored(empty(scope));
    void loadPendingPhotos(accountId, projectId, taskId).then((entries) => {
      if (currentScope.current !== scope) return;
      setStored((prev) => prev.scope === scope ? { ...prev, photos: [
        ...prev.photos, ...entries.filter((entry) => !prev.photos.some((d) => d.entry.id === entry.id))
          .map((entry) => ({ entry, upload: 'staged' as const, uploadError: '', progress: 0 }))
      ] } : prev);
    }).catch(() => {
      if (currentScope.current === scope) setStored((prev) => prev.scope === scope ?
        { ...prev, error: 'Could not restore local upload journal. Retry by reopening this screen.' } : prev);
    });
    return () => {
      if (currentScope.current === scope) currentScope.current = '';
      selecting.current = false;
      uploading.current = false;
    };
  }, [scope]);

  const updateLabel = (label: PhotoSourceLabel) => {
    if (selecting.current || uploading.current) return;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), label, error: '' }));
  };

  const pick = async (input: PhotoInput) => {
    if (selecting.current || uploading.current || currentScope.current !== scope) return;
    if (!state.label) {
      setStored((previous) => ({ ...previous, error: 'Choose a photo label first.' }));
      return;
    }
    const label = state.label;
    selecting.current = true;
    setStored((previous) => ({ ...previous, busy: true, error: '' }));
    try {
      const asset = await selectPhoto(input);
      if (currentScope.current !== scope) return;
      if (!asset) return; // cancellation is not an error and does not erase previews
      const photo = await processPhoto(asset, label, association);
      if (currentScope.current !== scope) return;
      const entry = await stagePendingPhoto(accountId, photo);
      if (currentScope.current !== scope) return;
      setStored((previous) => previous.scope === scope ? {
        ...previous, photos: [...previous.photos, { entry, upload: 'staged', uploadError: '', progress: 0 }], label: null, error: ''
      } : previous);
    } catch (error) {
      if (currentScope.current !== scope) return;
      setStored((previous) => previous.scope === scope ? {
        ...previous, error: error instanceof Error ? error.message : 'Could not stage photo. Try again.'
      } : previous);
    } finally {
      if (currentScope.current === scope) {
        selecting.current = false;
        setStored((previous) => previous.scope === scope ? { ...previous, busy: false } : previous);
      }
    }
  };

  const upload = async (id: string) => {
    if (selecting.current || uploading.current || currentScope.current !== scope) return;
    const draft = state.photos.find((item) => item.entry.id === id && item.upload !== 'uploading');
    if (!draft) return;
    uploading.current = true;
    setStored((previous) => previous.scope === scope ? {
      ...previous, photos: previous.photos.map((item) => item.entry.id === id ?
        { ...item, upload: 'uploading', uploadError: '', progress: 0 } : item)
    } : previous);
    try {
      await recoverPendingUpload(accountId, draft.entry, (progress) => {
        if (currentScope.current !== scope) return;
        setStored((previous) => previous.scope === scope ? { ...previous,
          photos: previous.photos.map((item) => item.entry.id === id ? { ...item, progress } : item)
        } : previous);
      });
      await clearPendingPhoto(accountId, draft.entry);
      if (currentScope.current !== scope) return;
      setStored((previous) => previous.scope === scope ? {
        ...previous, photos: previous.photos.filter((item) => item.entry.id !== id)
      } : previous);
      onSaved?.();
    } catch (error) {
      if (currentScope.current !== scope) return;
      setStored((previous) => previous.scope === scope ? {
        ...previous, photos: previous.photos.map((item) => item.entry.id === id ?
          { ...item, upload: 'failed', uploadError: photoFailureMessage(error) } : item)
      } : previous);
    } finally {
      if (currentScope.current === scope) uploading.current = false;
    }
  };

  const discard = (entry: PendingPhoto) => Alert.alert('Discard unsaved photo?',
    'Remove this local recovery copy? If the earlier upload reached Storage, project cleanup can remove the orphan after 24 hours.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard local copy', style: 'destructive', onPress: () => {
        if (uploading.current || selecting.current || currentScope.current !== scope) return;
        void clearPendingPhoto(accountId, entry).then(() => {
          if (currentScope.current === scope) setStored((prev) => prev.scope === scope ?
            { ...prev, photos: prev.photos.filter((draft) => draft.entry.id !== entry.id) } : prev);
        }).catch(() => {
          if (currentScope.current === scope) setStored((prev) => prev.scope === scope ?
            { ...prev, error: 'Could not discard local copy. Retry when app storage is available.' } : prev);
        });
      } }
    ]);

  return <AppCard>
    <AppText variant="section">{taskId ? 'Task Photos' : 'Project Photos'}</AppText>
    <AppText muted>{taskId ? 'For this task only.' : 'Directly attached to this project, not to a task.'}</AppText>
    <AppText>Photo label (required)</AppText>
    <View style={styles.row}>
      {(Object.keys(PHOTO_SOURCE_LABELS) as PhotoSourceLabel[]).map((label) => (
        <View key={label} style={styles.choice}>
          <AppButton variant={state.label === label ? 'primary' : 'secondary'}
            label={`${state.label === label ? '✓ ' : ''}${PHOTO_SOURCE_LABELS[label]}`}
            accessibilityLabel={`Photo label: ${PHOTO_SOURCE_LABELS[label]}${state.label === label ? ', selected' : ''}`}
            disabled={state.busy || uploading.current} onPress={() => updateLabel(label)} />
        </View>
      ))}
    </View>
    <AppButton label={state.busy ? 'Processing photo…' : 'Take Photo'} disabled={state.busy || uploading.current}
      onPress={() => void pick('camera')} />
    <AppButton variant="secondary" label="Choose from Gallery" disabled={state.busy || uploading.current}
      onPress={() => void pick('gallery')} />
    {state.error ? <AppText accessibilityRole="alert" style={styles.error}>{state.error}</AppText> : null}
    <AppText muted>NOT SAVED photos remain in private local app storage until upload completes. After an interruption, reopen this screen and tap Retry upload.</AppText>
    {state.photos.length ? <View style={styles.previews}>
      <AppText variant="section">Unsaved photo previews ({state.photos.length})</AppText>
      {state.photos.map(({ entry, upload: status, uploadError, progress }) => <View key={entry.id} style={styles.preview}>
        <Image source={{ uri: entry.photo.uri }} resizeMode="contain" style={styles.image}
          accessibilityLabel={`Unsaved ${PHOTO_SOURCE_LABELS[entry.photo.source]} JPEG preview`} />
        <AppText>{PHOTO_SOURCE_LABELS[entry.photo.source]} · {entry.photo.width} × {entry.photo.height} · {(entry.photo.sizeBytes / 1024 / 1024).toFixed(2)} MB</AppText>
        <AppText accessibilityRole="alert" style={styles.unsaved}>NOT SAVED — local preview only</AppText>
        {status === 'uploading' ? <AppText>Uploading photo… {progress}% sent (saving metadata follows)</AppText> : null}
        {status === 'failed' ? <AppText accessibilityRole="alert" style={styles.error}>
          {uploadError} This preview is still local and has not been confirmed saved.
        </AppText> : null}
        {status !== 'uploading' ? <AppButton label={status === 'failed' ? 'Retry upload' : 'Upload photo'}
          disabled={state.busy || uploading.current}
          accessibilityLabel={`${status === 'failed' ? 'Retry upload' : 'Upload photo'} ${entry.id}`}
          onPress={() => void upload(entry.id)} /> : null}
        {status !== 'uploading' ? <AppButton variant="secondary" label="Discard unsaved photo"
          disabled={state.busy || uploading.current} onPress={() => discard(entry)} /> : null}
      </View>)}
    </View> : null}
  </AppCard>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  choice: { flex: 1 },
  error: { color: colors.dangerText },
  unsaved: { color: colors.warningText, fontWeight: '600' },
  previews: { gap: spacing.md, paddingTop: spacing.sm },
  preview: { gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card,
    padding: spacing.sm, backgroundColor: colors.background },
  image: { width: '100%', height: 200, backgroundColor: colors.surface }
});
