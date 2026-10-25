import { spawnSync } from 'node:child_process';
import path from 'node:path';

test.each(['smoke-email-otp.mjs', 'check-rls-two-accounts.mjs', 'check-storage-two-accounts.mjs'])(
  '%s loads in Node and refuses production before any test writes', (script) => {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', script)], {
      env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 10000
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Development (use|test) only/);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|SyntaxError/);
  }
);
