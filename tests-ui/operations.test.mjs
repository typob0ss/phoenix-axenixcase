import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperations } from '../src/operations.ts';

test('a pending save blocks another edit or analysis and releases the workspace on completion', async () => {
  const states = [];
  const runner = createOperations(state => states.push(state));
  const pending = Promise.withResolvers();
  let startedAgain = false;
  const save = runner.run('save', () => pending.promise);
  assert.equal(runner.active, 'save');
  for (const kind of ['save', 'analyze']) {
    await assert.rejects(runner.run(kind, async () => { startedAgain = true; }), /Дождитесь/);
  }
  assert.equal(startedAgain, false);
  pending.resolve('validated');
  assert.equal(await save, 'validated');
  assert.deepEqual(states, ['save', null]);
  assert.equal(await runner.run('analyze', async () => 'new analysis'), 'new analysis');
});

test('a failed validation releases the workspace for retry', async () => {
  const runner = createOperations(() => {});
  await assert.rejects(runner.run('save', async () => { throw new Error('Неверная цитата'); }), /Неверная цитата/);
  assert.equal(runner.active, null);
  assert.equal(await runner.run('save', async () => 'validated'), 'validated');
});
