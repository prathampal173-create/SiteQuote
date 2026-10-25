# Architecture

## Modules

`app/` contains Expo Router routes and protected navigation. `src/features/` groups screens, models and API adapters by business feature; shared UI lives in `src/components/`, configuration in `src/config/`, and the Supabase client, secure session adapter, database types and image processing in `src/lib/`.

The stack is Expo SDK 56, React 19, React Native 0.85, strict TypeScript, Supabase JS, Postgres/Auth/Storage, and Jest with React Native Testing Library. `package-lock.json` defines the installed dependency graph.

## Persistence

| Table | Responsibility |
| --- | --- |
| `business_profiles` | One saved business identity per account |
| `leads` | Customer contacts and contact stage |
| `projects` | Lead association, working tax, project status and active accepted quote |
| `project_tasks` | Ordered task fields and cents |
| `project_additional_charges` | Ordered descriptions and cents |
| `project_photos` | Project/task association, private object path and deletion state |
| `quotes` | Numbered frozen content, totals and Prepared/Sent metadata |
| `quote_prepare_requests` | Private request-key deduplication ledger |
| `reminders` | UTC due instant, saved status and creation retry key |
| `reminder_completion_events` | Completion/reopen events for retained reminders |
| `activities` | Append-only manual notes, quote-send, decision and automatic stage history |

UUID relationships include owner identifiers; composite foreign keys prevent cross-owner and mismatched project/task/lead links. Financial columns use `bigint`, bounded to JavaScript's safe integer range; client calculations use `BigInt` before safe conversion.

## Requests and transactions

Auth restoration refreshes credentials and validates identity with the Auth server before opening protected routes. API adapters add explicit owner filters and reject obsolete account responses; screens also fence asynchronous results by account scope. See [security](security.md) for access controls and credential handling.

Lists paginate in stable 200-row batches. The Dashboard uses four independent exact-count HEAD queries; these counts are not one transactional snapshot. The editable estimate also uses multiple reads, while the unsent snapshot RPC reads permitted quote fields under one statement snapshot.

`prepare_quote` locks the project and shared customer/business rows, compares the canonical SHA-256 fingerprint, calculates exact totals and assigns/reuses a version in one transaction. Task/charge writes acquire the same parent lock. The fingerprint excludes project status and internal notes; quote reuse rules are defined in [product rules](product-spec.md).

Send and decision RPCs check ownership and state under locks and append history. `confirm_quote_sent_for_followup` additionally reports whether a new transition occurred. Reminder status triggers set completion time, append completion/reopen history and apply eligible site-visit stage changes atomically. Creation retry UUIDs and optimistic `updated_at` filters protect reminder retries and conflicting edits.

## Native services

Photos use Expo Image Picker/Image Manipulator. Processed files are copied into app documents and recorded in an account/project/task SQLite journal before upload. One UUID survives retries; Storage upload precedes metadata insertion. Deletion proceeds through metadata `deleting` → Storage removal → metadata removal. Untracked objects are retained because local journals cannot prove remote abandonment.

Quote HTML escapes user strings and uses only snapshot fields. Expo Print renders private cached PDFs, and Expo Sharing opens the OS sheet. Viewing or sharing has no database side effects.

Notification reconciliation serializes work across authenticated reminder reads, pending OS requests and a SQLite registry of opaque IDs/due instants. It runs after saved changes, login and foreground entry, and removes obsolete schedules after sign-out. Failed authoritative reads preserve existing schedules; uncertain cancellation prevents duplicate replacements. Notification taps re-fetch the current owned reminder before navigation.

Dates use JavaScript `Date` and `Intl` with the device timezone; there is no `expo-localization` dependency. Persisted due times are UTC instants. Follow-up suggestions use local calendar days, disclose DST adjustments and choose the first occurrence of an ambiguous time.
