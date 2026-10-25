import { Pressable, StyleSheet } from 'react-native';
import { AppCard } from '../../components/AppCard';
import { AppText } from '../../components/AppText';
import { colors, layout } from '../../config/theme';
import { PROJECT_LABELS, type Project } from './projectModel';
import { quoteSummaryLine, type QuoteSummary } from './projectQuoteSummary';

export function ProjectCard({ project, onPress, leadName, quoteSummary, quoteUnavailable = false }: {
  project: Project; onPress: () => void; leadName?: string; quoteSummary?: QuoteSummary; quoteUnavailable?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button"
      accessibilityLabel={`Open project ${project.title}, ${PROJECT_LABELS[project.status]}`}
      onPress={onPress} style={styles.pressable}>
      <AppCard>
        <AppText variant="section">{project.title}</AppText>
        {leadName ? <AppText muted>Customer: {leadName}</AppText> : null}
        {project.site_address ? <AppText muted>Site: {project.site_address}</AppText> : null}
        <AppText style={styles.status}>Status: {PROJECT_LABELS[project.status]}</AppText>
        <AppText muted>{quoteUnavailable ? 'Quote information unavailable — retry' : quoteSummary === undefined ? 'Loading quote reference…' : quoteSummaryLine(project, quoteSummary)}</AppText>
      </AppCard>
    </Pressable>
  );
}
const styles = StyleSheet.create({ pressable: { minHeight: layout.minTouchTarget }, status: { color: colors.primary } });
