import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet } from 'react-native';
import { AuthFlowProvider, useAuthFlow } from '../src/features/auth/AuthFlowProvider';
import { AppButton } from '../src/components/AppButton';
import { AppText } from '../src/components/AppText';
import { colors, spacing } from '../src/config/theme';
import { NotificationTapCoordinator } from '../src/features/notifications/NotificationTapCoordinator';
import { NotificationLifecycleCoordinator } from '../src/features/notifications/NotificationLifecycleCoordinator';

function RootStack() {
  const { authorized, checking, sessionError, retryRestore, signOut } = useAuthFlow();
  // Keep the Router navigator mounted even while validating; overlay hides all navigation.
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={!authorized}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="verify-email" />
          <Stack.Screen name="log-in" />
        </Stack.Protected>
        <Stack.Protected guard={authorized && !checking}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="lead" />
          <Stack.Screen name="project" />
          <Stack.Screen name="projects" />
          <Stack.Screen name="task" />
          <Stack.Screen name="reminder" />
        </Stack.Protected>
      </Stack>
      {checking || sessionError && !authorized ? (
        <View style={[StyleSheet.absoluteFill, styles.loading]} accessibilityLabel="Session status">
          {checking ? <AppText>Checking your session…</AppText> : (
            <>
              <AppText variant="title">Session unavailable</AppText>
              <AppText accessibilityRole="alert">{sessionError}</AppText>
              <AppButton label="Retry secure session check" onPress={() => void retryRestore()} />
              <AppButton label="Clear saved session" variant="secondary" onPress={() => void signOut()} />
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: spacing.xl, gap: spacing.md }
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthFlowProvider><RootStack /><NotificationTapCoordinator /><NotificationLifecycleCoordinator /></AuthFlowProvider>
    </SafeAreaProvider>
  );
}
