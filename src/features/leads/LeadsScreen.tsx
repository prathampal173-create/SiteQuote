import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, layout, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { LeadChoices } from './LeadChoices';
import { listQuoteSentLeadIds } from '../projects/quoteSentApi';
import { leadFailureMessage, listLeads } from './leadsApi';
import { filterLeads, STAGES, STAGE_LABELS, type Lead, type LeadFilter } from './leadModel';

type Model = { scope: string; rows: Lead[]; quoteIds: ReadonlySet<string>; loading: boolean; loaded: boolean; error: string };
const empty = (scope: string): Model => ({ scope, rows: [], quoteIds: new Set(), loading: false, loaded: false, error: '' });
const FILTERS: readonly LeadFilter[] = ['all', ...STAGES, 'quote_sent'];

export function LeadsScreen() {
  const { accountId, accountScope } = useAuthFlow();
  const router = useRouter();
  const { dashboard } = useLocalSearchParams<{ dashboard?: string }>();
  const scope = accountId ? `${accountScope}:${accountId}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<LeadFilter>('all');
  const generation = useRef(0);
  const filterScope = useRef(scope);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  // A Dashboard Total Leads request explicitly clears stale search/stage restrictions.
  useEffect(() => { if (dashboard) { setSearch(''); setStage('all'); } }, [dashboard]);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const requestId = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const [rows, quoteIds] = await Promise.all([listLeads(accountId), listQuoteSentLeadIds(accountId)]);
      if (generation.current !== requestId || currentScope.current !== scope) return;
      setStored({ scope, rows, quoteIds, loading: false, loaded: true, error: '' });
    } catch (error) {
      if (generation.current !== requestId || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)),
        loading: false, error: leadFailureMessage(error) }));
    }
  }, [accountId, scope]);

  useFocusEffect(useCallback(() => {
    // Keep the user's stage-filtered view during same-account navigation.
    // An account switch clears filters and any owner-specific search context.
    if (filterScope.current !== scope) {
      filterScope.current = scope;
      setSearch('');
      setStage('all');
    }
    setStored(empty(scope));
    void reload();
    return () => { generation.current++; };
  }, [reload, scope]));

  const visible = filterLeads(model.rows, search, stage, model.quoteIds);
  return (
    <AppScreen>
      <AppText variant="title">Leads</AppText>
      <AppButton label="Create Lead" onPress={() => router.push('/lead/new')} />
      <AppButton variant="secondary" label="View All Projects" onPress={() => router.push('/projects')} />
      <AppField label="Search customer name" value={search} onChangeText={setSearch}
        autoCapitalize="none" autoCorrect={false} accessibilityHint="Search by customer name, regardless of case" />
      <LeadChoices label="Lead filter" options={FILTERS} selected={stage}
        text={(value) => value === 'all' ? 'All Leads' : value === 'quote_sent' ? 'Quote Sent' : STAGE_LABELS[value]}
        onSelect={setStage} />
      {model.loading ? <AppText accessibilityRole="alert">Loading leads…</AppText> : null}
      {model.error ? (
        <View style={styles.group}>
          <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
          <AppButton variant="secondary" label="Retry loading leads" onPress={() => void reload()} />
        </View>
      ) : null}
      {!model.loading && !model.error && model.loaded && !model.rows.length ? (
        <AppText muted>No leads saved yet. Create a lead to get started.</AppText>
      ) : null}
      {!model.loading && !model.error && model.loaded && model.rows.length > 0 && visible.length === 0 ? (
        <AppText muted>No leads match this search and filter.</AppText>
      ) : null}
      {visible.map((lead) => (
        <Pressable key={lead.id} accessibilityRole="button"
          accessibilityLabel={`Open ${lead.customer_name}, ${STAGE_LABELS[lead.contact_stage]}`}
          onPress={() => router.push({ pathname: '/lead/[id]', params: { id: lead.id } })}
          style={{ minHeight: layout.minTouchTarget }}>
          <AppCard>
            <AppText variant="section">{lead.customer_name}</AppText>
            <AppText muted>{[lead.phone, lead.email].filter(Boolean).join(' · ')}</AppText>
            <AppText style={{ color: colors.primary }}>{STAGE_LABELS[lead.contact_stage]}</AppText>
          </AppCard>
        </Pressable>
      ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText } });
