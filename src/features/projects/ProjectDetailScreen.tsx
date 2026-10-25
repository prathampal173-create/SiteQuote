import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { loadProject, projectFailureMessage } from './projectsApi';
import { PROJECT_LABELS, type Project } from './projectModel';
import { ProjectTasksSection } from '../tasks/ProjectTasksSection';
import { ProjectEstimateSection } from '../estimates/ProjectEstimateSection';
import { UnsentEstimateSection } from '../estimates/UnsentEstimateSection';
import { PreparedQuotesSection } from '../estimates/PreparedQuotesSection';
import { ProjectDecisionControls } from './ProjectDecisionControls';
import { loadProjectQuoteSummaries, quoteSummaryLine, type QuoteSummary } from './projectQuoteSummary';
import { PhotoStagingSection } from '../photos/PhotoStagingSection';
import { PhotoGallerySection } from '../photos/PhotoGallerySection';
import { RelatedRemindersSection } from '../reminders/RelatedRemindersSection';

type Model = { scope: string; project: Project | null; quoteSummary?: QuoteSummary; quoteError: boolean; loading: boolean; error: string };
const empty = (scope: string): Model => ({ scope, project: null, quoteError: false, loading: false, error: '' });
export function ProjectDetailScreen({ id, saved }: { id: string; saved?: string }) {
  const router = useRouter();
  const { accountId, accountScope } = useAuthFlow();
  const scope = accountId ? `${accountScope}:${accountId}:${id}` : '';
  const [stored, setStored] = useState<Model>(() => empty(scope));
  const [photoRevision, setPhotoRevision] = useState(0);
  const [pricingRevision, setPricingRevision] = useState(0);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const model = stored.scope === scope ? stored : empty(scope);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const ticket = ++generation.current;
    setStored((previous) => ({ ...(previous.scope === scope ? previous : empty(scope)), loading: true, error: '' }));
    try {
      const project = await loadProject(accountId, id);
      let quoteError = false;
      let quoteSummary: QuoteSummary = null;
      try { quoteSummary = (await loadProjectQuoteSummaries(accountId, [project])).get(project.id) ?? null; }
      catch { quoteError = true; }
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, project, quoteSummary, quoteError, loading: false, error: '' });
    } catch (error) {
      if (ticket !== generation.current || currentScope.current !== scope) return;
      setStored({ scope, project: null, quoteError: false, loading: false, error: projectFailureMessage(error) });
    }
  }, [accountId, id, scope]);

  useFocusEffect(useCallback(() => {
    void reload();
    return () => { generation.current++; };
  }, [reload, scope]));

  return (
    <AppScreen>
      <AppText variant="title">Project Detail</AppText>
      <AppButton variant="secondary" label="Back" onPress={() => router.back()} />
      {model.loading ? <AppText accessibilityRole="alert">Loading project…</AppText> : null}
      {model.error ? <View style={styles.group}>
        <AppText accessibilityRole="alert" style={styles.error}>{model.error}</AppText>
        <AppButton variant="secondary" label="Retry loading project" onPress={() => void reload()} />
      </View> : null}
      {model.project ? <AppCard>
        <AppText variant="section">{model.project.title}</AppText>
        <AppText>Status: {PROJECT_LABELS[model.project.status]}</AppText>
        <AppText>{model.quoteError ? 'Quote information unavailable — refresh to retry' :
          model.quoteSummary === undefined ? 'Loading quote reference…' : quoteSummaryLine(model.project, model.quoteSummary)}</AppText>
        <AppText>Site address: {model.project.site_address || 'Not provided'}</AppText>
        <AppText>Internal notes: {model.project.notes || 'None'}</AppText>
        {saved ? <AppText accessibilityRole="alert" style={styles.success}>Project saved.</AppText> : null}
        <AppButton label="Edit Project" onPress={() => router.push({ pathname: '/project/edit/[id]', params: { id } })} />
        <AppButton variant="secondary" label="View Customer Projects"
          onPress={() => router.push({ pathname: '/lead/[id]', params: { id: model.project!.lead_id } })} />
      </AppCard> : null}
      {model.project && accountId ? <RelatedRemindersSection accountId={accountId} accountScope={accountScope}
        leadId={model.project.lead_id} projectId={model.project.id} /> : null}
      {model.project && accountId ? <ProjectDecisionControls key={scope} project={model.project}
        accountId={accountId} accountScope={accountScope} refreshKey={quoteRevision}
        onChanged={() => { setPricingRevision((n) => n + 1); void reload(); }} /> : null}
      {model.project && accountId ? <PhotoStagingSection accountId={accountId} accountScope={accountScope}
        projectId={model.project.id} onSaved={() => setPhotoRevision((n) => n + 1)} /> : null}
      {model.project && accountId ? <PhotoGallerySection accountId={accountId} accountScope={accountScope}
        projectId={model.project.id} refreshKey={photoRevision} /> : null}
      {model.project && accountId ? <ProjectTasksSection accountId={accountId} accountScope={accountScope}
        projectId={model.project.id} closed={model.project.status === 'won' || model.project.status === 'lost'} /> : null}
      {model.project && accountId ? <ProjectEstimateSection key={`estimate:${scope}:${model.project.status}`}
        accountId={accountId} accountScope={accountScope} projectId={model.project.id}
        closed={model.project.status === 'won' || model.project.status === 'lost'}
        onPricingChanged={() => setPricingRevision((n) => n + 1)} /> : null}
      {model.project && accountId ? <UnsentEstimateSection key={`unsent:${scope}`} accountId={accountId}
        accountScope={accountScope} projectId={model.project.id} refreshKey={pricingRevision} /> : null}
      {model.project && accountId ? <PreparedQuotesSection key={`quotes:${scope}`} accountId={accountId}
        accountScope={accountScope} projectId={model.project.id} leadId={model.project.lead_id} refreshKey={pricingRevision}
        closed={model.project.status === 'won' || model.project.status === 'lost'}
        onStatusChanged={() => { setQuoteRevision((n) => n + 1); void reload(); }} /> : null}
    </AppScreen>
  );
}
const styles = StyleSheet.create({ group: { gap: spacing.xs }, error: { color: colors.dangerText },
  success: { color: colors.successText } });
