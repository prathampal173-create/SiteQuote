# Final audit — 2026-10-24

## Work completed

- Reviewed application code, migrations, tests, configuration and documentation. Removed 67 obsolete Markdown files and obsolete report/ZIP tooling; consolidated maintenance documentation and marked Phases 0–5D **coding implemented**, separately from release verification.
- Fixed photo repair deleting another installation's pending upload, added explicit credential clearing after failed session restoration, and repaired three Node QA scripts. Added regression tests, corrected test synchronization, pinned Supabase JS and corrected the Node requirement.
- Extended local API coverage and replayed migrations in a separate disposable Docker stack. Preserved `.env` and all 19 historical migrations byte-for-byte; performed no hosted writes or database resets. Disposable local accounts/records remain; the audit-created stack was stopped with its volumes retained.
- Saved raw execution evidence in [qa-evidence/final-audit](qa-evidence/final-audit/). This directory has no Git metadata, so changes could not be checked against a commit.

## Test results

| Check | Observed result |
| --- | --- |
| Dependency installation, TypeScript, Expo dependency alignment | **Passed** |
| Jest | **Passed:** 70 suites, 460 tests; final run without console warnings/errors |
| Isolated runners | **Passed:** 16 runners covering 278 behavioral checks and syntax checks of 179 TS/TSX files |
| Fresh database installation | **Passed:** all 19 migrations replayed |
| SQL/security fixtures | **Passed:** all 18 fixtures on both existing and fresh local stacks |
| Live local API workflows | **Passed:** all 38 cases on each stack; verified OTP/login, CRUD, two-account isolation, private Storage restrictions, photos, exact $3,402 pricing, immutable quote history, project decisions, reminders, retry recovery, idempotency, observed row-lock concurrency and Dashboard counts above 1,000 rows |
| Local security catalog | **Passed:** RLS enabled on all 11 application tables; six privileged public RPCs deny anonymous execution and use empty search paths |
| Android/iOS exports | **Passed:** JavaScript/Hermes bundling only |
| Expo Doctor | **Failed:** 21/22 checks passed; runtime finding below |
| npm audit | **Failed:** nine affected-package findings, six high and three moderate |
| Hosted read-only checks | **Partial:** email confirmation enabled; anonymous reads denied on three foundation tables; eight other resources returned `PGRST205`; anonymous bucket listing was empty |
| Hosted authenticated CRUD/RLS/Storage, external OTP delivery and administrative inspection | **Blocked:** no verified disposable accounts, test inboxes or administrative credentials |
| Android/iOS native execution | **Blocked:** no Android SDK/Java runtime or full Xcode/simulator tooling |
| Camera/HEIC, rendered PDFs/sharing, actual notification delivery, physical two-device behavior and accessibility | **Unexecuted:** native services were mocked in automated coverage |
| Wider concurrency/stress matrix | **Unexecuted:** only the documented local scenarios ran |

## Findings

- Photo data loss was reproduced against real Storage before the fix. Current repair retains untracked objects; existing server policy still lets owners delete them directly, leaving older clients unsafe and abandoned-file reclamation unresolved.
- Hosted feature availability remains unverified: `PGRST205` requires administrative inspection of migrations, exposed schemas and cache state; public-key probes do not establish the cause.
- Expo Doctor flags the installed SDK 56/Hermes memory regression. Dependency advisories involve `node-forge`, `zod` and `decode-uri-component`, including propagated package findings. Available automated fixes propose major changes, including an Expo downgrade; none were forced. Device memory behavior and exploitability were not measured.

## Next steps

1. Inspect hosted deployment administratively, resolve unavailable resources, and repeat authenticated security/workflow checks with disposable staging accounts and real inboxes.
2. Upgrade to a supported Expo/React Native combination containing the Hermes fix, resolve dependency advisories, and rerun checks with native builds.
3. Complete the Android/iOS, two-device and concurrency procedures in [docs/testing.md](docs/testing.md) before release approval.
4. Add server-coordinated upload reservations before restoring automatic untracked-object deletion; assess compatibility with older clients.
