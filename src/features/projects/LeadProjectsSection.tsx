import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { listLeadProjects, projectFailureMessage } from './projectsApi';
import { ProjectCard } from './ProjectCard';
import { loadProjectQuoteSummaries, type QuoteSummary } from './projectQuoteSummary';
import type { Project } from './projectModel';

type Model = { scope: string; rows: Project[]; summaries: Map<string, QuoteSummary>; quoteError: boolean; loading: boolean; loaded: boolean; error: string };
const empty = (scope: string): Model => ({ scope, rows: [], summaries: new Map(), quoteError: false, loading: false, loaded: false, error: '' });
export function LeadProjectsSection({ accountId, accountScope, leadId }: {
  accountId: string; accountScope: string | number; leadId: string;
}) {
  const router = useRouter();
  const scope = `${accountScope}:${accountId}:${leadId}`;
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  const reload = useCallback(async () => {
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const rows = await listLeadProjects(accountId, leadId);
      let summaries = new Map<string, QuoteSummary>();
      let quoteError = false;
      try { summaries = await loadProjectQuoteSummaries(accountId, rows); }
      catch { quoteError = true; }
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, rows, summaries, quoteError, loading: false, loaded: true, error: '' });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)),
        loading: false, error: projectFailureMessage(error) }));
    }
  }, [accountId, leadId, scope]);
  useFocusEffect(useCallback(() => {
    setStored(empty(scope)); void reload();
    return () => { generation.current++; };
  }, [reload, scope]));
  return (
    <AppCard>
      <AppText variant="section">Projects ({model.loaded ? model.rows.length : '…'})</AppText>
      <AppButton label="Create Project" onPress={() => router.push({ pathname: '/project/new', params: { leadId } })} />
      {model.loading ? <AppText accessibilityRole="alert">Loading customer projects…</AppText> : null}
      {model.quoteError ? <AppText accessibilityRole="alert">Quote details unavailable. Refresh to retry.</AppText> : null}
      {model.error ? <View style={styles.group}>
        <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
        <AppButton label="Retry customer projects" variant="secondary" onPress={() => void reload()} />
      </View> : null}
      {model.loaded && !model.loading && !model.error && model.rows.length === 0 ?
        <AppText muted>No projects for this customer yet.</AppText> : null}
      {model.rows.map((project) => <ProjectCard key={project.id} project={project} quoteSummary={model.summaries.get(project.id)} quoteUnavailable={model.quoteError}
        onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })} />)}
    </AppCard>
  );
}
const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText } });
