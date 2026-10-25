import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadBusinessProfile, profileFailureMessage, saveBusinessProfile,
  validateBusinessProfile, type BusinessProfileInput
} from './businessProfile';

type ProfileModel = {
  scope: string;
  values: BusinessProfileInput;
  exists: boolean;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
  success: string;
  nameError: string;
};

const blank: BusinessProfileInput = { businessName: '', phone: '', address: '' };
function emptyModel(scope: string): ProfileModel {
  return { scope, values: { ...blank }, exists: false, loaded: false, loading: false,
    saving: false, error: '', success: '', nameError: '' };
}

/** Scope is invalidated by sign-out/switch; old requests can never populate a new account's form. */
export function useBusinessProfile(accountId: string | null, accountScope: number) {
  const scope = accountId ? `${accountScope}:${accountId}` : '';
  const [stored, setStored] = useState<ProfileModel>(() => emptyModel(scope));
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const busy = useRef(false);
  // Until the scope's load has completed, never render the previous account's values.
  const model = stored.scope === scope ? stored : emptyModel(scope);

  const reload = useCallback(async () => {
    if (!accountId || busy.current) return;
    const myRequest = ++request.current;
    setStored((prev) => ({ ...(prev.scope === scope ? prev : emptyModel(scope)),
      scope, loading: true, error: '', success: '' }));
    try {
      const profile = await loadBusinessProfile(accountId);
      if (request.current !== myRequest || currentScope.current !== scope) return;
      setStored({ scope, values: profile ? {
        businessName: profile.business_name,
        phone: profile.phone ?? '', address: profile.address ?? ''
      } : { ...blank }, exists: Boolean(profile), loaded: true,
      loading: false, saving: false, error: '', success: '', nameError: '' });
    } catch (error) {
      if (request.current !== myRequest || currentScope.current !== scope) return;
      setStored((prev) => ({ ...prev, loading: false, error: profileFailureMessage(error) }));
    }
  }, [accountId, scope]);

  useEffect(() => {
    request.current++;
    busy.current = false;
    setStored(emptyModel(scope));
    if (accountId) void reload();
    return () => { request.current++; };
  }, [accountId, scope, reload]);

  const setField = useCallback((field: keyof BusinessProfileInput, text: string) => {
    setStored((prev) => prev.scope === currentScope.current
      ? { ...prev, values: { ...prev.values, [field]: text }, success: '', error: '',
        nameError: field === 'businessName' ? '' : prev.nameError }
      : prev);
  }, []);

  const save = useCallback(async () => {
    if (!accountId || busy.current || model.loading || !model.loaded) return;
    const checked = validateBusinessProfile(model.values);
    if (!checked.ok) {
      setStored((prev) => prev.scope === scope ? { ...prev, nameError: checked.message, success: '' } : prev);
      return;
    }
    busy.current = true;
    const myRequest = ++request.current;
    setStored((prev) => ({ ...prev, saving: true, error: '', success: '', nameError: '' }));
    try {
      const result = await saveBusinessProfile(accountId, model.values, model.exists);
      if (request.current !== myRequest || currentScope.current !== scope) return;
      setStored((prev) => ({ ...prev, exists: true, saving: false,
        values: { businessName: result.business_name, phone: result.phone ?? '',
          address: result.address ?? '' }, success: 'Business profile saved.', error: '' }));
    } catch (error) {
      if (request.current !== myRequest || currentScope.current !== scope) return;
      // Preserve all draft fields on any failed save, including network errors.
      setStored((prev) => ({ ...prev, saving: false, error: profileFailureMessage(error) }));
    } finally {
      if (currentScope.current === scope) busy.current = false;
    }
  }, [accountId, model, scope]);

  return { ...model, setField, reload, save };
}
