/* Runs Phase 4E lifecycle Jest-style test cases against actual transpiled TS modules with
 * fake OS/registry ports. No installed Jest, SQLite native module, Expo device or Supabase. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const previous = Module._extensions['.ts'];
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, file);
const tests = [];
global.test = (title, fn) => tests.push({ title, fn });
function match(actual, negate = false) {
  return {
    toBe(value) { if (negate) assert.notStrictEqual(actual, value); else assert.strictEqual(actual, value); },
    toEqual(value) { if (negate) assert.notDeepStrictEqual(actual, value); else assert.deepStrictEqual(actual, value); },
    toHaveLength(n) { if (negate) assert.notStrictEqual(actual.length, n); else assert.strictEqual(actual.length, n); },
    toBeGreaterThan(n) { if (negate) assert.ok(!(actual > n)); else assert.ok(actual > n); },
    toContain(value) { if (negate) assert.ok(!actual.includes(value)); else assert.ok(actual.includes(value)); },
    toBeDefined() { if (negate) assert.strictEqual(actual, undefined); else assert.notStrictEqual(actual, undefined); }
  };
}
global.expect = (value) => Object.assign(match(value), { not: match(value, true) });
(async () => {
  try {
    require(path.resolve(__dirname, '../src/features/notifications/__tests__/notificationLifecycle.test.ts'));
    let n = 0;
    for (const { title, fn } of tests) { await fn(); console.log('PASS', title); n++; }
    // SQLite registry adapter: injected in-memory store to execute real serialization/parsing.
    const actualLoad = Module._load;
    const kv = new Map();
    Module._load = function(id, parent, main) {
      if (id === 'expo-sqlite/kv-store') return { __esModule: true, default: {
        getItem: async (key) => kv.get(key) ?? null,
        setItem: async (key, value) => { kv.set(key, value); }
      } };
      return actualLoad.call(this, id, parent, main);
    };
    try {
      const {notificationRegistry} = require('../src/features/notifications/notificationRegistry.ts');
      const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const entry = {ownerId:account,reminderId:'11111111-1111-4111-8111-111111111111',nativeId:'os-1',dueMs:1999999999999};
      await notificationRegistry.write([entry]);
      assert.deepEqual(await notificationRegistry.read(), [entry]);
      console.log('PASS durable registry write/read of opaque owner namespace'); n++;
      await notificationRegistry.write([{...entry,ownerId:'bad'}]);
      assert.deepEqual(await notificationRegistry.read(), []);
      console.log('PASS registry validation rejects malformed owner scope'); n++;
      kv.set('sitequote:local-reminder-notifications:v1', '{}');
      await assert.rejects(notificationRegistry.read(), /damaged/);
      console.log('PASS corrupted journal fails safely'); n++;
    } finally { Module._load = actualLoad; }
    console.log(`RESULT ${n}/${tests.length + 3} executable isolated mocked lifecycle/registry tests; native OS not executed`);
  } catch (error) { console.error('FAIL', error); process.exitCode = 1; }
  finally { Module._extensions['.ts'] = previous; delete global.test; delete global.expect; }
})();
