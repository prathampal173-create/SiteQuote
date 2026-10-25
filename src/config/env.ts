/** Public-only Expo configuration; missing backend settings must not block startup. */
export type BackendConfiguration =
  | { status: 'unconfigured' }
  | { status: 'invalid'; errors: readonly string[] }
  | { status: 'ready'; url: string; publishableKey: string };

export type PublicEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

export function validateBackendEnvironment(env: PublicEnvironment): BackendConfiguration {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url && !publishableKey) return { status: 'unconfigured' };

  const errors: string[] = [];
  if (!url) {
    errors.push('EXPO_PUBLIC_SUPABASE_URL is missing.');
  } else {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'https:' ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== '/'
      ) {
        errors.push('EXPO_PUBLIC_SUPABASE_URL must be an HTTPS origin without credentials, path, query, or fragment.');
      }
    } catch {
      errors.push('EXPO_PUBLIC_SUPABASE_URL is not a valid URL.');
    }
  }

  if (!publishableKey) {
    errors.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.');
  } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    // Reject sb_secret_, legacy JWTs (including service_role), and non-publishable keys.
    errors.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be an sb_publishable_ key, never a secret or legacy API key.');
  }

  return errors.length ? { status: 'invalid', errors } : { status: 'ready', url, publishableKey };
}

export function getBackendConfiguration(): BackendConfiguration {
  // Expo requires static process.env.EXPO_PUBLIC_ references for bundler inlining.
  return validateBackendEnvironment({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  });
}
