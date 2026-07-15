import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildStoryboard } from './resolve-issue.ts';

const scene = {
  name: 'Show the fix',
  waitFor: '.feature-ready',
  do: [{ action: 'pause' as const, seconds: 1 }],
};

describe('buildStoryboard', () => {
  it('waits for authenticated navigation without relying on the removed tabs nav', () => {
    const storyboard = buildStoryboard({
      applicable: true,
      reason: 'visible UI fix',
      path: '/',
      scenes: [scene],
    });

    assert.deepEqual(storyboard.scenes[0], {
      name: 'Sign in',
      do: [
        { pause: 0.6 },
        { fill: { into: 'input[autocomplete="username"]', text: 'demo' } },
        { fill: { into: 'input[type="password"]', text: 'demo-password' } },
        { pause: 0.4 },
        { click: '.btn-login' },
        { wait_for_url: '**/' },
        { wait_for: '.shell' },
        { pause: 0.6 },
      ],
    });
    assert.deepEqual(storyboard.viewport, { width: 390, height: 844 });
    assert.equal(JSON.stringify(storyboard).includes('nav.tabs'), false);
  });

  it('uses URL readiness for full-screen routes and preserves scene-specific waits', () => {
    const storyboard = buildStoryboard({
      applicable: true,
      reason: 'visible UI fix',
      path: '/expenses/new',
      scenes: [scene],
    });

    assert.deepEqual(storyboard.scenes[1], {
      name: 'Open /expenses/new',
      open: 'http://127.0.0.1:8080/expenses/new',
      do: [{ wait_for_url: '**/expenses/new' }, { pause: 0.6 }],
    });
    assert.deepEqual(storyboard.scenes[2], {
      name: 'Show the fix',
      wait_for: '.feature-ready',
      do: [{ pause: 1 }],
    });
    assert.equal(JSON.stringify(storyboard).includes('nav.tabs'), false);
  });
});
