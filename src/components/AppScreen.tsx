import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, layout, spacing } from '../config/theme';

type Props = { children: ReactNode };

export function AppScreen({ children }: Props) {
  const { width } = useWindowDimensions();
  const gutter = width < layout.narrowWidth ? layout.narrowGutter : layout.gutter;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={[styles.content, { paddingHorizontal: gutter }]}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md
  }
});
