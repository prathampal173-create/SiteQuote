import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { colors, layout, radius, spacing } from '../config/theme';
import { AppText } from './AppText';

type Props = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary';
};

export function AppButton({ label, variant = 'primary', disabled, style, ...props }: Props) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      {...props}
      style={(state) => [
        styles.button,
        primary ? styles.primary : styles.secondary,
        primary && state.pressed && styles.primaryPressed,
        disabled && styles.disabled,
        typeof style === 'function' ? style(state) : style
      ]}
    >
      <AppText style={[styles.label, { color: primary ? colors.surface : colors.primary }]}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.minTouchTarget,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  disabled: { opacity: 0.5 },
  label: { fontWeight: '600', textAlign: 'center' }
});
