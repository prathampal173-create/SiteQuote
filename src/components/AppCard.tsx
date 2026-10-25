import { View, StyleSheet, type ViewProps } from 'react-native';
import { colors, radius, spacing } from '../config/theme';

export function AppCard({ style, ...props }: ViewProps) {
  return <View {...props} style={[styles.card, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs
  }
});
