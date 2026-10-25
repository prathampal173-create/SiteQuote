import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { LeadChoices } from '../leads/LeadChoices';
import { ProjectCard } from './ProjectCard';
import { loadProjectQuoteSummaries, type QuoteSummary } from './projectQuoteSummary';
import { listProjects, projectFailureMessage } from './projectsApi';
import { filterProjects, PROJECT_FILTERS, PROJECT_LABELS, type ProjectFilter, type ProjectWithLead } from './projectModel';
import { dashboardProjectFilter } from '../dashboard/dashboardModel';

type Model = { scope: string; rows: ProjectWithLead[]; summaries: Map<string, QuoteSummary>; quoteError: boolean; loading: boolean; loaded: boolean; error: string };
const empty = (scope: string): Model => ({ scope, rows: [], summaries: new Map(), quoteError: false, loading: false, loaded: false, error: '' });
export function ProjectsScreen() {
  const router = useRouter();
  const { status, dashboard } = useLocalSearchParams<{ status?: string; dashboard?: string }>();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);
  // Preserve the selected filter when returning from a project, but reset across accounts.
  useEffect(() => { setFilter('all'); }, [scope]);
  // Dashboard routes must take precedence over a previously selected project filter.
  useEffect(() => {
    if (dashboard) setFilter(dashboardProjectFilter(status) ?? 'all');
  }, [dashboard, status]);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const rows = await listProjects(accountId);
      let summaries = new Map<string, QuoteSummary>();
      let quoteError = false;
      try { summaries = await loadProjectQuoteSummaries(accountId, rows.map((entry) => entry.project)); }
      catch { quoteError = true; }
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, rows, summaries, quoteError, loaded: true, loading: false, error: '' });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: false,
        error: projectFailureMessage(error) }));
    }
  }, [accountId, scope]);

  useFocusEffect(useCallback(() => {
    setStored(empty(scope));
    void reload();
    return () => { generation.current++; };
  }, [reload, scope]));

  const rows = filterProjects(model.rows, filter);
  return (
    <AppScreen>
      <AppText variant="title">Projects</AppText>
      <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
      <LeadChoices label="Project filter" options={PROJECT_FILTERS} selected={filter}
        text={(choice) => choice === 'all' ? 'All Projects' : PROJECT_LABELS[choice]}
        onSelect={setFilter} />
      {model.loading ? <AppText accessibilityRole="alert">Loading projects…</AppText> : null}
      {model.quoteError ? <AppText accessibilityRole="alert">Quote details unavailable. Refresh the projects list to retry.</AppText> : null}
      {model.error ? <View style={styles.group}>
        <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
        <AppButton variant="secondary" label="Retry loading projects" onPress={() => void reload()} />
      </View> : null}
      {!model.loading && !model.error && model.loaded && model.rows.length === 0 ?
        <AppText muted>No projects yet. Open a lead to create its first project.</AppText> : null}
      {!model.loading && !model.error && model.loaded && model.rows.length > 0 && rows.length === 0 ?
        <AppText muted>No projects match this status.</AppText> : null}
      {rows.map(({ project, leadName }) => <ProjectCard key={project.id} project={project} leadName={leadName} quoteSummary={model.summaries.get(project.id)} quoteUnavailable={model.quoteError}
        onPress={() => router.push({ pathname: '/project/[id]', params: { id: project.id } })} />)}
    </AppScreen>
  );
}
const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText } });
