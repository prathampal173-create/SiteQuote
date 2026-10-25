import { Text, type TextProps } from 'react-native';
import { colors, typography } from '../config/theme';

type TextVariant = keyof typeof typography;

type Props = TextProps & {
  variant?: TextVariant;
  muted?: boolean;
};

export function AppText({ variant = 'body', muted = false, style, ...props }: Props) {
  return (
    <Text
      allowFontScaling
      {...props}
      style={[typography[variant], { color: muted ? colors.mutedText : colors.text }, style]}
    />
  );
}
