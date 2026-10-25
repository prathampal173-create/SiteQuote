/**
 * Manual development-only integration check. Node 20+ with a TTY required.
 * Run: node --env-file=.env scripts/smoke-email-otp.mjs (Node 20.12+).
 * Never prints password, OTP, session tokens, or SDK error objects.
 */
import { createClient } from '@supabase/supabase-js';

function safeFailure(message) {
  const error = new Error(message);
  error.name = 'SiteQuoteSmokeFailure';
  return error;
}

function hiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    return Promise.reject(safeFailure('A local interactive terminal is required.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(`${prompt} (input hidden): `);
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003' || ch === '\u0004') {
          cleanup();
          process.stdout.write('\n');
          reject(safeFailure('Cancelled.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    function cleanup() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

function publicConfiguration() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    throw safeFailure('Provide a public sb_publishable_ key in the local .env file.');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
        parsed.pathname !== '/' || parsed.search || parsed.hash) throw safeFailure('Invalid origin.');
  } catch {
    throw safeFailure('Provide a valid HTTPS Supabase project origin in the local .env file.');
  }
  return { url, key };
}

function failForAuth(error, stage) {
  if (!error) return;
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' ||
      error.code === 'over_request_rate_limit') {
    throw safeFailure(`${stage} rate-limited by Supabase. Stop and retry only after the provider permits it.`);
  }
  throw safeFailure(`${stage} failed. Check Supabase Auth settings and dashboard logs; no sensitive details were printed.`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw safeFailure('Development use only.');
  const { url, key } = publicConfiguration();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const email = (await hiddenInput('Test inbox email')).trim().toLowerCase();
  const password = await hiddenInput('New test account password');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    throw safeFailure('Provide a valid email address and a password of at least eight characters.');
  }

  process.stdout.write('Submitting sign-up request…\n');
  const signup = await client.auth.signUp({ email, password });
  failForAuth(signup.error, 'Sign-up');
  // API acceptance does NOT prove that an email was delivered.
  process.stdout.write('Request accepted. Check the real mailbox (including spam). Delivery is NOT verified yet.\n');
  let otp = await hiddenInput('Six-digit OTP, or RESEND to request one resend');
  if (otp.trim().toUpperCase() === 'RESEND') {
    const resend = await client.auth.resend({ type: 'signup', email });
    failForAuth(resend.error, 'Resend');
    process.stdout.write('Resend request accepted; check mailbox. Delivery is NOT verified yet.\n');
    otp = await hiddenInput('Six-digit OTP from the email');
  }
  if (!/^\d{6}$/.test(otp)) throw safeFailure('Expected a six-digit OTP from the received email.');
  const verification = await client.auth.verifyOtp({ email, token: otp, type: 'email' });
  failForAuth(verification.error, 'OTP verification');
  if (!verification.data.user?.email_confirmed_at || !verification.data.session) {
    throw safeFailure('Verification did not return both a confirmed user and a session.');
  }
  process.stdout.write('PASS: real emailed OTP was entered and Supabase confirmed the email; no secrets were printed or persisted.\n');
}

main().catch((error) => {
  // Print only messages authored above, never SDK error objects or API responses.
  const message = error instanceof Error && error.name === 'SiteQuoteSmokeFailure'
    ? error.message
    : 'Unexpected integration failure. Check private provider logs; no error details were printed.';
  process.stderr.write(`NOT VERIFIED: ${message}\n`);
  process.exitCode = 1;
});
