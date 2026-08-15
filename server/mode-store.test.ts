import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModeStore } from './mode-store';

const store = new ModeStore('redis://localhost:6379');

test('getMode returns undefined for unknown conversation', async () => {
  const mode = await store.getMode(`nonexistent-${Date.now()}`);
  assert.equal(mode, undefined);
});

test('setMode then getMode roundtrips', async () => {
  const id = `test-${Date.now()}`;
  await store.setMode(id, 'traditional');
  const mode = await store.getMode(id);
  assert.equal(mode, 'traditional');
});

test('roundtrip preserves codemode', async () => {
  const id = `test-${Date.now()}-c`;
  await store.setMode(id, 'codemode');
  const mode = await store.getMode(id);
  assert.equal(mode, 'codemode');
});

test('close releases connection', async () => {
  await store.close();
});
