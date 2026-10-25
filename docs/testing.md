# Testing

Record actual execution outcomes in [FINAL_AUDIT.md](../FINAL_AUDIT.md). Raw current logs/JSON live under `qa-evidence/final-audit/`; older files directly under `qa-evidence/` are historical and must not be treated as current passes.

## Source and build checks

```bash
npm ci
npm run typecheck
npm test
CI=1 npm run check:expo
CI=1 npx expo-doctor
npm audit
for script in scripts/*.cjs; do node "$script" || exit; done
npx expo export --platform android --output-dir /tmp/sitequote-android
npx expo export --platform ios --output-dir /tmp/sitequote-ios
```

Jest and the isolated CJS runners use mocks for native services. JavaScript/Hermes exports prove bundling, not native compilation or a launched application. Inspect failures rather than using forced dependency upgrades to suppress them.

## Local Supabase

Use the dedicated `sitequote` Docker stack after all migrations are present, as described in [setup](setup.md). The runners target `supabase_db_sitequote`; do not repoint them at hosted data.

```bash
umask 077
npx --yes supabase@2.122.0 status -o json > /tmp/sitequote-qa-local-status.json
python3 scripts/qa-sql-local.py
node scripts/qa-live-local.mjs
```

The status file contains local credentials: keep it outside the repository and delete it after testing. The live runner accepts `SITEQUOTE_QA_STATUS` for another private status-file path. Both runners accept `SITEQUOTE_QA_OUTPUT_DIR` for raw evidence and `SITEQUOTE_QA_DB_CONTAINER` for a separate disposable local stack; the container and status file must identify the same stack.

SQL fixtures wrap test data and role changes in rollback transactions. The API runner creates unique local accounts, verifies OTP through Mailpit, and uses real JWTs for CRUD, isolation, Storage, quote locks/history, reminder transitions, recovery and Dashboard counts. Its disposable local records persist for inspection; it never resets the database. Clock-controlled and mocked-native portions are labeled in its results.

Hosted tests require a separate disposable staging project and real verified inboxes. `smoke:otp`, `check-rls-two-accounts.mjs` and `check-storage-two-accounts.mjs` use hidden interactive prompts; the Storage runner additionally requires `SITEQUOTE_RUN_STORAGE_TEST=YES`. These scripts create persistent test records and must not use customer accounts.

## Native acceptance

Run this sequence on Android and iOS development builds connected to the intended staging backend. Record device/OS/build/timezone, account aliases and observed failures without credentials.

1. Sign up, verify an actual email, reject incorrect/expired codes, resend within provider limits, log in, restart, restore and sign out. Test offline restoration, revoked sessions, explicit credential clearing and switching between two accounts.
2. Create a lead with Kitchen Renovation and Bathroom Upgrade. Add repeated-category tasks, separate notes and photos; verify every association and list filter after relaunch.
3. Test gallery/camera permission denial, cancellation, JPEG/HEIC orientation and resizing, private full-size viewing, interrupted uploads and deletion. Retry without duplicate metadata; another installation's pending upload must survive repair.
4. Use $3,000 tasks, $150 additional charges and 8% tax. Compare the $3,402 editor, preview and PDF. Verify Unicode, long notes/multiple pages, stale preview rejection and cached-file loss.
5. Prepare/share/cancel without marking Sent. Confirm delivery explicitly, exercise concurrent/retried sends, revise A→B→A, and reuse matching older Sent versions. Accept an older Sent quote, check closed-project locks, reopen and confirm unchanged history and sibling projects.
6. Create, edit, complete, reopen and delete reminders. Verify completion history, site-visit stage advancement, manual corrections, lost-response recovery, stale edits and optional follow-up cancellation/save.
7. Test alerts in foreground/background/terminated states, permission changes, rescheduling, completion/deletion cancellation, cold taps and account switching. Travel/timezone and DST changes must preserve UTC due instants. Offline second-device alerts may be stale; taps must reauthorize.
8. Confirm Dashboard counts and each filtered destination after changes, including unavailable-query states. Check keyboard/safe areas, large text, screen readers and touch targets.

For database concurrency, use independent sessions and disposable projects: hold a project, task, charge, customer or business-profile write while preparing against an old fingerprint; after commit, stale preparation must reject. Repeat parallel preparation with distinct request keys, conflicting cross-project keys, concurrent send/decision and site-visit completion. One observed lock scenario does not establish the whole matrix.
