# Setup

## Install and run

Use Node 22 (at least 22.13), Node 24 (at least 24.3), or Node 25+. The audit used Node 26.7.0. Docker and Python 3 are needed for local backend tests; native builds additionally need Android Studio/SDK or full Xcode and an iOS runtime.

```bash
npm ci
test -f .env || cp .env.example .env
npm start
```

Set `EXPO_PUBLIC_SUPABASE_URL` to the project's HTTPS origin and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to its `sb_publishable_` key. Restart Metro after changing these values.

`npm run android` and `npm run ios` start Metro and request the corresponding installed runtime; they do not build a native binary. Before a development build, configure the app's Android package/iOS bundle identifier and required signing. Follow the [Expo development-build guide](https://docs.expo.dev/develop/development-builds/introduction/).

## Supabase authentication

Enable email/password signup and email confirmation. Configure six-digit signup OTPs and use [supabase-confirm-signup.html](supabase-confirm-signup.html), which renders `{{ .Token }}`. Configure SMTP for delivery to real test inboxes; review provider expiration and rate limits without disabling confirmation.

Verify hosted delivery interactively with `npm run smoke:otp`. Its terminal prompts hide credentials and the code. A successful signup request alone does not verify delivery. See [email templates](https://supabase.com/docs/guides/auth/auth-email-templates) and [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).

## Database installation

Apply all files in `supabase/migrations/` in filename order. The repository contains 19 historical migrations; never edit or replay an applied migration. Add forward-only migrations for schema changes, review ownership/grants, and update `src/lib/database.types.ts` when the contract changes.

For a dedicated local installation, Supabase CLI 2.122.0 was used in this audit:

```bash
npx --yes supabase@2.122.0 start
npx --yes supabase@2.122.0 migration up --local
```

These commands target the `sitequote` project configured in `supabase/config.toml`. Inspect existing containers and migration history first; do not reset an existing database. The local configuration captures signup messages in Mailpit and uses the same OTP template.

For a hosted deployment, inspect its actual migration history, take the appropriate backup, and review pending migrations before applying them through an authenticated administrative connection. The app's public key cannot apply migrations. A PostgREST `PGRST205` response requires checking table deployment, exposed schemas and schema-cache state; it does not identify the cause by itself.

The mobile environment validator deliberately accepts HTTPS only. Local Node API tests use the loopback URL from Supabase CLI status independently of `.env`; emulator/mobile testing needs a reachable configured backend.
