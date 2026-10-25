import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { formatUsdCents } from '../tasks/taskModel';
import { listPreparedQuotes } from '../estimates/preparedQuotesApi';
import { quoteReference, type PreparedQuote } from '../estimates/preparedQuotes';
import { decisionFailureMessage, markProjectLost, markProjectWon, reopenProject } from './projectDecisionsApi';
import { canMarkWon, permittedDecision } from './projectDecisionModel';
import { PROJECT_LABELS, type Project } from './projectModel';

type Props = { project: Project; accountId: string; accountScope: number; refreshKey?: number; onChanged: () => void };
export function ProjectDecisionControls({ project, accountId, accountScope, refreshKey = 0, onChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [sent, setSent] = useState<PreparedQuote[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const busy = useRef(false);
  const confirming = useRef(false);
  const version = useRef(0);
  const scope = `${accountScope}:${accountId}:${project.id}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    const ticket = ++version.current;
    busy.current = false; confirming.current = false;
    setSaving(false); setError(''); setSuccess(''); setSent([]); setSelected('');
    if (project.status === 'quote_sent') {
      setLoadingQuotes(true);
      void listPreparedQuotes(accountId, project.id).then((rows) => {
        if (ticket !== version.current || currentScope.current !== scope) return;
        const choices = rows.filter((q) => q.status === 'sent'); // descending version order
        setSent(choices); setSelected(choices[0]?.id ?? '');
      }).catch(() => {
        if (ticket === version.current && currentScope.current === scope)
          setError('Could not load Sent versions. Refresh the project and retry.');
      }).finally(() => {
        if (ticket === version.current && currentScope.current === scope) setLoadingQuotes(false);
      });
    } else setLoadingQuotes(false);
    return () => { version.current += 1; };
  }, [scope, project.status, project.accepted_quote_id, refreshKey]);

  const action = permittedDecision(project.status);
  const execute = async (choice: 'mark_lost' | 'reopen' | 'mark_won', quoteId?: string) => {
    if (busy.current || !accountId || currentScope.current !== scope) return;
    if (choice === 'mark_won' && (!quoteId || !canMarkWon(project, sent.length) ||
      !sent.some((q) => q.id === quoteId))) return;
    if (choice !== 'mark_won' && action !== choice) return;
    busy.current = true;
    const ticket = ++version.current;
    setSaving(true); setError(''); setSuccess('');
    try {
      if (choice === 'mark_lost') await markProjectLost(accountId, project.id);
      else if (choice === 'reopen') await reopenProject(accountId, project.id);
      else await markProjectWon(accountId, project.id, quoteId!);
      if (ticket !== version.current || currentScope.current !== scope) return;
      setSuccess(choice === 'mark_lost' ? 'Project marked Lost. Quotes and history retained.' :
        choice === 'reopen' ? 'Project reopened. Previous approval remains in permanent history.' :
          'Project marked Won with the selected Sent version. Decision recorded.');
      onChanged();
    } catch (failure) {
      if (ticket !== version.current || currentScope.current !== scope) return;
      setError(decisionFailureMessage(failure));
    } finally {
      if (ticket === version.current && currentScope.current === scope) {
        busy.current = false; setSaving(false);
      }
    }
  };
  const confirm = () => {
    if (!action || busy.current || confirming.current) return;
    confirming.current = true;
    const reopen = action === 'reopen';
    Alert.alert(reopen ? 'Reopen project?' : 'Mark project Lost?',
      reopen ? 'Reopen makes pricing editable. Any previous accepted version and decision remain in permanent history.' :
        'Mark this project Lost? Quotes and history remain; pricing and tasks lock until reopened.', [
        { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
        { text: reopen ? 'Reopen Project' : 'Mark Lost', style: 'destructive', onPress: () => {
          confirming.current = false; void execute(action);
        } }
      ], { cancelable: false });
  };
  const confirmWon = () => {
    if (!canMarkWon(project, sent.length) || !selected || busy.current || confirming.current) return;
    const quote = sent.find((q) => q.id === selected);
    if (!quote) return;
    confirming.current = true;
    Alert.alert('Mark project Won?', `Accept ${quoteReference(quote)} for ${formatUsdCents(quote.total_minor)}? This is an immutable Sent version.`, [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Mark Won', onPress: () => {
        confirming.current = false; void execute('mark_won', quote.id);
      } }
    ], { cancelable: false });
  };
  return <AppCard>
    <AppText variant="section">Project Decisions</AppText>
    <AppText>Status: {PROJECT_LABELS[project.status]}</AppText>
    <View style={styles.group}>
      {action ? <AppButton label={saving ? 'Saving decision…' : action === 'reopen' ? 'Reopen Project' : 'Mark Lost'}
        variant={action === 'reopen' ? 'primary' : 'secondary'} disabled={saving} onPress={confirm} /> : null}
      {project.status === 'quote_sent' ? <View style={styles.group}>
        <AppText variant="section">Select accepted Sent version</AppText>
        {loadingQuotes ? <AppText muted>Loading Sent versions…</AppText> : null}
        {!loadingQuotes && sent.length === 0 ? <AppText muted>No Sent quote versions. Explicitly confirm a Prepared version as Sent first.</AppText> : null}
        {sent.map((q) => <AppButton key={q.id} variant="secondary"
          label={`${selected === q.id ? '✓ ' : ''}v${q.version} · ${formatUsdCents(q.total_minor)} · ${quoteReference(q)}`}
          disabled={saving} onPress={() => setSelected(q.id)} />)}
        <AppButton label="Mark Won with selected Sent version" disabled={saving || loadingQuotes || !selected || !canMarkWon(project, sent.length)}
          onPress={confirmWon} />
      </View> : null}
      {action === 'reopen' ? <AppText muted>Reopening clears the active acceptance pointer, not historical quotes or decisions.</AppText> : null}
      {error ? <AppText accessibilityRole="alert" style={styles.error}>{error}</AppText> : null}
      {success ? <AppText accessibilityRole="alert" style={styles.success}>{success}</AppText> : null}
    </View>
  </AppCard>;
}
const styles = StyleSheet.create({ group: { gap: spacing.sm }, error: { color: colors.dangerText },
  success: { color: colors.successText } });
