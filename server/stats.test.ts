import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStats, getContextWindow } from './stats';

test('getContextWindow defaults to 8192', () => {
  delete process.env.MODEL_CONTEXT_WINDOW;
  assert.equal(getContextWindow(), 8192);
});

test('getContextWindow reads MODEL_CONTEXT_WINDOW', () => {
  process.env.MODEL_CONTEXT_WINDOW = '16000';
  assert.equal(getContextWindow(), 16000);
  delete process.env.MODEL_CONTEXT_WINDOW;
});

test('extractStats uses last step performance and usage inputTokens', async () => {
  const result = {
    usage: Promise.resolve({ inputTokens: 3214, outputTokens: 150 }),
    steps: Promise.resolve([
      { performance: { inputTokensPerSecond: 100, outputTokensPerSecond: 10 } },
      { performance: { inputTokensPerSecond: 412, outputTokensPerSecond: 38 } },
    ]),
  } as unknown as Parameters<typeof extractStats>[0];

  const stats = await extractStats(result);

  assert.equal(stats.type, 'conversation_stats');
  assert.equal(stats.contextTokens, 3214);
  assert.equal(stats.pp, 412);
  assert.equal(stats.tp, 38);
  assert.ok(typeof stats.contextWindow === 'number');
});

test('extractStats leaves pp/tp undefined for non-streaming step', async () => {
  const result = {
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
    steps: Promise.resolve([
      {
        performance: {
          inputTokensPerSecond: undefined,
          outputTokensPerSecond: undefined,
        },
      },
    ]),
  } as unknown as Parameters<typeof extractStats>[0];

  const stats = await extractStats(result);

  assert.equal(stats.pp, undefined);
  assert.equal(stats.tp, undefined);
});
