import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRetryAfter,
  computeRetryDelayMs,
  withRetry,
  getRetryConfig,
} from './retry';

test('parseRetryAfter parses integer seconds', () => {
  const result = parseRetryAfter('5');
  assert.ok(result !== undefined);
  assert.ok(result >= 4000 && result <= 6000);
});

test('parseRetryAfter parses HTTP-date', () => {
  const future = new Date(Date.now() + 10_000).toUTCString();
  const result = parseRetryAfter(future);
  assert.ok(result !== undefined);
  assert.ok(result > 0 && result <= 10_000);
});

test('parseRetryAfter returns undefined for garbage', () => {
  assert.equal(parseRetryAfter('not-a-date'), undefined);
});

test('computeRetryDelayMs grows exponentially without jitter', () => {
  const config = {
    maxRetries: 5,
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    jitter: false,
  };
  assert.equal(computeRetryDelayMs(0, undefined, config), 100);
  assert.equal(computeRetryDelayMs(1, undefined, config), 200);
  assert.equal(computeRetryDelayMs(2, undefined, config), 400);
});

test('computeRetryDelayMs caps at maxDelayMs', () => {
  const config = {
    maxRetries: 10,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    jitter: false,
  };
  assert.equal(computeRetryDelayMs(5, undefined, config), 1_000);
});

test('computeRetryDelayMs prefers retryAfter over exponential', () => {
  const config = {
    maxRetries: 5,
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    jitter: false,
  };
  assert.equal(computeRetryDelayMs(0, 2_000, config), 2_000);
});

test('withRetry retries on 429 and succeeds', async () => {
  const config = {
    maxRetries: 3,
    baseDelayMs: 1,
    maxDelayMs: 10,
    jitter: false,
  };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls === 1) return new Response('rate limited', { status: 429 });
    return new Response('ok', { status: 200 });
  };
  const wrapped = withRetry(fakeFetch as typeof fetch, config);
  const res = await wrapped('http://x', { method: 'GET' });
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('withRetry gives up after maxRetries on persistent 429', async () => {
  const config = {
    maxRetries: 2,
    baseDelayMs: 1,
    maxDelayMs: 10,
    jitter: false,
  };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response('rate limited', { status: 429 });
  };
  const wrapped = withRetry(fakeFetch as typeof fetch, config);
  const res = await wrapped('http://x');
  assert.equal(res.status, 429);
  assert.equal(calls, 3);
});

test('withRetry does not retry on 400', async () => {
  const config = {
    maxRetries: 3,
    baseDelayMs: 1,
    maxDelayMs: 10,
    jitter: false,
  };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response('bad request', { status: 400 });
  };
  const wrapped = withRetry(fakeFetch as typeof fetch, config);
  const res = await wrapped('http://x');
  assert.equal(res.status, 400);
  assert.equal(calls, 1);
});

test('withRetry retries on network error', async () => {
  const config = {
    maxRetries: 2,
    baseDelayMs: 1,
    maxDelayMs: 10,
    jitter: false,
  };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('network down');
    return new Response('ok', { status: 200 });
  };
  const wrapped = withRetry(fakeFetch as typeof fetch, config);
  const res = await wrapped('http://x');
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('getRetryConfig returns defaults without env', () => {
  const config = getRetryConfig();
  assert.equal(config.maxRetries, 5);
  assert.equal(config.baseDelayMs, 500);
  assert.equal(config.maxDelayMs, 30_000);
  assert.equal(config.jitter, true);
});
