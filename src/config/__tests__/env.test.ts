import { getBackendConfiguration, validateBackendEnvironment } from '../env';

const valid = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public_example'
};

describe('public Supabase configuration', () => {
  it('allows startup with no backend values', () => {
    expect(validateBackendEnvironment({})).toEqual({ status: 'unconfigured' });
    expect(validateBackendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: ' ',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ''
    })).toEqual({ status: 'unconfigured' });
  });

  it.each([
    [{ EXPO_PUBLIC_SUPABASE_URL: valid.EXPO_PUBLIC_SUPABASE_URL }, 'PUBLISHABLE_KEY'],
    [{ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, 'URL']
  ])('rejects an incomplete environment', (input, missingPart) => {
    const result = validateBackendEnvironment(input);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.errors.join(' ')).toContain(missingPart);
  });

  it.each([
    'not-a-url',
    'http://example.supabase.co',
    'https://user:pass@example.supabase.co',
    'https://example.supabase.co/not-an-origin',
    'https://example.supabase.co/?token=private',
    'https://example.supabase.co/#fragment'
  ])('rejects malformed or unsafe URL %s', (url) => {
    expect(validateBackendEnvironment({ ...valid, EXPO_PUBLIC_SUPABASE_URL: url }).status).toBe('invalid');
  });

  it.each([
    'sb_secret_DO_NOT_EXPOSE',
    'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
    'sb_publishable_',
    'not-a-key'
  ])('rejects invalid or secret key classes without including input in errors', (key) => {
    const result = validateBackendEnvironment({ ...valid, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key });
    expect(result.status).toBe('invalid');
    // The public key prefix is documentation, not a secret value.
    if (result.status === 'invalid' && key !== 'sb_publishable_')
      expect(result.errors.join(' ')).not.toContain(key);
  });

  it('accepts and trims a publishable-only configuration', () => {
    expect(validateBackendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: ` ${valid.EXPO_PUBLIC_SUPABASE_URL} `,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ` ${valid.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY} `
    })).toEqual({ status: 'ready', url: valid.EXPO_PUBLIC_SUPABASE_URL,
      publishableKey: valid.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  });

  it('reads static Expo public environment variables', () => {
    const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const previousKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      process.env.EXPO_PUBLIC_SUPABASE_URL = valid.EXPO_PUBLIC_SUPABASE_URL;
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = valid.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      expect(getBackendConfiguration().status).toBe('ready');
    } finally {
      if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    }
  });
});
