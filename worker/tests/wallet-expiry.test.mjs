import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../src/index.js';

const now = 1800000000;
const day = 86400;

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const migrations = new URL('../../server/db/migrations/', import.meta.url);
  for (const file of readdirSync(migrations).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), 'utf8').split('-- +goose Down')[0]);
  }
  sqlite.exec(`CREATE TABLE app_preferences (
    id INTEGER PRIMARY KEY, currency TEXT, timezone TEXT, date_format TEXT
  ); INSERT INTO app_preferences VALUES (1, 'SGD', 'Asia/Singapore', '2006-01-02');`);
  sqlite.exec(readFileSync(new URL('../migrations/0001_wallet_suggestion_expiry.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const bound = (args) => ({
        bind: (...values) => bound(values),
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ success: true, results: stmt.all(...args) }),
        run: async () => ({ success: true, meta: stmt.run(...args) })
      });
      return bound([]);
    }
  };
  t.mock.method(Date, 'now', () => now * 1000);
  async function request(path, method = 'GET', body) {
    return worker.fetch(new Request('https://expense.test/api' + path, {
      method,
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), { DB: db, EXPENSE_SYNC_SECRET: 'test-secret' });
  }
  function seed(id, capturedAt, status = 'pending') {
    sqlite.prepare(`INSERT INTO wallet_suggestions
      (id, captured_at, status, created_at, updated_at, client_updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, capturedAt, status, now, now, now);
  }
  return { sqlite, db, request, seed };
}

test('default expiry uses capture time, includes the boundary, preserves terminal states and syncs dismissals', async (t) => {
  const { request, seed, sqlite } = database(t);
  assert.equal((await (await request('/preferences')).json()).wallet_suggestion_expiry_days, 7);
  seed('old', now - 9 * day);
  seed('boundary', now - 7 * day);
  seed('fresh', now - 7 * day + 1);
  seed('accepted', now - 30 * day, 'accepted');
  seed('dismissed', now - 30 * day, 'dismissed');
  const since = sqlite.prepare('SELECT current_version FROM sync_state').get().current_version;
  const response = await request('/sync/pull?since=' + since);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.wallet_suggestions.map(row => [row.id, row.status]).sort(), [
    ['boundary', 'dismissed'], ['old', 'dismissed']
  ]);
  assert.ok(result.server_version > since);
  assert.ok(result.wallet_suggestions.every(row => row.server_version > since && row.updated_at === now));
  const pending = await (await request('/wallet-suggestions')).json();
  assert.deepEqual(pending.wallet_suggestions.map(row => row.id), ['fresh']);
  assert.equal(sqlite.prepare("SELECT status FROM wallet_suggestions WHERE id = 'accepted'").get().status, 'accepted');
  assert.equal(sqlite.prepare("SELECT server_version FROM wallet_suggestions WHERE id = 'dismissed'").get().server_version <= since, true);
  const again = await (await request('/sync/pull?since=' + result.server_version)).json();
  assert.deepEqual(again.wallet_suggestions, []);
});

test('settings persist custom expiry, preserve it on partial updates, and reject invalid days', async (t) => {
  const { request, seed } = database(t);
  seed('eight-days', now - 8 * day);
  let response = await request('/preferences', 'PUT', { wallet_suggestion_expiry_days: 10 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).wallet_suggestion_expiry_days, 10);
  assert.equal((await (await request('/wallet-suggestions')).json()).count, 1);
  response = await request('/preferences', 'PUT', { currency: 'USD' });
  assert.equal((await response.json()).wallet_suggestion_expiry_days, 10);
  for (const value of [0, -1, 1.5, '3', null]) {
    response = await request('/preferences', 'PUT', { wallet_suggestion_expiry_days: value });
    assert.equal(response.status, 400);
  }
  assert.equal((await (await request('/preferences')).json()).wallet_suggestion_expiry_days, 10);
  await request('/preferences', 'PUT', { wallet_suggestion_expiry_days: 3 });
  assert.equal((await (await request('/wallet-suggestions')).json()).count, 0);
});

test('hourly expiry runs without a user request and expired suggestions cannot be confirmed', async (t) => {
  const { request, seed, db, sqlite } = database(t);
  seed('old', now - 8 * day);
  seed('fresh', now - day);
  await worker.scheduled({}, { DB: db });
  assert.equal(sqlite.prepare("SELECT status FROM wallet_suggestions WHERE id = 'old'").get().status, 'dismissed');
  assert.equal(sqlite.prepare("SELECT status FROM wallet_suggestions WHERE id = 'fresh'").get().status, 'pending');
  seed('expired-before-cron', now - 8 * day);
  const response = await request('/wallet-suggestions/expired-before-cron/confirm', 'POST', {});
  assert.equal(response.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM expenses').get().count, 0);
  const captured = await request('/wallet-suggestions', 'POST', { id: 'late-capture', captured_at: now - 9 * day });
  assert.equal(captured.status, 201);
  assert.equal((await captured.json()).status, 'dismissed');
});
