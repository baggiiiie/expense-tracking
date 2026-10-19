import assert from 'node:assert/strict';

const sha = process.argv[process.argv.indexOf('--sha') + 1];
if (!process.argv.includes('--sha') || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
  throw new Error('Usage: node scripts/smoke-worker.mjs --sha <40-character commit>');
}
const origin = process.env.SMOKE_ORIGIN ?? 'https://expense.yingchao.dev';
const headers = { 'User-Agent': 'expense-tracking-deploy-smoke', 'Cache-Control': 'no-cache' };
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const health = await fetch(`${origin}/api/health?release=${sha}`, { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', build: sha });
    const page = await fetch(`${origin}/`, { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(page.status, 200);
    const html = await page.text();
    const asset = html.match(/(?:href|src)="([^"\s]*\/_app\/[^"\s]+\.js)"/);
    assert.ok(asset, 'Svelte app must reference a JavaScript asset');
    const js = await fetch(new URL(asset[1], origin), { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);
    const protectedAPI = await fetch(`${origin}/api/preferences`, { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(protectedAPI.status, 401, 'private APIs must still require authentication');
    console.log(`Worker (${origin}), assets, and authentication verified at ${sha}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Waiting for release (${attempt + 1}/12): ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
throw lastError;
