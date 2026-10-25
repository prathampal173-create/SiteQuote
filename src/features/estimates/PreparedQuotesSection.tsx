import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { formatUsdCents } from '../tasks/taskModel';
import { loadUnsentEstimate } from './unsentEstimateApi';
import { ESTIMATE_CHANGED_MESSAGE, matchesPreview, type UnsentEstimate } from './unsentEstimate';
import { confirmQuoteSentForFollowup, listPreparedQuotes, prepareQuote } from './preparedQuotesApi';
import { quoteChanges, quoteReference, type PreparedQuote } from './preparedQuotes';
import { renderVersionedQuotePdf, removeQuotePdf, shareVersionedQuotePdf, viewVersionedQuotePdf } from './versionedPdf';
import { formattedLocalDate } from '../reminders/reminderModel';
import { suggestFollowup } from '../reminders/sentQuoteFollowup';

type Model = { scope: string; rows: PreparedQuote[]; preview: UnsentEstimate | null;
  stale: boolean; busy: boolean; error: string; notice: string; pdfId: string | null; pdfUri: string | null };
const empty = (scope: string): Model => ({ scope, rows: [], preview: null,
  stale: false, busy: false, error: '', notice: '', pdfId: null, pdfUri: null });
export function PreparedQuotesSection({ accountId, accountScope, projectId, leadId, closed, refreshKey, onStatusChanged }: {
  accountId: string; accountScope: string | number; projectId: string; leadId: string; closed: boolean; refreshKey: number; onStatusChanged?: () => void;
}) {
  const router = useRouter();
  const scope = `${accountScope}:${accountId}:${projectId}`;
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const model = stored.scope === scope ? stored : empty(scope);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const serial = useRef(0);
  const historySerial = useRef(0);
  const freshnessSerial = useRef(0);
  const running = useRef(false);
  const previewRef = useRef<UnsentEstimate | null>(null);
  const requestKey = useRef<string | null>(null);
  const fileRef = useRef<{ id: string; uri: string } | null>(null);
  const lastRefresh = useRef(refreshKey);
  const update = (patch: Partial<Model>) => setStored((s) => ({ ...(s.scope === scope ? s : empty(scope)), ...patch }));
  const isCurrent = (ticket: number) => scopeRef.current === scope && serial.current === ticket;
  const clearPdf = () => { removeQuotePdf(fileRef.current?.uri ?? null); fileRef.current = null; };
  const stale = useCallback(() => {
    ++serial.current;
    previewRef.current = null; requestKey.current = null;
    setStored((s) => s.scope === scope ? { ...s, preview: null, stale: true, error: '', busy: false } : s);
  }, [scope]);
  const refreshHistory = useCallback(async () => {
    const ticket = ++historySerial.current;
    try {
      const rows = await listPreparedQuotes(accountId, projectId);
      if (scopeRef.current === scope && historySerial.current === ticket) update({ rows });
    } catch (err) {
      if (scopeRef.current === scope && historySerial.current === ticket) update({ error: err instanceof Error ? err.message : 'History unavailable.' });
    }
  }, [accountId, projectId, scope]);
  const checkFresh = useCallback(async () => {
    const old = previewRef.current;
    if (!old) return;
    const ticket = ++freshnessSerial.current;
    try {
      const latest = await loadUnsentEstimate(accountId, projectId);
      if (scopeRef.current === scope && freshnessSerial.current === ticket && previewRef.current === old &&
        !matchesPreview(old, latest)) stale();
    } catch {
      if (scopeRef.current === scope && freshnessSerial.current === ticket) update({ error: 'Could not check estimate freshness. Retry online.' });
    }
  }, [accountId, projectId, scope, stale]);
  useFocusEffect(useCallback(() => {
    void refreshHistory(); void checkFresh();
    const sub = AppState.addEventListener('change', (mode) => { if (mode === 'active') void checkFresh(); });
    return () => { ++historySerial.current; ++freshnessSerial.current; sub.remove(); };
  }, [refreshHistory, checkFresh]));
  useEffect(() => {
    if (lastRefresh.current !== refreshKey) {
      lastRefresh.current = refreshKey;
      if (previewRef.current) stale();
    }
  }, [refreshKey, stale]);
  useEffect(() => {
    previewRef.current = null; requestKey.current = null; clearPdf();
    setStored(empty(scope));
    return () => { ++serial.current; ++historySerial.current; ++freshnessSerial.current; previewRef.current = null; requestKey.current = null; clearPdf(); };
  }, [scope]);
  const withBusy = async (work: (ticket: number) => Promise<void>) => {
    if (running.current || model.busy) return;
    running.current = true;
    const ticket = ++serial.current;
    update({ busy: true, error: '', notice: '' });
    try { await work(ticket); }
    catch (e) { if (isCurrent(ticket)) {
      if (e instanceof Error && e.message === ESTIMATE_CHANGED_MESSAGE) stale();
      else update({ error: e instanceof Error ? e.message : 'Quote operation failed.' });
    } }
    finally { running.current = false; if (isCurrent(ticket)) update({ busy: false }); }
  };
  const preview = () => void withBusy(async (ticket) => {
    const result = await loadUnsentEstimate(accountId, projectId);
    if (!isCurrent(ticket)) return;
    previewRef.current = result; requestKey.current = null;
    update({ preview: result, stale: false });
  });
  const prepare = () => void withBusy(async (ticket) => {
    const original = previewRef.current;
    if (!original || closed) throw new Error('Preview an open project before preparing.');
    if (!original.content.business_name?.trim() || original.content.tasks.length === 0 || original.totals.finalMinor <= 0)
      throw new Error('A business name, at least one task and a positive total are required.');
    const key = requestKey.current ?? Crypto.randomUUID();
    requestKey.current = key; // Same key survives uncertain network response/retry.
    const result = await prepareQuote(accountId, projectId, original.fingerprint, key);
    if (!isCurrent(ticket)) return;
    requestKey.current = null;
    previewRef.current = null;
    clearPdf();
    update({ preview: null, notice: result.result === 'created'
      ? `Prepared ${quoteReference(result.quote)}. No quote has been sent.`
      : `Reused ${quoteReference(result.quote)} (${result.result === 'reshare_sent' ? 'Sent' : 'Prepared'}). No send status changed.` });
    const historyTicket = ++historySerial.current;
    const rows = await listPreparedQuotes(accountId, projectId);
    if (isCurrent(ticket) && historySerial.current === historyTicket) update({ rows });
  });
  const createPdf = (q: PreparedQuote) => void withBusy(async (ticket) => {
    const existing = fileRef.current;
    if (existing?.id === q.id && new File(existing.uri).exists) {
      if (isCurrent(ticket)) update({ pdfId: q.id, pdfUri: existing.uri, notice: 'Saved-version PDF is ready for viewing or sharing.' });
      return;
    }
    clearPdf();
    const uri = await renderVersionedQuotePdf(q);
    if (!isCurrent(ticket)) { removeQuotePdf(uri); return; }
    fileRef.current = { id: q.id, uri };
    update({ pdfId: q.id, pdfUri: uri, notice: `PDF for ${quoteReference(q)} is ready. Sharing does not mark it sent.` });
  });
  const openPdf = (kind: 'view' | 'share') => void withBusy(async () => {
    const f = fileRef.current;
    if (!f || !new File(f.uri).exists) { clearPdf(); update({ pdfId: null, pdfUri: null });
      throw new Error('Cached PDF is missing. Generate it again.'); }
    if (kind === 'view') await viewVersionedQuotePdf(f.uri);
    else await shareVersionedQuotePdf(f.uri);
    // Native UI return is NOT evidence of sending; no database mutation.
    update({ notice: 'Quote status unchanged. Sharing or closing the sheet does not mark it sent.' });
  });
  const markSent = (quote: PreparedQuote) => {
    if (running.current || model.busy || closed || quote.status !== 'prepared') return;
    Alert.alert('Confirm delivery of this quote?',
      `Only confirm after actually sending ${quoteReference(quote)} to the customer. Sharing or opening a PDF alone does not count.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark sent', onPress: () => void withBusy(async (ticket) => {
          const result = await confirmQuoteSentForFollowup(accountId, projectId, quote.id);
          if (!isCurrent(ticket)) return;
          update({ notice: result.transitioned ? `${quoteReference(result.quote)} marked Sent.` :
            `${quoteReference(result.quote)} was already Sent. No new delivery recorded.` });
          // Confirmation committed: refresh project independently of the
          // optional follow-up. Never infer Sent from preview or share sheets.
          onStatusChanged?.();
          void refreshHistory();
          if (!result.transitioned || !result.quote.sent_at) return;
          let suggestion;
          try { suggestion = suggestFollowup(result.quote.sent_at); }
          catch { // Mark Sent succeeded; the optional reminder date can be edited normally.
            Alert.alert('Quote marked as sent', 'You can add a Follow-up reminder manually from Reminders.');
            return;
          }
          if (!isCurrent(ticket)) return;
          Alert.alert('Quote marked as sent',
            `Would you like to schedule a follow-up with this customer?\n\nCustomer: ${result.quote.snapshot.content.customer_name}\nProject: ${result.quote.snapshot.content.project_title}\nSuggested follow-up: ${formattedLocalDate(suggestion.due)}${suggestion.adjusted ? '\n(Adjusted to the next valid local time.)' : ''}${suggestion.ambiguous ? '\n(Daylight-saving overlap: the earlier occurrence is selected; review the time.)' : ''}`, [
              { text: 'Not now', style: 'cancel' },
              { text: 'Schedule follow-up', onPress: () => {
                if (!isCurrent(ticket)) return;
                router.push({ pathname: '/reminder/new', params: { leadId, projectId,
                  sourceQuoteId: result.quote.id, sourceOwnerId: accountId, sentAt: result.quote.sent_at! } });
              } }
            ], { cancelable: true });
        }) }
      ], { cancelable: true });
  };
  return <AppCard>
    <AppText variant="section">Prepared quote versions</AppText>
    <AppText muted>Frozen versions can be viewed and shared. Only explicit Mark sent confirmation records delivery.</AppText>
    {!closed ? <AppButton variant="secondary" label="Preview saved estimate for preparation" disabled={model.busy} onPress={preview} />
      : <AppText muted>Project is Won/Lost. Reopen to prepare; existing versions remain viewable.</AppText>}
    {model.stale ? <AppText accessibilityRole="alert" style={styles.warning}>{ESTIMATE_CHANGED_MESSAGE}</AppText> : null}
    {model.preview && !model.stale && !closed ? <View style={styles.stack}>
      <AppText>Saved estimate: {model.preview.content.tasks.length} task(s), {model.preview.content.charges.length} charge(s)</AppText>
      <AppText variant="total">{formatUsdCents(model.preview.totals.finalMinor)}</AppText>
      <AppText muted>Preparing atomically rechecks all saved details; a changed estimate is rejected.</AppText>
      <AppButton label="Prepare numbered quote" disabled={model.busy} onPress={prepare} />
    </View> : null}
    {model.notice ? <AppText accessibilityRole="alert" style={styles.success}>{model.notice}</AppText> : null}
    {model.error ? <View style={styles.stack}><AppText accessibilityRole="alert" style={styles.warning}>{model.error}</AppText>
      <AppButton variant="secondary" label="Reload versions" disabled={model.busy} onPress={() => void refreshHistory()} />
    </View> : null}
    <AppText variant="section">Version history</AppText>
    {model.rows.length === 0 ? <AppText muted>No prepared versions yet.</AppText> : null}
    {model.rows.map((q, i) => <View key={q.id} style={styles.version}>
      <AppText variant="section">v{q.version} · {formatUsdCents(q.total_minor)} · {q.status === 'sent' ? 'Sent' : 'Prepared'}</AppText>
      <AppText muted>{quoteReference(q)} · Issued {new Date(q.issued_at).toLocaleDateString('en-US', { timeZone: 'UTC' })}</AppText>
      <AppText muted>{quoteChanges(q, model.rows[i + 1] ?? null)}</AppText>
      {q.status === 'prepared' && !closed ? <AppButton label={`Mark v${q.version} sent`} variant="secondary" disabled={model.busy} onPress={() => markSent(q)} /> : null}
      {q.status === 'prepared' && closed ? <AppText muted>Reopen project to mark this version Sent.</AppText> : null}
      <AppButton variant="secondary" label={`Generate v${q.version} PDF`} disabled={model.busy} onPress={() => createPdf(q)} />
      {model.pdfId === q.id && model.pdfUri ? <View style={styles.stack}>
        <AppButton variant="secondary" label={`View v${q.version} PDF`} disabled={model.busy} onPress={() => openPdf('view')} />
        <AppButton label={`Share v${q.version} PDF`} disabled={model.busy} onPress={() => openPdf('share')} />
      </View> : null}
    </View>)}
  </AppCard>;
}
const styles = StyleSheet.create({ stack: { gap: spacing.sm }, version: { gap: spacing.xs,
  paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  warning: { color: colors.dangerText }, success: { color: colors.successText } });
