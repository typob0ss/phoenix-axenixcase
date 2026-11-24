import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeReportText } from '../src/report.ts';

test('shows escaped quote punctuation and markup characters as readable text', () => {
  const escaped = String.raw`R&amp;D \[CRM\_1\] &lt;id&gt; \* \# \\ &amp;lt;`;
  assert.equal(decodeReportText(escaped), 'R&D [CRM_1] <id> * # \\ &lt;');
});
