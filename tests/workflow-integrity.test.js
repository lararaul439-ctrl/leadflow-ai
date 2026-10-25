'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { workflowPath, loadWorkflow, getNode } = require('./helpers/workflow');

const main = loadWorkflow('workflows/leadflow-ai.json');
const errors = loadWorkflow('workflows/leadflow-errores.json');
const files = ['workflows/leadflow-ai.json', 'workflows/leadflow-errores.json'];

const targets = (wf, name) =>
  ((wf.connections[name] && wf.connections[name].main) || []).flatMap((out) => out.map((c) => c.node));

test('both workflow files are valid JSON with unique node names', () => {
  for (const wf of [main, errors]) {
    const names = wf.nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length, `duplicate node names in ${wf.name}`);
  }
});

test('every connection points to nodes that exist', () => {
  for (const wf of [main, errors]) {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [src, conn] of Object.entries(wf.connections)) {
      assert.ok(names.has(src), `connection source does not exist: ${src}`);
      for (const out of conn.main) for (const c of out) assert.ok(names.has(c.node), `${src} -> ${c.node} does not exist`);
    }
  }
});

test('every node is reachable from a trigger (no orphan nodes, no leftover provider node)', () => {
  const triggers = main.nodes.filter((n) => /trigger/i.test(n.type)).map((n) => n.name);
  assert.deepEqual(triggers.sort(), ['Gmail Trigger', 'On form submission', 'Reintentar fallidos'].sort());
  const seen = new Set(triggers);
  const stack = [...triggers];
  while (stack.length) for (const t of targets(main, stack.pop())) if (!seen.has(t)) { seen.add(t); stack.push(t); }
  const unreachable = main.nodes.map((n) => n.name).filter((n) => !seen.has(n));
  assert.deepEqual(unreachable, []);
});

test('no path inside the loop dead-ends: every email path returns to "Procesar de uno en uno" (nothing is silently dropped)', () => {
  const loop = 'Procesar de uno en uno';
  const entry = main.connections[loop].main[1].map((c) => c.node); // output 1 = "loop"
  const seen = new Set();
  const stack = [...entry];
  while (stack.length) {
    const n = stack.pop();
    if (n === loop || seen.has(n)) continue;
    seen.add(n);
    const node = getNode(main, n);
    const outs = (main.connections[n] && main.connections[n].main) || [];
    const expected = node.type.endsWith('.if') ? 2 : 1;
    assert.equal(outs.length, expected, `${n} must have ${expected} connected output(s)`);
    outs.forEach((o, i) => assert.ok(o.length > 0, `${n} output ${i} leads nowhere: emails would be dropped`));
    for (const t of targets(main, n)) stack.push(t);
  }
  assert.ok(seen.has('Create a draft') && seen.has('Duplicado ignorado') && seen.has('¿Crear borrador?'));
});

test('the workflow can only create drafts: no Gmail node sends, replies or forwards', () => {
  const gmail = main.nodes.filter((n) => /gmail$/i.test(n.type));
  assert.equal(gmail.length, 1);
  assert.equal(gmail[0].name, 'Create a draft');
  assert.equal(gmail[0].parameters.resource, 'draft');
  for (const wf of [main, errors]) {
    for (const n of wf.nodes) {
      assert.ok(!/emailSend|smtp|sendGrid|slack|telegram|whatsapp/i.test(n.type), `unexpected sending node: ${n.name} (${n.type})`);
    }
  }
});

test('exported files contain no secrets, real IDs or real e-mail addresses', () => {
  const secretPatterns = [
    [/gsk_[A-Za-z0-9]{10,}/, 'Groq API key'],
    [/AIza[0-9A-Za-z_-]{20,}/, 'Google API key'],
    [/sk-[A-Za-z0-9]{20,}/, 'OpenAI-style key'],
    [/ya29\.[0-9A-Za-z_-]{20,}/, 'Google OAuth token'],
    [/Bearer\s+[A-Za-z0-9._-]{15,}/, 'bearer token'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/, 'JWT'],
  ];
  const mail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const allowedMails = new Set(['TU_CORREO_DE_PRUEBAS@ejemplo.com']);
  for (const f of files) {
    const text = fs.readFileSync(workflowPath(f), 'utf8');
    for (const [re, what] of secretPatterns) assert.ok(!re.test(text), `${f} looks like it contains a ${what}`);
    for (const m of text.match(mail) || []) assert.ok(allowedMails.has(m), `${f} contains an e-mail address: ${m}`);
  }
  for (const wf of [main, errors]) {
    for (const n of wf.nodes) {
      for (const cred of Object.values(n.credentials || {})) {
        assert.equal(cred.id, 'CONFIGURAR_CREDENCIAL', `${n.name} carries a real credential id`);
      }
    }
  }
});

test('placeholders are present, the workflow is exported inactive and carries no pinned data', () => {
  const text = fs.readFileSync(workflowPath('workflows/leadflow-ai.json'), 'utf8');
  assert.ok(text.includes('TU_ID_DE_HOJA') && text.includes('TU_CORREO_DE_PRUEBAS@ejemplo.com') && text.includes('ID_DEL_FLUJO_DE_ERRORES'));
  assert.equal(main.active, false);
  assert.deepEqual(main.pinData || {}, {});
  assert.equal(main.settings.errorWorkflow, 'ID_DEL_FLUJO_DE_ERRORES');
});

test('every Code node compiles', () => {
  for (const wf of [main, errors]) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      assert.doesNotThrow(() => vm.compileFunction(n.parameters.jsCode, ['$input', '$', '$now', '$execution']), `${n.name} does not compile`);
    }
  }
});

test('AI call: timeout, retries and "continue on failure" are configured (a failed email must not stop the batch)', () => {
  const groq = getNode(main, 'Analizar con IA (Groq)');
  assert.equal(groq.parameters.options.timeout, 30000);
  assert.equal(groq.retryOnFail, true);
  assert.equal(groq.maxTries, 3);
  assert.equal(groq.onError, 'continueRegularOutput');
  assert.equal(groq.credentials.httpHeaderAuth.id, 'CONFIGURAR_CREDENCIAL');
  assert.ok(!('headerParameters' in groq.parameters), 'the key must live in the credential, not in the node');
});

test('Google Sheets writes store plain text (no formula injection from e-mail content)', () => {
  assert.equal(getNode(main, 'Append or update row in sheet').parameters.options.cellFormat, 'RAW');
  assert.equal(getNode(errors, 'Append row in sheet').parameters.options.cellFormat, 'RAW');
});

test('the write is an upsert keyed by request_id (a repeated write cannot duplicate a row)', () => {
  const w = getNode(main, 'Append or update row in sheet').parameters;
  assert.equal(w.operation, 'appendOrUpdate');
  assert.deepEqual(w.columns.matchingColumns, ['request_id']);
  assert.deepEqual(Object.keys(w.columns.value), [
    'request_id', 'received_at', 'sender_name', 'sender_email', 'subject', 'body',
    'status', 'category', 'priority', 'summary', 'human_review_required', 'validation_flags',
    'customer_name', 'company', 'requested_service', 'quantity', 'missing_information',
  ]);
});

test('the system prompt tells the model that the e-mail is untrusted data', () => {
  const body = getNode(main, 'Analizar con IA (Groq)').parameters.jsonBody;
  assert.match(body, /DATOS NO CONFIABLES/);
  assert.match(body, /"additionalProperties": false/);
  assert.match(body, /"strict"|"json_schema"/);
});

test('the error workflow logs the node, the message and the execution link', () => {
  const cols = getNode(errors, 'Append row in sheet').parameters.columns.value;
  assert.deepEqual(Object.keys(cols), ['fecha', 'flujo', 'nodo', 'mensaje', 'url_ejecucion']);
});

// ---------------------------------------------------------------- the claim lock (see docs/architecture.md)
test('lock: the model, the duplicate lookup, the sheet write and the draft can only be reached through the claim gate', () => {
  const entry = main.connections['Procesar de uno en uno'].main[1].map((c) => c.node);
  const seen = new Set();
  const stack = [...entry];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n) || n === 'Procesar de uno en uno') continue;
    seen.add(n);
    const outs = (main.connections[n] && main.connections[n].main) || [];
    outs.forEach((o, i) => {
      for (const c of o) {
        if (n === '¿Gana la reserva?' && i === 0) continue; // the "won" edge is the only way past the gate
        stack.push(c.node);
      }
    });
  }
  for (const guarded of ['Buscar duplicado', 'Analizar con IA (Groq)', 'Append or update row in sheet', 'Create a draft']) {
    assert.ok(!seen.has(guarded), `${guarded} can be reached without winning the claim`);
  }
  assert.deepEqual(targets(main, '¿Gana la reserva?').sort(), ['Buscar duplicado', 'Reserva perdida']);
  assert.deepEqual(main.connections['¿Gana la reserva?'].main[0].map((c) => c.node), ['Buscar duplicado']);
});

test('lock: every way out of an e-mail releases its claim before the loop continues', () => {
  const loop = 'Procesar de uno en uno';
  const sources = Object.entries(main.connections)
    .filter(([, c]) => c.main.some((o) => o.some((x) => x.node === loop)))
    .map(([src]) => src)
    .sort();
  assert.deepEqual(sources, ['Edit Fields', 'Liberar reserva', 'Normalizar correo', 'Preparar reintento'].sort());
  const into = Object.entries(main.connections)
    .filter(([, c]) => c.main.some((o) => o.some((x) => x.node === 'Liberar reserva')))
    .map(([src]) => src)
    .sort();
  assert.deepEqual(into, ['Create a draft', 'Duplicado ignorado', 'Reserva perdida', '¿Crear borrador?'].sort());
});

test('lock: claims and releases are single-call appends of plain text, retried, and the read never returns nothing silently', () => {
  for (const name of ['Crear reserva', 'Liberar reserva']) {
    const n = getNode(main, name);
    assert.equal(n.parameters.operation, 'append', name);
    assert.equal(n.parameters.sheetName.cachedResultName, 'bloqueos', name);
    assert.equal(n.parameters.options.useAppend, true, `${name}: without useAppend two simultaneous appends can land on the same row`);
    assert.equal(n.parameters.options.cellFormat, 'RAW', name);
    assert.equal(n.retryOnFail, true, name);
    assert.deepEqual(Object.keys(n.parameters.columns.value), ['request_id', 'claim_id', 'event', 'at'], name);
  }
  assert.equal(getNode(main, 'Crear reserva').parameters.columns.value.event, 'claim');
  assert.equal(getNode(main, 'Liberar reserva').parameters.columns.value.event, 'release');
  const read = getNode(main, 'Leer reservas');
  assert.equal(read.alwaysOutputData, true, 'an empty read must reach Decidir reserva, which stops the run loudly');
  assert.equal(read.parameters.filtersUI.values[0].lookupColumn, 'request_id');
  assert.equal(read.parameters.sheetName.cachedResultName, 'bloqueos');
});

test('every field the workflow extracts is stored in the sheet (no extracted data is silently dropped)', () => {
  const append = getNode(main, 'Append or update row in sheet');
  const mapped = Object.keys(append.parameters.columns.value);
  const schema = append.parameters.columns.schema.map((c) => c.id);
  assert.deepEqual(schema.sort(), [...mapped].sort(), 'the schema and the mapping must list the same columns');
  for (const col of ['customer_name', 'company', 'requested_service', 'quantity', 'missing_information']) {
    assert.ok(mapped.includes(col), `extracted field not stored in the sheet: ${col}`);
  }
  assert.equal(append.parameters.options.cellFormat, 'RAW');
  assert.deepEqual(append.parameters.columns.matchingColumns, ['request_id']);
});

test('code nodes contain no hidden characters (invisible, control or line-separator characters must be written as escapes)', () => {
  // Raw invisible characters in a regex or string are impossible to review and U+2028/2029 can break a regex literal.
  for (const wf of [main, errors]) {
    for (const n of wf.nodes.filter((x) => x.type.endsWith('.code'))) {
      const bad = [...n.parameters.jsCode].filter((c) => /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}]/u.test(c) || (/\p{Cc}/u.test(c) && !'\n\t\r'.includes(c)));
      assert.deepEqual(bad.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()), [], `hidden characters in ${n.name}`);
    }
  }
});
