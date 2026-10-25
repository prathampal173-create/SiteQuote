import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, StyleSheet, View } from 'react-native';
import { File } from 'expo-file-system';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { formatUsdCents } from '../tasks/taskModel';
import { formatTaxBps } from './estimateMath';
import { loadUnsentEstimate } from './unsentEstimateApi';
import { ESTIMATE_CHANGED_MESSAGE, matchesPreview, type UnsentEstimate } from './unsentEstimate';
import { generateVerifiedUnsentPdf, StaleEstimateError } from './verifiedUnsentPdf';

type State = { scope: string; preview: UnsentEstimate | null; busy: boolean;
  error: string; changed: boolean; pdfUri: string | null };
const initial = (scope: string): State => ({ scope, preview: null, busy: false, error: '', changed: false, pdfUri: null });
function dropCachedPdf(uri: string | null) {
  if (!uri) return;
  try { new File(uri).delete(); } catch { /* native cache may already be empty */ }
}
export function UnsentEstimateSection({ accountId, accountScope, projectId, refreshKey }: {
  accountId: string; accountScope: string | number; projectId: string; refreshKey: number;
}) {
  const scope = `${accountScope}:${accountId}:${projectId}`;
  const [stored, setStored] = useState<State>(() => initial(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const sequence = useRef(0);
  const writing = useRef(false);
  const previewRef = useRef<UnsentEstimate | null>(null);
  const pdfRef = useRef<string | null>(null);
  const state = stored.scope === scope ? stored : initial(scope);
  const current = (seq: number) => activeScope.current === scope && sequence.current === seq;
  const update = (patch: Partial<State>) => setStored((old) => ({ ...(old.scope === scope ? old : initial(scope)), ...patch }));

  const invalidate = useCallback(() => {
    ++sequence.current;
    previewRef.current = null;
    dropCachedPdf(pdfRef.current);
    pdfRef.current = null;
    setStored((old) => old.scope === scope ? { ...old, preview: null, changed: true,
      error: '', pdfUri: null, busy: false } : old);
  }, [scope]);

  const checkChanged = useCallback(async () => {
    const previous = previewRef.current;
    if (!previous) return;
    const seq = ++sequence.current;
    try {
      const latest = await loadUnsentEstimate(accountId, projectId);
      if (!current(seq)) return;
      if (!matchesPreview(previous, latest)) invalidate();
    } catch {
      if (current(seq)) update({ error: 'Could not check the saved estimate. Retry when online.' });
    }
  }, [accountId, projectId, invalidate, scope]);

  useFocusEffect(useCallback(() => {
    void checkChanged();
    const sub = AppState.addEventListener('change', (mode) => {
      if (mode === 'active') void checkChanged();
    });
    return () => { ++sequence.current; sub.remove(); };
  }, [checkChanged]));

  // Edits through this screen invalidate immediately. Other screens/other devices are
  // checked on focus/foreground and again around PDF generation.
  const lastRevision = useRef(refreshKey);
  useEffect(() => {
    if (lastRevision.current !== refreshKey) {
      lastRevision.current = refreshKey;
      if (previewRef.current || writing.current) invalidate();
    }
  }, [refreshKey, invalidate]);
  useEffect(() => {
    previewRef.current = null;
    dropCachedPdf(pdfRef.current);
    pdfRef.current = null;
    setStored(initial(scope));
    return () => {
      ++sequence.current;
      previewRef.current = null;
      dropCachedPdf(pdfRef.current);
      pdfRef.current = null;
    };
  }, [scope]);

  const preview = async () => {
    if (writing.current || state.busy) return;
    writing.current = true;
    const seq = ++sequence.current;
    update({ busy: true, error: '', pdfUri: null, preview: null, changed: false });
    previewRef.current = null;
    dropCachedPdf(pdfRef.current);
    pdfRef.current = null;
    try {
      const result = await loadUnsentEstimate(accountId, projectId);
      if (!current(seq)) return;
      previewRef.current = result;
      update({ preview: result, changed: false, busy: false });
    } catch (error) {
      if (current(seq)) update({ busy: false, error: error instanceof Error ? error.message : 'Preview unavailable.' });
    } finally {
      writing.current = false;
      if (activeScope.current === scope) setStored((old) => old.scope === scope && old.busy
        ? { ...old, busy: false } : old);
    }
  };
  const makePdf = async () => {
    const before = previewRef.current;
    if (!before || writing.current || state.busy) return;
    writing.current = true;
    const seq = ++sequence.current;
    update({ busy: true, error: '', pdfUri: null });
    dropCachedPdf(pdfRef.current);
    pdfRef.current = null;
    try {
      const uri = await generateVerifiedUnsentPdf(accountId, projectId, before);
      if (!current(seq) || previewRef.current !== before) { dropCachedPdf(uri); return; }
      pdfRef.current = uri;
      update({ busy: false, pdfUri: uri });
    } catch (error) {
      if (!current(seq)) return;
      if (error instanceof StaleEstimateError) invalidate();
      else update({ busy: false, error: error instanceof Error ? error.message : 'Unable to create the PDF.' });
    } finally {
      writing.current = false;
      if (activeScope.current === scope) setStored((old) => old.scope === scope && old.busy
        ? { ...old, busy: false } : old);
    }
  };
  const model = state.preview;
  return <AppCard>
    <AppText variant="section">Unsent estimate</AppText>
    <AppText muted>From saved project data only. Preview/PDF do not create a quote or change status.</AppText>
    <AppButton label={state.busy ? 'Loading estimate…' : 'Preview estimate'}
      disabled={state.busy} onPress={() => void preview()} />
    {state.changed ? <AppText accessibilityRole="alert" style={styles.warning}>{ESTIMATE_CHANGED_MESSAGE}</AppText> : null}
    {state.error ? <View style={styles.stack}><AppText accessibilityRole="alert" style={styles.error}>{state.error}</AppText>
      <AppButton variant="secondary" label="Check saved estimate" disabled={state.busy} onPress={() => void checkChanged()} /></View> : null}
    {model && !state.changed ? <View style={styles.stack}>
      <AppText variant="section">Unsent estimate · Preview only</AppText>
      <AppText>From: {model.content.business_name || 'Business name not set'}
        {model.content.business_address ? ` · ${model.content.business_address}` : ''}
        {model.content.business_phone ? ` · ${model.content.business_phone}` : ''}</AppText>
      <AppText>Customer: {model.content.customer_name}
        {model.content.customer_phone ? ` · ${model.content.customer_phone}` : ''}
        {model.content.customer_email ? ` · ${model.content.customer_email}` : ''}</AppText>
      <AppText>Project: {model.content.project_title}</AppText>
      {model.content.site_address ? <AppText>Site: {model.content.site_address}</AppText> : null}
      <AppText variant="section">Task costs</AppText>
      {model.content.tasks.length === 0 ? <AppText muted>No saved tasks</AppText> : null}
      {model.content.tasks.map((t) => <View key={t.id} style={styles.stack}>
        <View style={styles.line}><AppText style={styles.flex}>{t.title} · {t.category}</AppText>
          <AppText>{formatUsdCents(t.amount_minor)}</AppText></View>
        {t.notes?.trim() ? <AppText muted>Task notes: {t.notes}</AppText> : null}
      </View>)}
      <View style={styles.line}><AppText style={styles.flex}>Task subtotal</AppText>
        <AppText>{formatUsdCents(model.totals.taskSubtotalMinor)}</AppText></View>
      <AppText variant="section">Additional Charges</AppText>
      {model.content.charges.map((c) => <View key={c.id} style={styles.line}>
        <AppText style={styles.flex}>{c.description}</AppText><AppText>{formatUsdCents(c.amount_minor)}</AppText>
      </View>)}
      <View style={styles.line}><AppText style={styles.flex}>Charges total</AppText>
        <AppText>{formatUsdCents(model.totals.chargesTotalMinor)}</AppText></View>
      <View style={styles.line}><AppText style={styles.flex}>Pretax subtotal</AppText>
        <AppText>{formatUsdCents(model.totals.pretaxMinor)}</AppText></View>
      <View style={styles.line}><AppText style={styles.flex}>Tax ({formatTaxBps(model.totals.taxBps)}%)</AppText>
        <AppText>{formatUsdCents(model.totals.taxMinor)}</AppText></View>
      <View style={styles.line}><AppText variant="total" style={styles.flex}>Final estimate</AppText>
        <AppText variant="total">{formatUsdCents(model.totals.finalMinor)}</AppText></View>
      <AppButton variant="secondary" label="Check preview freshness" disabled={state.busy}
        onPress={() => void checkChanged()} />
      <AppButton variant="secondary" label={state.busy ? 'Generating PDF…' : 'Generate unsent PDF'}
        disabled={state.busy} onPress={() => void makePdf()} />
      {state.pdfUri ? <AppText accessibilityRole="alert" style={styles.ok}>
        Unsent PDF generated in private app cache. It is not a Prepared or Sent quote. To share, prepare an immutable numbered quote below.
      </AppText> : null}
    </View> : null}
  </AppCard>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, line: { flexDirection: 'row', gap: spacing.sm,
  justifyContent: 'space-between' }, flex: { flex: 1 }, error: { color: colors.dangerText },
  warning: { color: colors.dangerText, fontWeight: '700' }, ok: { color: colors.successText } });
