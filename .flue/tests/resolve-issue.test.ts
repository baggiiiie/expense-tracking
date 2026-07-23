import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCommitMessage, demoUrl } from '../workflows/resolve-issue.ts';

describe('buildCommitMessage', () => {
  it('references the issue without using a GitHub auto-close keyword', () => {
    const message = buildCommitMessage(20, 'Show weekdays next to dates');

    assert.equal(message, 'Address issue #20: Show weekdays next to dates\n');
    assert.doesNotMatch(message, /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#20\b/i);
  });
});

describe('demoUrl', () => {
  it('keeps agent-provided routes on the recording server origin', () => {
    assert.equal(demoUrl('/expenses/new'), 'http://127.0.0.1:8080/expenses/new');
    assert.equal(demoUrl('/?range=week'), 'http://127.0.0.1:8080/?range=week');
  });

  it('rejects external and malformed targets', () => {
    assert.equal(demoUrl('https://example.com/settings'), 'http://127.0.0.1:8080/');
    assert.equal(demoUrl('//example.com/settings'), 'http://127.0.0.1:8080/');
    assert.equal(demoUrl('http://['), 'http://127.0.0.1:8080/');
  });
});
