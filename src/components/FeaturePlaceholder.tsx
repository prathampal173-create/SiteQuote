import { AppCard } from './AppCard';
import { AppText } from './AppText';

type Props = { heading: string; detail: string };

export function FeaturePlaceholder({ heading, detail }: Props) {
  return (
    <AppCard>
      <AppText variant="section">{heading}</AppText>
      <AppText muted>{detail}</AppText>
    </AppCard>
  );
}
