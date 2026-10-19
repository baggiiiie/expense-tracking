import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The recovered production bundle exports only its fetch handler. Expose the
// feedback function in memory for testing, without adding production exports.
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const { submitFeedback } = await import(`data:text/javascript;base64,${Buffer.from(
  source + '\nexport { submitFeedback };\n'
).toString('base64')}`);

function mockGitHub(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers['user-agent'], 'expense-tracking-worker');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    const response = responses.shift();
    assert.ok(response, 'unexpected GitHub request');
    return Response.json(response.body, { status: response.status });
  });
  return calls;
}

test('text feedback creates an issue with the required GitHub User-Agent', async (t) => {
  const calls = mockGitHub(t, [{ status: 201, body: {} }]);
  await submitFeedback('test-token', { route: '/', body: 'Test feedback' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/baggiiiie/expense-tracking/issues');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.title, 'Feedback from /');
  assert.deepEqual(payload.labels, ['feedback']);
  assert.match(payload.body, /Test feedback/);
});

test('image uploads and issue creation both send User-Agent', async (t) => {
  const calls = mockGitHub(t, [
    { status: 201, body: { content: { download_url: 'https://example.com/image.png' } } },
    { status: 201, body: {} }
  ]);
  await submitFeedback('test-token', {
    route: '/expenses', body: 'Screenshot',
    images: [{ data: 'aW1hZ2U=', contentType: 'image/png' }]
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'PUT');
  assert.match(calls[0].url, /\/contents\/\.feedback\/images\/.*\.png$/);
  assert.match(JSON.parse(calls[1].options.body).body, /https:\/\/example.com\/image.png/);
});

test('failed upload stops before creating an issue', async (t) => {
  const calls = mockGitHub(t, [{ status: 422, body: { message: 'content is not valid Base64' } }]);
  await assert.rejects(submitFeedback('test-token', {
    route: '/', body: 'Invalid attachment', images: [{ data: '!', contentType: 'image/png' }]
  }), /failed to upload image 1: GitHub API returned 422/);
  assert.equal(calls.length, 1);
});
