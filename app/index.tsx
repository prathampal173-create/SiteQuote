import { useRouter } from 'expo-router';
import { AppButton } from '../src/components/AppButton';
import { AppScreen } from '../src/components/AppScreen';
import { AppText } from '../src/components/AppText';

export default function Welcome() {
  const router = useRouter();
  return (
    <AppScreen>
      <AppText variant="title">SiteQuote</AppText>
      <AppText>Contractor CRM for leads, projects, quotes and follow-ups.</AppText>
      <AppButton label="Sign Up" onPress={() => router.push('/sign-up')} />
      <AppButton label="Log In" variant="secondary" onPress={() => router.push('/log-in')} />
    </AppScreen>
  );
}
