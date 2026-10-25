# Security and data protection

## Credentials and identity

Expo public environment values are bundled into the client. Only the Supabase HTTPS URL and publishable key belong there; never include service-role keys, database passwords, SMTP credentials or administrative tokens. `.env` and local Supabase state are ignored. Do not log passwords, OTPs, sessions, signed photo URLs or customer content.

Native sessions use Expo SecureStore with device-only keychain accessibility. The app requires a non-anonymous, confirmed identity validated by `getUser`; local session contents alone cannot authorize access. Sign-out retires the client, clears encrypted credentials and starts account notification cleanup. A session-error screen provides retry and explicit credential clearing.

Keep hosted email confirmation enabled. Most CRM policies check authenticated ownership and reject anonymous Auth users; they rely on Auth configuration to withhold unconfirmed email/password sessions. Storage additionally checks confirmation in `auth.users`. User-editable metadata is not an authorization source.

## Database and Storage

All 11 application tables enable RLS. Clients receive limited table/column grants; the quote request ledger has no client access. Direct writes cannot change ownership, project decisions, quote snapshots or historical events. Public privileged RPCs revoke default public execution, use an empty `search_path`, and explicitly check the calling owner.

The private `project-site-photos` bucket permits JPEG objects up to 10 MiB at `<user>/<project>/<photo>.jpg`. Policies validate ownership, association and allowed Storage operations; overwrites, move/copy and signed uploads are outside the supported flow. Signed read URLs expire after five minutes and remain bearer capabilities during that interval.

Active photo metadata prevents normal object deletion. Requested deletions require the `deleting` transition, and metadata cannot be finalized while its object remains. Current repair code retains untracked uploads. Existing server policy still permits an owner to remove untracked objects directly, so older clients and future orphan-reclamation tools need separate review or server-coordinated reservations.

## Operational requirements

Keep applied migrations immutable. Use disposable local/staging accounts and explicitly scoped fixtures for write/security tests; never reset shared databases or change real customer records for QA. Rollback SQL fixtures require database-owner access and belong only on the local test stack. Use the Storage API for object lifecycle.

Recheck dependency advisories, deployed grants/RLS, Auth configuration and native behavior before release. Supabase sign-out revokes refresh credentials; already issued access tokens can remain valid until expiry. Offline devices can retain stale generic alerts until reconciliation. Current unresolved findings are recorded only in [FINAL_AUDIT.md](../FINAL_AUDIT.md).
