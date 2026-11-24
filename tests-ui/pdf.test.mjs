import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../src/api.ts';

test('PDF export sends the current analysis and returns a binary document', async t => {
  const analysis = { title: 'Исправленный процесс', edited: true };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/report/pdf');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), analysis);
    return new Response('%PDF-1.4\n', { headers: { 'Content-Type': 'application/pdf' } });
  });
  const pdf = await api.reportPdf(analysis);
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(await pdf.text(), '%PDF-1.4\n');
});

test('PDF download surfaces server validation errors and can be retried', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response(JSON.stringify({ detail: 'Цитата не найдена в исходном тексте' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    : new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }));
  await assert.rejects(api.reportPdf({}), /Цитата не найдена/);
  assert.equal((await api.reportPdf({})).type, 'application/pdf');
});

test('PDF export rejects HTML responses instead of saving a broken document', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>gateway</html>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(api.reportPdf({}), /неожиданном формате/);
});

test('PDF export explains a network interruption', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.reportPdf({}), /Нет связи с сервером/);
});
