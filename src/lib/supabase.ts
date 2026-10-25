import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getBackendConfiguration, type BackendConfiguration } from '../config/env';
import { AUTH_STORAGE_KEY, createSecureSessionStorage } from './secureSessionStorage';
import type { Database } from './database.types';

export type SiteQuoteDatabase = Database;
export type SiteQuoteClient = SupabaseClient<SiteQuoteDatabase>;
type ReadyConfiguration = Extract<BackendConfiguration, { status: 'ready' }>;

let cachedClient: SiteQuoteClient | null = null;
let retireStorage: (() => Promise<void>) | null = null;

export function createSiteQuoteClient(configuration: ReadyConfiguration): SiteQuoteClient {
  const { storage, retire } = createSecureSessionStorage();
  // Client creation is only performed through getSupabaseClient in the app.
  retireStorage = retire;
  return createClient<SiteQuoteDatabase>(configuration.url, configuration.publishableKey, {
    auth: {
      storage,
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'implicit',
      detectSessionInUrl: false
    }
  });
}

/** Never create a client when the public backend configuration is missing. */
export function getSupabaseClient(): SiteQuoteClient | null {
  const configuration = getBackendConfiguration();
  if (configuration.status !== 'ready') return null;
  if (!cachedClient) cachedClient = createSiteQuoteClient(configuration);
  return cachedClient;
}

/** Check a pending request without creating a client during account cleanup. */
export function isCurrentSupabaseClient(client: SiteQuoteClient): boolean {
  return cachedClient === client;
}

/** Invalidate old SDK memory and fence off late async writes before clearing tokens. */
export async function retireSupabaseClient(): Promise<void> {
  cachedClient?.auth.stopAutoRefresh();
  const finishStorage = retireStorage;
  retireStorage = null;
  cachedClient = null;
  // A late old-client write must finish before the local sign-out wipe.
  if (finishStorage) await finishStorage();
}
