import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutDiagram } from '../src/diagram-layout.ts';
import { applyDraft } from '../src/edit.ts';

const roles = [{ id: 'a', name: 'Оператор' }, { id: 'b', name: 'Руководитель' }];
const steps = [
  { id: 'start', role_id: 'a', type: 'task', title: 'Принять заявку' },
  { id: 'decision', role_id: 'b', type: 'decision', title: 'Есть решение?' },
  { id: 'end', role_id: 'a', type: 'task', title: 'Уведомить клиента' },
];
const edges = [
  { id: 'f1', from_step: 'start', to_step: 'decision', label: '' },
  { id: 'f2', from_step: 'decision', to_step: 'end', label: 'да' },
  { id: 'r1', from_step: 'decision', to_step: 'start', label: 'возврат' },
];

test('places steps in their respective lanes and preserves a return edge', () => {
  const layout = layoutDiagram(roles, steps, edges);
  const [start, decision, end] = layout.nodes;
  assert.equal(start.x, end.x);
  assert.ok(start.x < decision.x);
  assert.ok(start.y < decision.y && decision.y < end.y);
  assert.deepEqual(layout.edges.map(edge => [edge.id, edge.backward]), [
    ['f1', false], ['f2', false], ['r1', true],
  ]);
  for (const edge of layout.edges) {
    assert.ok(edge.points.every(([x, y]) => x >= 0 && x <= layout.width && y >= 0 && y <= layout.height));
  }
});

test('moves a step and transition together in the validation payload without mutating the result', () => {
  const original = { steps, edges, edited: false };
  const title = 'Проверить заявку';
  const updated = applyDraft(original, { ...steps[0], title, role_id: 'b' }, [{ ...edges[0], label: 'Готово' }]);
  assert.deepEqual(updated.steps.map(step => [step.title, step.role_id]), [
    [title, 'b'], ['Есть решение?', 'b'], ['Уведомить клиента', 'a'],
  ]);
  assert.deepEqual(updated.edges.map(edge => edge.label), ['Готово', 'да', 'возврат']);
  assert.equal(original.steps[0].title, 'Принять заявку');
  assert.equal(original.edges[0].label, '');
});

test('gives the labels of two branches from the same decision room to be read', () => {
  const { edges: routed } = layoutDiagram(roles, steps, [
    { id: 'yes', from_step: 'decision', to_step: 'end', label: 'Все документы на месте' },
    { id: 'no', from_step: 'decision', to_step: 'start', label: 'Нужны дополнительные документы' },
  ]);
  assert.ok(Math.abs(routed[0].labelAt[1] - routed[1].labelAt[1]) >= 14);
});
