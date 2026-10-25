import type { Database } from '../../lib/database.types';
import { getSupabaseClient } from '../../lib/supabase';
import { validateServerSession } from '../auth/sessionValidation';

export type BusinessProfile = Database['public']['Tables']['business_profiles']['Row'];
export type BusinessProfileInput = { businessName: string; phone: string; address: string };
export type ProfileFailure = 'configuration' | 'session' | 'request' | 'not_found';

export class BusinessProfileFailure extends Error {
  constructor(public readonly reason: ProfileFailure) {
    super(reason);
    this.name = 'BusinessProfileFailure';
  }
}

/** Normalize whitespace; the database additionally enforces nonblank names. */
export function validateBusinessProfile(input: BusinessProfileInput):
  | { ok: true; values: Pick<BusinessProfile, 'business_name' | 'phone' | 'address'> }
  | { ok: false; message: string } {
  const business_name = input.businessName.trim();
  if (!business_name) return { ok: false, message: 'Business name is required.' };
  return {
    ok: true,
    values: {
      business_name,
      phone: input.phone.trim() || null,
      address: input.address.trim() || null
    }
  };
}

async function authorizedClient(expectedUserId: string) {
  const client = getSupabaseClient();
  if (!client) throw new BusinessProfileFailure('configuration');
  try {
    // A stored user ID or local getSession() is not proof of authentication.
    const identity = await validateServerSession(client);
    if (!identity || identity.userId !== expectedUserId) throw new BusinessProfileFailure('session');
    return client;
  } catch (error) {
    if (error instanceof BusinessProfileFailure) throw error;
    throw new BusinessProfileFailure('session');
  }
}

/** An exact owner filter supplements, but never replaces, PostgreSQL RLS. */
export async function loadBusinessProfile(expectedUserId: string): Promise<BusinessProfile | null> {
  const client = await authorizedClient(expectedUserId);
  try {
    const { data, error } = await client.from('business_profiles')
      .select('user_id,business_name,phone,address')
      .eq('user_id', expectedUserId).maybeSingle();
    if (error) throw error;
    return data;
  } catch {
    throw new BusinessProfileFailure('request');
  }
}

export async function saveBusinessProfile(
  expectedUserId: string,
  input: BusinessProfileInput,
  exists: boolean
): Promise<BusinessProfile> {
  const checked = validateBusinessProfile(input);
  if (!checked.ok) throw new Error(checked.message);
  const client = await authorizedClient(expectedUserId);
  try {
    if (!exists) {
      const { data, error } = await client.from('business_profiles')
        .insert({ user_id: expectedUserId, ...checked.values })
        .select('user_id,business_name,phone,address').single();
      if (error || !data) throw error ?? new Error('insert');
      return data;
    }
    // Ownership and PK cannot be changed by the client (column grants + RLS).
    const { data, error } = await client.from('business_profiles')
      .update(checked.values)
      .eq('user_id', expectedUserId)
      .select('user_id,business_name,phone,address').maybeSingle();
    if (error) throw error;
    if (!data) throw new BusinessProfileFailure('not_found');
    return data;
  } catch (error) {
    if (error instanceof BusinessProfileFailure) throw error;
    throw new BusinessProfileFailure('request');
  }
}

export type QuoteBusinessNameEligibility =
  | { eligible: true; businessName: string }
  | { eligible: false; reason: 'missing_business_name' | 'unavailable' | 'unauthorized' };

/** Future Phase 3C RPC MUST separately check saved business name server-side. */
export async function checkSavedBusinessNameForQuote(
  expectedUserId: string
): Promise<QuoteBusinessNameEligibility> {
  try {
    const profile = await loadBusinessProfile(expectedUserId);
    const name = profile?.business_name.trim() ?? '';
    return name
      ? { eligible: true, businessName: name }
      : { eligible: false, reason: 'missing_business_name' };
  } catch (error) {
    return {
      eligible: false,
      reason: error instanceof BusinessProfileFailure && error.reason === 'session'
        ? 'unauthorized' : 'unavailable'
    };
  }
}

export function profileFailureMessage(error: unknown): string {
  if (error instanceof BusinessProfileFailure) {
    if (error.reason === 'configuration') return 'Supabase is not configured. Add the public backend settings.';
    if (error.reason === 'session') return 'Your verified session is unavailable. Sign in again.';
    if (error.reason === 'not_found') return 'Business profile no longer exists. Reload Settings and try again.';
  }
  return 'Could not reach the business profile. Check your connection and retry.';
}
