import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppState, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, layout, spacing, typography } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { loadDashboardCounts } from './dashboardApi';
import { DASHBOARD_METRICS, EMPTY_COUNTS, METRIC_DETAILS, dashboardDestination, type DashboardCounts, type DashboardMetric } from './dashboardModel';

type State = { scope: string; counts: DashboardCounts; loading: boolean; loaded: boolean; error: string };
const empty = (scope: string): State => ({ scope, counts: { ...EMPTY_COUNTS }, loading: false, loaded: false, error: '' });

export function DashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}` : '';
  const [stored, setStored] = useState<State>(() => empty(scope));
  const generation = useRef(0);
  const navigationSequence = useRef(0);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((old) => ({ ...(old.scope === scope ? old : empty(scope)), loading: true, error: '' }));
    try {
      const counts = await loadDashboardCounts(accountId, new Date());
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored({ scope, counts, loaded: true, loading: false, error: '' });
    } catch {
      if (ticket !== generation.current || liveScope.current !== scope) return;
      setStored({ scope, counts: { ...EMPTY_COUNTS }, loaded: true, loading: false,
        error: 'Could not verify dashboard counts. Check your connection and retry.' });
    }
  }, [accountId, scope]);

  useFocusEffect(useCallback(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]));
  // Re-evaluate overdue eligibility when time has passed outside the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && liveScope.current === scope) void reload();
    });
    return () => subscription.remove();
  }, [reload, scope]);

  const openMetric = (key: DashboardMetric) => {
    // Per-tap non-sensitive request token resets any previous destination filter.
    router.push(dashboardDestination(key, `${accountScope}-${Date.now()}-${++navigationSequence.current}`));
  };
  const twoColumns = width >= layout.narrowWidth;
  return <AppScreen>
    <AppText variant="title">Dashboard</AppText>
    <AppText muted>Current totals from your saved CRM records.</AppText>
    {model.loading ? <AppText accessibilityRole="alert">Refreshing dashboard counts…</AppText> : null}
    {model.error ? <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText> : null}
    <View style={styles.grid}>
      {DASHBOARD_METRICS.map((key) => {
        const info = METRIC_DETAILS[key];
        const count = model.counts[key];
        const unavailable = !model.loading && model.loaded && count === null;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${info.title}, ${count === null ? 'unavailable' : count}. Open matching records`}
          accessibilityHint={info.description} onPress={() => openMetric(key)}
          style={({ pressed }) => [styles.cell, { width: twoColumns ? '48%' : '100%' }, pressed && styles.pressed]}>
          <AppCard style={styles.card}>
            <AppText style={styles.symbol}>{info.symbol}</AppText>
            <AppText variant="section">{info.title}</AppText>
            <AppText style={styles.count} accessibilityRole="text">{count === null ? (model.loading || !model.loaded ? '…' : '—') : count.toLocaleString('en-US')}</AppText>
            <AppText muted variant="caption">{unavailable ? 'Unavailable · retry' : info.description}  ›</AppText>
          </AppCard>
        </Pressable>;
      })}
    </View>
    <AppButton variant="secondary" label={model.loading ? 'Refreshing…' : 'Refresh counts'} disabled={model.loading} onPress={() => void reload()} />
    {DASHBOARD_METRICS.some((key) => model.counts[key] === null) && model.loaded && !model.loading ?
      <AppText muted>Unavailable metrics are not zero. Refresh to retry; other cards still open their saved records.</AppText> : null}
  </AppScreen>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  cell: { minHeight: 160, borderRadius: 12 },
  card: { flex: 1, minHeight: 160, justifyContent: 'space-between' },
  pressed: { opacity: 0.72 },
  symbol: { fontSize: 24 },
  count: { ...typography.total, color: colors.primary, fontVariant: ['tabular-nums'] },
  error: { color: colors.dangerText }
});
