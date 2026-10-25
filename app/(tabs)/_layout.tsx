import { Redirect, Tabs } from 'expo-router';
import { useAuthFlow } from '../../src/features/auth/AuthFlowProvider';
import { colors } from '../../src/config/theme';

export default function TabLayout() {
  // Defense in depth: never expose tabs via preview or deep links without verified OTP.
  const { authorized } = useAuthFlow();
  if (!authorized) return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border }
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="leads" options={{ title: 'Leads' }} />
      <Tabs.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
