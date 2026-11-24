import assert from 'node:assert/strict';
import test from 'node:test';
import { measurementQuestions } from '../src/result-notes.ts';

test('missing estimates produce interview questions without technical field names', () => {
  const questions = measurementQuestions({
    steps: [{duration_minutes: null}],
    bottlenecks: [{time_minutes: null, cost_rub: null}],
    recommendations: [{estimated_saving_minutes: null}],
  });
  assert.equal(questions.length, 5);
  assert.ok(questions.some(q => q.includes('сколько раз') || q.includes('Сколько раз')));
  assert.ok(questions.some(q => q.includes('стоимость часа')));
  assert.ok(questions.some(q => q.includes('пилоте')));
  assert.ok(questions.every(q => !/null|duration_minutes|time_minutes|сервер/i.test(q)));
});

test('confirmed zero values do not create missing-data questions', () => {
  assert.deepEqual(measurementQuestions({
    steps: [{duration_minutes: 0}],
    bottlenecks: [{time_minutes: 0, cost_rub: 0}],
    recommendations: [{estimated_saving_minutes: 0}],
  }), []);
});

test('missing savings alone asks only about the pilot', () => {
  const questions = measurementQuestions({
    steps: [{duration_minutes: 7}],
    bottlenecks: [{time_minutes: 2, cost_rub: 30}],
    recommendations: [{estimated_saving_minutes: null}],
  });
  assert.equal(questions.length, 1);
  assert.match(questions[0], /пилоте/);
});
