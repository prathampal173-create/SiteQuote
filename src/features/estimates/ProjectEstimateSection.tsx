import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { formatUsdCents } from '../tasks/taskModel';
import { formatChargeDraft, formatTaxBps, parseTaxBps, validateCharge } from './estimateMath';
import { addAdditionalCharge, editAdditionalCharge, estimateFailureMessage,
  loadWorkingEstimate, removeAdditionalCharge, saveTaxRate,
  type AdditionalCharge, type WorkingEstimate } from './estimatesApi';

type Model = { scope: string; estimate: WorkingEstimate | null; loading: boolean; error: string };
const empty = (scope: string): Model => ({ scope, estimate: null, loading: false, error: '' });
export function ProjectEstimateSection({ accountId, accountScope, projectId, closed, onPricingChanged }: {
  accountId: string; accountScope: string | number; projectId: string; closed: boolean; onPricingChanged?: () => void;
}) {
  const scope = `${accountScope}:${accountId}:${projectId}`;
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taxDraft, setTaxDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const ticket = useRef(0);
  const busy = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  const locked = closed || model.estimate?.status === 'won' || model.estimate?.status === 'lost';

  const reload = useCallback(async () => {
    const current = ++ticket.current;
    setStored((old) => ({ ...(old.scope === scope ? old : empty(scope)), loading: true, error: '' }));
    try {
      const estimate = await loadWorkingEstimate(accountId, projectId);
      if (current !== ticket.current || currentScope.current !== scope) return;
      setStored({ scope, estimate, loading: false, error: '' });
    } catch (error) {
      if (current !== ticket.current || currentScope.current !== scope) return;
      setStored((old) => ({ ...(old.scope === scope ? old : empty(scope)), loading: false,
        error: estimateFailureMessage(error) }));
    }
  }, [accountId, projectId, scope]);

  useFocusEffect(useCallback(() => {
    setStored(empty(scope));
    setEditingId(null); setDescription(''); setAmount(''); setTaxDraft(null); setFormError('');
    void reload();
    return () => { ticket.current++; };
  }, [reload, scope]));

  async function mutate(work: () => Promise<void>, after?: () => void) {
    if (busy.current || locked || !model.estimate) return;
    busy.current = true;
    setSaving(true); setFormError('');
    const current = ticket.current;
    try {
      await work();
      if (current !== ticket.current || currentScope.current !== scope) return;
      after?.();
      onPricingChanged?.();
      await reload();
    } catch (error) {
      if (current === ticket.current && currentScope.current === scope) setFormError(estimateFailureMessage(error));
    } finally {
      busy.current = false;
      if (currentScope.current === scope) setSaving(false);
    }
  }
  function resetCharge() { setEditingId(null); setDescription(''); setAmount(''); }
  function beginEdit(charge: AdditionalCharge) {
    setEditingId(charge.id); setDescription(charge.description);
    setAmount(formatChargeDraft(charge.amount_minor)); setFormError('');
  }
  function saveCharge() {
    if (locked || saving || !model.estimate) return;
    const checked = validateCharge(description, amount);
    if (!checked.ok) { setFormError(Object.values(checked.errors).join(' ')); return; }
    void mutate(() => editingId
      ? editAdditionalCharge(accountId, projectId, editingId, description, amount)
      : addAdditionalCharge(accountId, projectId, description, amount), resetCharge);
  }
  function confirmRemove(charge: AdditionalCharge) {
    if (locked || saving) return;
    Alert.alert('Remove additional charge?', `Remove “${charge.description}” from this working estimate?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void mutate(
        () => removeAdditionalCharge(accountId, projectId, charge.id),
        () => { if (editingId === charge.id) resetCharge(); }
      ) }
    ]);
  }
  const totals = model.estimate?.totals;
  const taxText = taxDraft ?? (totals ? formatTaxBps(totals.taxBps) : '0.00');
  return <AppCard>
    <AppText variant="section">Working estimate (USD)</AppText>
    <AppText muted>Saved project pricing. This is not a sent quote or a PDF.</AppText>
    {model.loading ? <AppText accessibilityRole="alert">Loading estimate…</AppText> : null}
    {model.error ? <View style={styles.group}>
      <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
      <AppButton variant="secondary" label="Retry estimate" onPress={() => void reload()} />
    </View> : null}
    {model.estimate && totals ? <>
      <AppText variant="section">Task costs</AppText>
      {model.estimate.tasks.length === 0 ? <AppText muted>No tasks added yet.</AppText> : null}
      {model.estimate.tasks.map((task) => <View key={task.id} style={styles.line}>
        <AppText style={styles.flex}>{task.title}</AppText>
        <AppText>{formatUsdCents(task.amount_minor)}</AppText>
      </View>)}
      <View style={styles.line}><AppText style={styles.flex}>Task subtotal</AppText>
        <AppText>{formatUsdCents(totals.taskSubtotalMinor)}</AppText></View>

      <AppText variant="section">Additional Charges</AppText>
      {model.estimate.charges.length === 0 ? <AppText muted>No additional charges.</AppText> : null}
      {model.estimate.charges.map((charge) => <View key={charge.id} style={styles.charge}>
        <View style={styles.line}><AppText style={styles.flex}>{charge.description}</AppText>
          <AppText>{formatUsdCents(charge.amount_minor)}</AppText></View>
        {!locked ? <View style={styles.actions}>
          <AppButton variant="secondary" label={`Edit charge ${charge.description}`} disabled={saving}
            onPress={() => beginEdit(charge)} />
          <AppButton variant="secondary" label={`Remove charge ${charge.description}`} disabled={saving}
            onPress={() => confirmRemove(charge)} />
        </View> : null}
      </View>)}
      <View style={styles.line}><AppText style={styles.flex}>Charges total</AppText>
        <AppText>{formatUsdCents(totals.chargesTotalMinor)}</AppText></View>
      {!locked ? <View style={styles.group}>
        <AppText variant="section">{editingId ? 'Edit charge' : 'Add charge'}</AppText>
        <AppField label="Charge description" value={description} editable={!saving} onChangeText={setDescription}
          placeholder="e.g. Permit fee" />
        <AppField label="Charge amount (USD)" value={amount} editable={!saving}
          onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <AppButton label={saving ? 'Saving pricing…' : editingId ? 'Save Charge' : 'Add Charge'}
          disabled={saving} onPress={saveCharge} />
        {editingId ? <AppButton variant="secondary" label="Cancel edit" disabled={saving}
          onPress={resetCharge} /> : null}
      </View> : null}
      <View style={styles.line}><AppText style={styles.flex}>Pretax total</AppText>
        <AppText>{formatUsdCents(totals.pretaxMinor)}</AppText></View>
      {locked ? <AppText>Tax rate: {formatTaxBps(totals.taxBps)}%</AppText> : <View style={styles.group}>
        <AppField label="Project tax rate (%)" value={taxText} editable={!saving}
          keyboardType="decimal-pad" onChangeText={setTaxDraft} />
        <AppButton variant="secondary" label={saving ? 'Saving pricing…' : 'Save Tax Rate'}
          disabled={saving || taxDraft === null || parseTaxBps(taxText) === null}
          onPress={() => void mutate(() => saveTaxRate(accountId, projectId, taxText), () => setTaxDraft(null))} />
      </View>}
      <View style={styles.line}><AppText style={styles.flex}>Tax ({formatTaxBps(totals.taxBps)}%)</AppText>
        <AppText>{formatUsdCents(totals.taxMinor)}</AppText></View>
      <View style={styles.line}><AppText variant="total" style={styles.flex}>Final estimate</AppText>
        <AppText variant="total">{formatUsdCents(totals.finalMinor)}</AppText></View>
      {locked ? <AppText muted>Won/Lost pricing is read-only until Reopen.</AppText> : null}
      {formError ? <AppText accessibilityRole="alert" style={styles.error}>{formError}</AppText> : null}
    </> : null}
  </AppCard>;
}
const styles = StyleSheet.create({
  group: { gap: spacing.xs }, error: { color: colors.dangerText },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, justifyContent: 'space-between' },
  flex: { flex: 1 }, charge: { gap: spacing.xs },
  actions: { gap: spacing.xs }
});
