import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { colors, layout, radius, spacing } from '../../config/theme';

type Props<T extends string> = {
  label: string;
  options: readonly T[];
  selected: T;
  text: (value: T) => string;
  onSelect: (value: T) => void;
  disabled?: boolean;
};

export function LeadChoices<T extends string>({ label, options, selected, text, onSelect, disabled }: Props<T>) {
  return (
    <View style={styles.group} accessibilityLabel={label}>
      <AppText>{label}</AppText>
      <View style={styles.row}>
        {options.map((option) => (
          <Pressable key={option} accessibilityRole="button" accessibilityLabel={`${label}: ${text(option)}`}
            accessibilityState={{ selected: selected === option, disabled: Boolean(disabled) }}
            disabled={disabled} onPress={() => onSelect(option)}
            style={[styles.choice, selected === option && styles.selected]}>
            <AppText style={{ color: selected === option ? colors.surface : colors.primary }}>{text(option)}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: { minHeight: layout.minTouchTarget, borderColor: colors.primary, borderWidth: 1,
    borderRadius: radius.input, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: colors.primary }
});
