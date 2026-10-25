import { createClient } from '@supabase/supabase-js';
import { createSiteQuoteClient, getSupabaseClient, retireSupabaseClient } from '../supabase';
import { createSecureSessionStorage, AUTH_STORAGE_KEY } from '../secureSessionStorage';

jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({ auth: { stopAutoRefresh: jest.fn() } })) }));
jest.mock('../secureSessionStorage', () => ({
  AUTH_STORAGE_KEY: 'sitequote.auth.v1', createSecureSessionStorage: jest.fn()
}));
const createClientMock = jest.mocked(createClient);
const createStorageMock = jest.mocked(createSecureSessionStorage);
const retire = jest.fn().mockResolvedValue(undefined);
const storage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
const config = { status: 'ready' as const, url: 'https://example.supabase.co', publishableKey: 'sb_publishable_public_example' };

beforeEach(() => {
  jest.clearAllMocks();
  void retireSupabaseClient();
  createStorageMock.mockReturnValue({ storage, retire });
});

test('lazy client requires valid backend configuration', () => {
  const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const prevKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(getSupabaseClient()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  } finally {
    if (prevUrl !== undefined) process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;
    if (prevKey !== undefined) process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevKey;
  }
});

test('uses only encrypted session storage and keeps URL detection disabled', () => {
  createSiteQuoteClient(config);
  expect(createClientMock).toHaveBeenCalledWith(config.url, config.publishableKey, {
    auth: {
      storage, storageKey: AUTH_STORAGE_KEY,
      flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false
    }
  });
});
