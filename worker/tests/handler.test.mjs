import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

const env = { EXPENSE_SYNC_SECRET: 'test-secret', BUILD_SHA: 'test-build' };
const origin = 'https://expense.yingchao.dev';

test('health identifies the deployed release at both public paths', async () => {
  for (const path of ['/api/health', '/expense/api/health']) {
    const response = await worker.fetch(new Request(origin + path), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', build: 'test-build' });
  }
});

test('feedback cannot call GitHub without authentication', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected upstream request'));
  const response = await worker.fetch(new Request(origin + '/api/feedback', {
    method: 'POST', body: JSON.stringify({ route: '/', body: 'Feedback' })
  }), { ...env, GITHUB_TOKEN: 'test-token' });
  assert.equal(response.status, 401);
});

test('authenticated feedback creates an issue through the production handler', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ number: 123 }, { status: 201 });
  });
  const response = await worker.fetch(new Request(origin + '/api/feedback', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/expenses', body: 'Something is broken' })
  }), { ...env, GITHUB_TOKEN: 'test-token' });
  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/issues$/);
  assert.equal(calls[0].options.headers['user-agent'], 'expense-tracking-worker');
  assert.match(JSON.parse(calls[0].options.body).body, /Something is broken/);
});

test('web assets use the ASSETS binding and strip the legacy prefix', async () => {
  for (const path of ['/_app/test.js', '/expense/_app/test.js']) {
    const response = await worker.fetch(new Request(origin + path), {
      ...env,
      ASSETS: { fetch: async request => {
        assert.equal(new URL(request.url).pathname, '/_app/test.js');
        return new Response('asset');
      } }
    });
    assert.equal(await response.text(), 'asset');
  }
});
