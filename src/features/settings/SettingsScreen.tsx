import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppField } from '../../components/AppField';
import { AppScreen } from '../../components/AppScreen';
import { AppText } from '../../components/AppText';
import { colors, spacing } from '../../config/theme';
import { useAuthFlow } from '../auth/AuthFlowProvider';
import { useBusinessProfile } from './useBusinessProfile';

export function SettingsScreen() {
  const { signOut, accountId, accountScope } = useAuthFlow();
  const profile = useBusinessProfile(accountId, accountScope);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const signOutPending = useRef(false);

  async function handleSignOut() {
    if (signOutPending.current) return;
    signOutPending.current = true;
    setSigningOut(true);
    setSignOutError('');
    try {
      if (!await signOut()) setSignOutError('Local credential cleanup could not finish. Retry sign-out.');
    } catch {
      setSignOutError('Local credential cleanup could not finish. Retry sign-out.');
    } finally {
      signOutPending.current = false;
      setSigningOut(false);
    }
  }

  const unavailable = !accountId || signingOut;
  const inputsDisabled = unavailable || profile.loading || profile.saving || !profile.loaded;
  return (
    <AppScreen>
      <AppText variant="title">Settings</AppText>
      <AppCard>
        <AppText variant="section">Business profile</AppText>
        <AppText variant="caption" muted>
          Your business name is required when preparing a quote, not to use the rest of SiteQuote.
        </AppText>
        {profile.loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <ActivityIndicator accessibilityLabel="Loading business profile" color={colors.primary} />
            <AppText muted>Loading business profile…</AppText>
          </View>
        ) : null}
        <AppField label="Business name" placeholder="Your business name" value={profile.values.businessName}
          onChangeText={(text) => profile.setField('businessName', text)}
          autoCapitalize="words" editable={!inputsDisabled} error={profile.nameError} />
        <AppField label="Business phone (optional)" placeholder="Business phone" value={profile.values.phone}
          onChangeText={(text) => profile.setField('phone', text)}
          keyboardType="phone-pad" editable={!inputsDisabled} />
        <AppField label="Business address (optional)" placeholder="Business address"
          value={profile.values.address} onChangeText={(text) => profile.setField('address', text)}
          multiline textAlignVertical="top" editable={!inputsDisabled} />
        {profile.error ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>
          {profile.error}</AppText> : null}
        {profile.success ? <AppText accessibilityRole="alert" style={{ color: colors.successText }}>
          {profile.success}</AppText> : null}
        {!profile.loaded && !profile.loading && accountId ? (
          <AppButton label="Retry loading profile" variant="secondary" onPress={() => void profile.reload()} />
        ) : null}
        <AppButton label={profile.saving ? 'Saving…' : 'Save'}
          disabled={inputsDisabled} onPress={() => void profile.save()} />
      </AppCard>
      {signOutError ? <AppText accessibilityRole="alert" style={{ color: colors.dangerText }}>
        {signOutError}</AppText> : null}
      <AppButton label={signingOut ? 'Signing out…' : 'Sign Out'} disabled={signingOut}
        variant="secondary" onPress={() => void handleSignOut()} />
    </AppScreen>
  );
}
