import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, layout, radius, spacing } from '../config/theme';
import { AppText } from './AppText';

type Props = TextInputProps & { label: string; error?: string };

export function AppField({ label, error, style, ...props }: Props) {
  return (
    <View style={styles.wrapper}>
      <AppText>{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedText}
        {...props}
        style={[styles.input, Boolean(error) && styles.inputError, style]}
      />
      {error ? <AppText variant="caption" style={styles.error}>{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.input,
    fontSize: 15,
    color: colors.text
  },
  inputError: { borderColor: colors.dangerText },
  error: { color: colors.dangerText }
});
