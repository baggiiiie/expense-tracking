import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProdGithub, extractImageUrls } from '../src/mastra/integrations/github.ts';
import { checkoutEnv } from '../src/mastra/runtime.ts';
import { hasSingleFixCommit, prepareCheckout } from '../src/mastra/workflows/resolve-issue.ts';
import { isFixable } from '../src/mastra/workflows/schemas.ts';

describe('checkout environment', () => {
  it('withholds credentials from the checkout the coding agent can read', () => {
    const env = checkoutEnv({
      PATH: '/usr/bin',
      GH_TOKEN: 'ghp_secret',
      ANTHROPIC_API_KEY: 'sk-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GOCACHE: '/cache/go',
    });

    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.GOCACHE, '/cache/go');
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  });

  it('never lets a command block on a credential prompt', () => {
    assert.equal(checkoutEnv({}).GIT_TERMINAL_PROMPT, '0');
  });
});

describe('checkout preflight', () => {
  it('refuses a dirty checkout without changing it', async () => {
    const shell = async () => ({
      exitCode: 0,
      stdout: ' M existing.txt\n?? untracked.txt\n',
      stderr: '',
    });

    await assert.rejects(
      prepareCheckout(shell),
      /requires a clean disposable checkout[\s\S]*existing\.txt[\s\S]*untracked\.txt/,
    );
  });

  it('only accepts one commit descended from the original HEAD', async () => {
    const history = (exitCode: number, count: string) => async () => ({
      exitCode,
      stdout: count,
      stderr: '',
    });

    assert.equal(await hasSingleFixCommit(history(0, '1\n'), 'abc123'), true);
    assert.equal(await hasSingleFixCommit(history(0, '2\n'), 'abc123'), false);
    assert.equal(await hasSingleFixCommit(history(1, ''), 'abc123'), false);
  });
});

describe('fixability', () => {
  it('only attempts code for valid, actionable categories', () => {
    assert.equal(isFixable({ valid: true, category: 'bug', reason: '' }), true);
    assert.equal(isFixable({ valid: true, category: 'feature', reason: '' }), true);
    assert.equal(isFixable({ valid: true, category: 'unclear', reason: '' }), false);
    assert.equal(isFixable({ valid: false, category: 'bug', reason: '' }), false);
  });
});

describe('issue image extraction', () => {
  const allowed = 'https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/.feedback/';

  it('finds markdown and html images at the allowlisted prefix', () => {
    const urls = extractImageUrls(
      `![shot](${allowed}a.png)\n<img src="${allowed}b.jpg" alt="x">`,
    );
    assert.deepEqual(urls, [`${allowed}a.png`, `${allowed}b.jpg`]);
  });

  it('rejects URLs outside the allowlist, so issue text cannot pick the host', () => {
    const urls = extractImageUrls(
      '![a](https://evil.example/x.png)\n' +
        '![b](http://169.254.169.254/latest/meta-data)\n' +
        // A lookalike host that merely starts with the right characters.
        `![c](https://raw.githubusercontent.com.evil.example/baggiiiie/expense-tracking/master/.feedback/x.png)\n` +
        // Right host, wrong path: outside the .feedback/ directory.
        '![d](https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/secrets/x.png)',
    );
    assert.deepEqual(urls, []);
  });

  it('deduplicates and caps the number of images', () => {
    const many = Array.from({ length: 9 }, (_, i) => `![s](${allowed}${i}.png)`).join('\n');
    assert.equal(extractImageUrls(`${many}\n![dup](${allowed}0.png)`).length, 6);
  });

  it('finds nothing in a body with no images', () => {
    assert.deepEqual(extractImageUrls('the keypad jumps when tapped'), []);
  });
});

describe('production GitHub adapter', () => {
  const failing = (stderr: string) => async () => ({ exitCode: 1, stdout: '', stderr });

  it('does not guess a default branch when gh fails', async () => {
    const github = createProdGithub({ cwd: process.cwd(), shell: failing('API unavailable') });
    await assert.rejects(github.getDefaultBranch(), /default-branch lookup failed: API unavailable/);
  });

  it('does not accept an empty default branch', async () => {
    const github = createProdGithub({
      cwd: process.cwd(),
      shell: async () => ({ exitCode: 0, stdout: '\n', stderr: '' }),
    });
    await assert.rejects(github.getDefaultBranch(), /empty branch/);
  });

  it('propagates comment, close, and push failures', async () => {
    const github = createProdGithub({ cwd: process.cwd(), shell: failing('permission denied') });
    await assert.rejects(github.comment(42, 'body'), /issue comment failed: permission denied/);
    await assert.rejects(github.close(42, 'completed'), /issue close failed: permission denied/);
    await assert.rejects(github.push('main'), /git push failed: permission denied/);
  });

  it('surfaces allowlisted image URLs from the issue body', async () => {
    const url = 'https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/.feedback/a.png';
    const github = createProdGithub({
      cwd: process.cwd(),
      shell: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ title: 'keypad', body: `broken: ![s](${url})`, state: 'OPEN' }),
        stderr: '',
      }),
    });

    const issue = await github.getIssue(42);
    assert.deepEqual(issue.imageUrls, [url]);
    assert.match(issue.content, /Title: keypad/);
  });

  it('refuses to request a non-allowlisted URL even if asked directly', async () => {
    const github = createProdGithub({ cwd: process.cwd(), shell: failing('unused') });
    // No fetch is stubbed, so a request would throw or hang; an empty result
    // proves the allowlist rejected the URL before any network call.
    assert.deepEqual(await github.fetchImages(['https://evil.example/x.png']), []);
  });
});

describe('image downloads', () => {
  const allowed = 'https://raw.githubusercontent.com/baggiiiie/expense-tracking/master/.feedback/';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  /** Serve one canned response for any allowlisted URL. */
  async function withStubbedFetch<T>(
    respond: (url: string) => Response,
    run: (github: ReturnType<typeof createProdGithub>) => Promise<T>,
  ): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) =>
      respond(String(input))) as typeof globalThis.fetch;
    try {
      return await run(createProdGithub({ cwd: process.cwd(), shell: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }));
    } finally {
      globalThis.fetch = original;
    }
  }

  it('base64-encodes an allowlisted image with its media type', async () => {
    const images = await withStubbedFetch(
      () => new Response(png, { headers: { 'content-type': 'image/png' } }),
      (github) => github.fetchImages([`${allowed}a.png`]),
    );
    assert.deepEqual(images, [{ image: png.toString('base64'), mediaType: 'image/png' }]);
  });

  it('skips non-image content types', async () => {
    const images = await withStubbedFetch(
      () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      (github) => github.fetchImages([`${allowed}a.png`]),
    );
    assert.deepEqual(images, []);
  });

  it('skips a body that exceeds the size cap even when content-length lies', async () => {
    const huge = Buffer.alloc(5_000_001);
    const images = await withStubbedFetch(
      () =>
        new Response(huge, {
          // Understate the length so only the streaming cap can catch it.
          headers: { 'content-type': 'image/png', 'content-length': '10' },
        }),
      (github) => github.fetchImages([`${allowed}big.png`]),
    );
    assert.deepEqual(images, []);
  });

  it('skips a failed response without failing the batch', async () => {
    const images = await withStubbedFetch(
      (url) =>
        url.endsWith('missing.png')
          ? new Response('nope', { status: 404 })
          : new Response(png, { headers: { 'content-type': 'image/png' } }),
      (github) => github.fetchImages([`${allowed}missing.png`, `${allowed}ok.png`]),
    );
    assert.equal(images.length, 1);
    assert.equal(images[0].mediaType, 'image/png');
  });
});
