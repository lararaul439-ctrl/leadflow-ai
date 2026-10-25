'use strict';
// Privacy checks. Settings are read from the exported files; behaviour runs on the SIMULATED engine.
// What the instance itself retains (execution pruning, who can open executions, data redaction) cannot be
// tested from here: it needs access to the n8n instance (see docs/KNOWN_LIMITATIONS.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow } = require('./helpers/workflow');
const { createWorld, execute } = require('./helpers/engine');
const { gmailMessage, aiResponse, emails } = require('./fixtures/data');
const { groqOk } = require('./helpers/engine');

const main = loadWorkflow('workflows/leadflow-ai.json');
const errors = loadWorkflow('workflows/leadflow-errores.json');
const run = (world, msgs) => execute(main, world, { start: 'Gmail Trigger', items: msgs, errorWorkflow: errors });

test('both workflows keep no data of successful or manual runs and no partial progress; failed runs are kept on purpose', () => {
  for (const wf of [main, errors]) {
    assert.equal(wf.settings.saveDataSuccessExecution, 'none', `${wf.name}: successful runs must not store data`);
    assert.equal(wf.settings.saveManualExecutions, false, `${wf.name}: manual runs must not be stored`);
    assert.equal(wf.settings.saveExecutionProgress, false, `${wf.name}: no per-node progress saved`);
    // Failed runs stay available so that they can be diagnosed and retried from the n8n interface.
    assert.equal(wf.settings.saveDataErrorExecution, 'all', `${wf.name}: failed runs are kept deliberately`);
  }
});

test('no Code node writes to the console (console output is not redacted and ends up in the logs)', () => {
  for (const wf of [main, errors]) {
    for (const n of wf.nodes.filter((x) => x.type.endsWith('.code'))) {
      assert.ok(!/\bconsole\s*\./.test(n.parameters.jsCode), `${n.name} writes to the console`);
    }
  }
});

test('the error log holds only the flow, the node, a bounded message and a link: no e-mail content', () => {
  const cols = errors.nodes.find((n) => n.name === 'Append row in sheet').parameters.columns.value;
  assert.deepEqual(Object.keys(cols), ['fecha', 'flujo', 'nodo', 'mensaje', 'url_ejecucion']);
  for (const [k, v] of Object.entries(cols)) {
    assert.ok(!/Mensaje|Email|Nombre|Asunto|email_text|draft_reply|body/.test(v.replace(/execution\.error\.message/, '')), `${k} must not read e-mail fields`);
  }
});

test('an error message cannot carry an e-mail address or grow without limit into the error log', () => {
  const expr = errors.nodes.find((n) => n.name === 'Append row in sheet').parameters.columns.value.mensaje;
  assert.match(expr, /^=\{\{.*\}\}$/s);
  const fn = new Function('$json', 'return ' + expr.slice(3, -2));
  const msg = (m) => fn({ execution: { error: { message: m } } });
  assert.equal(msg('Invalid recipient ana.prueba@example.com in field To'), 'Invalid recipient [correo oculto] in field To');
  assert.equal(msg('a\n\n  b\tc'), 'a b c');
  assert.equal(msg('x'.repeat(5000)).length, 300);
  assert.equal(msg(undefined), '');
  assert.equal(msg('The service is currently unavailable'), 'The service is currently unavailable');
});

test('end to end: a failing Gmail node with an address in its message logs the failure without the address', () => {
  const w = createWorld({ groq: () => groqOk(aiResponse()) });
  w.gmailFailure = () => { throw new Error('Invalid To header: ana.prueba@example.com'); };
  const s = run(w, [emails.quoteComplete()]);
  assert.equal(s.error.node, 'Create a draft');
  assert.equal(w.errorSheet.rows.length, 1);
  assert.equal(w.errorSheet.rows[0].mensaje, 'Invalid To header: [correo oculto]');
  assert.ok(!JSON.stringify(w.errorSheet.rows).includes('ana.prueba@example.com'));
});

test('end to end: card numbers, IBANs and ID numbers reach neither the model nor the sheet, the draft or the error log', () => {
  const w = createWorld({ groq: () => groqOk(aiResponse()) });
  const secrets = ['4111 1111 1111 1111', 'ES9121000418450200051332', '12345678Z'];
  const m = gmailMessage({
    id: 'priv-001', subject: 'Presupuesto de 100 bolsas con datos',
    text: `Hola, quiero un presupuesto. Mi tarjeta es ${secrets[0]}, mi IBAN ${secrets[1]} y mi DNI ${secrets[2]}.`,
  });
  run(w, [m]);
  const everywhere = JSON.stringify([w.groqCalls, w.sheet.rows, w.drafts, w.errorSheet.rows, w.claimSheet.rows]);
  for (const s of secrets) assert.ok(!everywhere.includes(s) && !everywhere.includes(s.replace(/ /g, '')), `leaked: ${s}`);
  assert.equal(w.sheet.rows.length, 1);
  assert.equal(w.sheet.rows[0].human_review_required, 'sí', 'payment data forces human review');
});

test('data minimisation: the sender\'s address never goes to the model, yet the draft is still addressed to it', () => {
  const w = createWorld({ groq: () => groqOk(aiResponse()) });
  run(w, [gmailMessage({ id: 'priv-002' })]);
  assert.equal(w.groqCalls.length, 1);
  const sent = JSON.stringify(w.groqCalls);
  assert.ok(!sent.includes('ana.prueba@example.com'), 'the address was sent to the AI provider');
  assert.ok(!/@/.test(w.groqCalls[0].messages[1].content), 'no e-mail address at all in the model-bound text');
  assert.ok(sent.includes('Ana Prueba'), 'the name is still sent: it is needed for the greeting and for customer_name');
  assert.equal(w.drafts.length, 1);
  assert.equal(w.drafts[0].to, 'ana.prueba@example.com');
});

test('the claim log (shared "bloqueos" tab) stores identifiers and times only, never e-mail content', () => {
  const w = createWorld({ groq: () => groqOk(aiResponse()) });
  run(w, [emails.quoteComplete()]);
  assert.ok(w.claimSheet.rows.length >= 2);
  for (const r of w.claimSheet.rows) assert.deepEqual(Object.keys(r).sort(), ['at', 'claim_id', 'event', 'request_id']);
});
