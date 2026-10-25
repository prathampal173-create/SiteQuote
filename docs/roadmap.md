# Roadmap

**Phases 0–5D: coding implemented.** This status describes repository code, configuration and test tooling. It does not certify hosted deployment, completed acceptance testing or production readiness. Phase 0B1's hosted SMTP/configuration verification and Phase 5B–5D's native execution remain release work.

| Phase | Implemented scope | Coding status |
| --- | --- | --- |
| 0A | Expo Router foundation, TypeScript, shared UI and configuration | Coding implemented |
| 0B1 | Public backend configuration and signup OTP template | Coding implemented |
| 0B2 | Foundation tables and constraints | Coding implemented |
| 0B3 | Owner RLS and restricted client grants | Coding implemented |
| 0B4 | Private photo bucket and Storage policies | Coding implemented |
| 0C | Signup and email OTP verification | Coding implemented |
| 0D | Login, secure sessions, sign-out and account switching | Coding implemented |
| 0E | Business profile Settings | Coding implemented |
| 1A | Leads, search, filters, contact stages and manual history | Coding implemented |
| 1B | Independent projects, editing and project lists | Coding implemented |
| 1C | Categorized tasks with exact-cent pricing | Coding implemented |
| 1D | Project decisions and reopening | Coding implemented |
| 2A | Camera/gallery selection and JPEG processing | Coding implemented |
| 2B | Private project/task photo persistence and galleries | Coding implemented |
| 2C | Upload retry, guarded deletion and conservative repair | Coding implemented |
| 3A | Additional charges, tax and estimate arithmetic | Coding implemented |
| 3B | Saved estimate preview, fingerprint and PDF generation | Coding implemented |
| 3C | Immutable Prepared versions and sharing | Coding implemented |
| 3D | Explicit Sent confirmation | Coding implemented |
| 3E | Selected-version approval and accepted quote summaries | Coding implemented |
| 4A | Reminder CRUD and local date/time entry | Coding implemented |
| 4B | Completion/reopen history and grouped lists | Coding implemented |
| 4C | Local notification permissions, scheduling and taps | Coding implemented |
| 4D | Atomic site-visit contact-stage advancement | Coding implemented |
| 4E | Durable notification reconciliation | Coding implemented |
| 4F | Optional Sent-quote follow-up and retry identity | Coding implemented |
| 5A | Exact Dashboard counts and filtered navigation | Coding implemented |
| 5B | Integration fixes and workflow test tooling | Coding implemented |
| 5C | Error recovery fixes and fault-injection tests | Coding implemented |
| 5D | Historical quote matching and advanced test tooling | Coding implemented |

## Verification gates

[FINAL_AUDIT.md](../FINAL_AUDIT.md) records executed results, failures and unavailable checks. [Testing](testing.md) defines repeatable procedures. Local unit/API/SQL passes do not establish native camera, PDF, notification, multi-device or hosted-environment acceptance.

Release requires resolving dependency/runtime findings, verifying the deployed backend, and completing Android/iOS and two-device acceptance. Safe automatic reclamation of untracked uploads requires shared server coordination before that behavior can be restored.
