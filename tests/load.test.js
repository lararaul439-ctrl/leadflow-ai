'use strict';
// Load scenarios on the SIMULATED engine (not on n8n or the real services).
// They complement the manual load test T15 of docs/test-cases.md (100 real e-mails, not scripted at the time):
// this one is scripted, deterministic and can be repeated by anyone with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow } = require('./helpers/workflow');
const { createWorld, execute } = require('./helpers/engine');
const { generate, loadModel } = require('./fixtures/load');

const wf = loadWorkflow();
const errWf = loadWorkflow('workflows/leadflow-errores.json');
const items = generate();
const batch = items.map((i) => i.message);

test('the generator produces the documented mix of 100 fictional e-mails, always the same ones', () => {
  assert.equal(items.length, 100);
  const count = (c) => items.filter((i) => i.expected.category === c).length;
  assert.deepEqual([count('presupuesto'), count('pedido'), count('informacion'), count('reclamacion')], [35, 31, 15, 10]);
  assert.equal(count('otra'), 9);
  assert.equal(new Set(items.map((i) => i.message.id)).size, 100);
  assert.deepEqual(generate().map((i) => i.message.subject), items.map((i) => i.message.subject));
  assert.ok(items.every((i) => /@example\.test$/.test(i.message.from.value[0].address)), 'only fictional addresses');
});

test('L1 100 e-mails in one batch: 100 rows, 100 drafts, categories as expected, no duplicates, nothing sent', () => {
  const w = createWorld({ groq: loadModel(items) });
  const t0 = Date.now();
  const s = execute(wf, w, { start: 'Gmail Trigger', items: batch, errorWorkflow: errWf });
  assert.equal(s.error, null);
  assert.ok(Date.now() - t0 < 10000);
  assert.equal(w.sheet.rows.length, 100);
  assert.equal(new Set(w.sheet.rows.map((r) => r.request_id)).size, 100);
  assert.equal(w.drafts.length, 100);
  assert.equal(w.groqCalls.length, 100);
  assert.equal(w.sent.length, 0);
  assert.equal(w.errorSheet.rows.length, 0);
  for (const it of items) {
    const row = w.sheet.rows.find((r) => r.request_id === it.message.id);
    assert.equal(row.category, it.expected.category, it.ref);
    // complaints are always high priority; orders carrying instructions for the AI get the priority set by code
    if (it.expected.category === 'reclamacion') assert.equal(row.priority, 'alta', it.ref);
  }
  const manipulation = w.sheet.rows.filter((r) => /manipulación/.test(r.validation_flags));
  assert.equal(manipulation.length, 5, 'the 5 e-mails with hidden orders are flagged');
  assert.ok(manipulation.every((r) => r.human_review_required === 'sí'));
});

test('L2 running the same 100 e-mails again changes nothing', () => {
  const w = createWorld({ groq: loadModel(items) });
  execute(wf, w, { start: 'Gmail Trigger', items: batch });
  const snapshot = JSON.stringify([w.sheet.rows, w.drafts.length, w.groqCalls.length]);
  const again = execute(wf, w, { start: 'Gmail Trigger', items: batch });
  assert.equal(again.error, null);
  assert.equal(JSON.stringify([w.sheet.rows, w.drafts.length, w.groqCalls.length]), snapshot);
});

test('L3 7 e-mails hit a persistent AI outage inside the batch: the other 93 are completed, then "Reintentar fallidos" heals the 7', () => {
  const failing = new Set(['L003', 'L017', 'L029', 'L044', 'L058', 'L071', 'L096']);
  const calls = {};
  let outage = true;
  const model = loadModel(items, { failRefs: failing, calls });
  const w = createWorld({ groq: (body, n) => (outage ? model(body, n) : loadModel(items, { calls })(body, n)) });

  const s = execute(wf, w, { start: 'Gmail Trigger', items: batch, errorWorkflow: errWf });
  assert.equal(s.error, null, 'the batch runs to the end');
  assert.equal(w.sheet.rows.length, 100);
  assert.equal(w.drafts.length, 93);
  const failed = w.sheet.rows.filter((r) => r.status === 'error_ia');
  assert.deepEqual(failed.map((r) => r.subject.match(/\((L\d{3})\)/)[1]).sort(), [...failing].sort());
  assert.ok(failed.every((r) => /Fallo al llamar a la IA: 429/.test(r.validation_flags) && r.body.length > 0));
  assert.equal(w.groqCalls.length, 93 + 7 * 3);

  outage = false;
  const r = execute(wf, w, { start: 'Reintentar fallidos', items: [{}], errorWorkflow: errWf });
  assert.equal(r.error, null);
  assert.equal(w.sheet.rows.length, 100, 'rows were updated in place, not duplicated');
  assert.equal(w.sheet.rows.filter((x) => x.status === 'error_ia').length, 0);
  assert.equal(w.drafts.length, 100);
  assert.equal(w.groqCalls.length, 93 + 7 * 3 + 7, 'only the 7 failed e-mails were analysed again');
  for (const ref of Object.keys(calls)) if (!failing.has(ref)) assert.equal(calls[ref], 1, `${ref} was analysed more than once`);
});
