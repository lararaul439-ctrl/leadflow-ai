'use strict';
// Concurrency, duplicates and recovery on the SIMULATED engine (tests/helpers/engine.js).
//
// What is real here: the graph, the Code nodes (including the two that implement the lock), the expressions and
// the node settings come from the exported JSON. What is simulated: n8n itself and the three external services.
// The interleavings are produced by running several executions one node step at a time; every step is atomic,
// like one API call. This proves the LOGIC of the lock under many schedules; it does not prove how real Google
// Sheets behaves under load (that was measured on the real services, see docs/TEST_REPORT.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorkflow, runCode, fakeNow } = require('./helpers/workflow');
const { createWorld, startExecution, step, runToEnd, execute, retry, interleave, groqOk } = require('./helpers/engine');
const { gmailMessage, aiResponse } = require('./fixtures/data');

const wf = loadWorkflow();
const errWf = loadWorkflow('workflows/leadflow-errores.json');

const STALE_MS = 10 * 60 * 1000;
const model = () => groqOk(aiResponse());
const mail = (n) => gmailMessage({ id: `conc-${n}`, subject: `Presupuesto de 100 bolsas ${n}`, text: `Hola, necesito 100 bolsas con logo (${n}). Gracias.` });
const idOf = (n) => `conc-${n}`;
const start = (w, msgs) => startExecution(wf, w, { start: 'Gmail Trigger', items: msgs });
const startRetry = (w) => startExecution(wf, w, { start: 'Reintentar fallidos', items: [{}] });
const world = (extra = {}) => createWorld({ groq: model, ...extra });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const claimsOf = (w) => w.claimSheet.rows.filter((r) => r.event === 'claim');
const releasesOf = (w) => w.claimSheet.rows.filter((r) => r.event === 'release');

// The invariants that must hold after any schedule in which nothing fails.
function assertExactlyOnce(w, ids, label = '') {
  for (const id of ids) {
    assert.equal(w.sheet.rows.filter((r) => r.request_id === id).length, 1, `${label} one row for ${id}`);
  }
  const subjects = w.drafts.map((d) => d.subject);
  assert.equal(subjects.length, ids.length, `${label} one draft per e-mail`);
  assert.equal(new Set(subjects).size, subjects.length, `${label} no duplicated draft`);
  assert.equal(w.groqCalls.length, ids.length, `${label} one model call per e-mail`);
  assert.equal(w.sent.length, 0);
  assert.equal(w.errorSheet.rows.length, 0, `${label} no unhandled error`);
  const released = new Set(releasesOf(w).map((r) => r.claim_id));
  for (const c of claimsOf(w)) assert.ok(released.has(c.claim_id), `${label} claim ${c.claim_id} was never released`);
}

const soloSteps = (() => {
  const w = world();
  return execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] }).ran.length;
})();

// ------------------------------------------------------------------ C01 - C04: two runs, the same e-mail
test('C01 the second run starts at EVERY point of the first run: always one row, one draft, one model call', () => {
  for (let k = 0; k <= soloSteps; k++) {
    for (const first of ['a', 'b']) {
      const w = world();
      const a = start(w, [mail(1)]);
      const b = start(w, [mail(1)]);
      const [lead, late] = first === 'a' ? [a, b] : [b, a];
      for (let i = 0; i < k; i++) step(lead);
      runToEnd(late);
      runToEnd(lead);
      assert.equal(a.error, null);
      assert.equal(b.error, null);
      assertExactlyOnce(w, [idOf(1)], `[head start ${k}, lead ${first}]`);
    }
  }
});

test('C02 the worst moment: both runs claim before either reads the log', () => {
  const w = world();
  const a = start(w, [mail(1)]);
  const b = start(w, [mail(1)]);
  const reach = (s, node) => { while (!s.ran.includes(node) && step(s)); };
  reach(a, 'Crear reserva');
  reach(b, 'Crear reserva');
  assert.equal(claimsOf(w).length, 2, 'two claims are in the log');
  runToEnd(b); // the later claim reads first and must still lose
  assert.ok(b.ran.includes('Reserva perdida'));
  assert.ok(!b.ran.includes('Analizar con IA (Groq)'));
  runToEnd(a);
  assert.ok(a.ran.includes('Create a draft'));
  assertExactlyOnce(w, [idOf(1)]);
});

test('C03 chunked round-robin schedules (1 to 7 steps each turn), 2 to 4 runs of the same e-mail', () => {
  for (let runs = 2; runs <= 4; runs++) {
    for (let chunk = 1; chunk <= 7; chunk++) {
      const w = world();
      const states = Array.from({ length: runs }, () => start(w, [mail(1)]));
      for (let guard = 0; guard < 10000; guard++) {
        let moved = false;
        for (const s of states) for (let i = 0; i < chunk; i++) moved = step(s) || moved;
        if (!moved) break;
      }
      for (const s of states) assert.equal(s.error, null);
      assertExactlyOnce(w, [idOf(1)], `[${runs} runs, chunk ${chunk}]`);
    }
  }
});

test('C04 1000 random schedules of 2 to 5 runs of the same e-mail: never more than one draft', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const r = rng(seed);
    const w = world();
    const runs = 2 + Math.floor(r() * 4);
    const states = Array.from({ length: runs }, () => start(w, [mail(1)]));
    interleave(states, (n) => Math.floor(r() * n));
    for (const s of states) assert.equal(s.error, null, `seed ${seed}`);
    assertExactlyOnce(w, [idOf(1)], `[seed ${seed}]`);
  }
});

// ------------------------------------------------------------------ C05 - C07: overlapping batches and independence
test('C05 overlapping batches in opposite order: every e-mail is processed exactly once, none is lost', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7919);
    const w = world();
    const a = start(w, [mail(1), mail(2), mail(3), mail(4)]);
    const b = start(w, [mail(4), mail(3), mail(2), mail(1)]);
    const c = start(w, [mail(2), mail(4), mail(1), mail(3)]);
    interleave([a, b, c], (n) => Math.floor(r() * n));
    for (const s of [a, b, c]) assert.equal(s.error, null, `seed ${seed}`);
    assertExactlyOnce(w, [1, 2, 3, 4].map(idOf), `[seed ${seed}]`);
  }
});

test('C06 different e-mails never block each other', () => {
  const w = world();
  const a = start(w, [mail(1)]);
  const b = start(w, [mail(2)]);
  interleave([a, b], (n) => n - 1);
  assertExactlyOnce(w, [idOf(1), idOf(2)]);
  assert.ok(!a.ran.includes('Reserva perdida') && !b.ran.includes('Reserva perdida'));
});

test('C07 the run that steps aside makes no model call, writes no row and creates no draft; it only releases its own claim', () => {
  const w = world();
  const a = start(w, [mail(1)]);
  const b = start(w, [mail(1)]);
  const reach = (s, node) => { while (!s.ran.includes(node) && step(s)); };
  reach(a, 'Decidir reserva'); // a holds the claim and has not finished
  runToEnd(b);
  assert.deepEqual(b.ran.slice(-4), ['¿Gana la reserva?', 'Reserva perdida', 'Liberar reserva', 'Procesar de uno en uno']);
  assert.equal(w.groqCalls.length, 0);
  assert.equal(w.sheet.rows.length, 0);
  assert.equal(w.drafts.length, 0);
  assert.equal(releasesOf(w).length, 1);
  assert.equal(releasesOf(w)[0].claim_id, claimsOf(w)[1].claim_id, 'it released its own claim, not the winner\'s');
  runToEnd(a);
  assertExactlyOnce(w, [idOf(1)]);
});

// ------------------------------------------------------------------ C08 - C09: the retry button, as measured on real n8n
function errorRow(n) {
  const m = mail(n);
  return {
    request_id: idOf(n), received_at: '2026-10-24T09:00:00.000Z', sender_name: 'Carla Ficticia', sender_email: 'carla.ficticia@example.test',
    subject: m.subject, body: m.text, category: '', priority: '', summary: '', status: 'error_ia', human_review_required: 'sí',
    validation_flags: 'Error de la IA: prueba',
  };
}

test('C08 two "Reintentar fallidos" runs at the same time on one failed row: one draft (this was 2 drafts before the lock, measured on real n8n)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 104729);
    const w = world({ sheetRows: [errorRow(1)] });
    const a = startRetry(w);
    const b = startRetry(w);
    interleave([a, b], (n) => Math.floor(r() * n));
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    assert.equal(w.sheet.rows.length, 1, `seed ${seed}`);
    assert.equal(w.sheet.rows[0].status, 'pendiente_revision', `seed ${seed}: the row was healed`);
    assert.equal(w.drafts.length, 1, `seed ${seed}`);
    assert.equal(w.groqCalls.length, 1, `seed ${seed}`);
    for (const c of claimsOf(w)) assert.ok(releasesOf(w).some((x) => x.claim_id === c.claim_id));
  }
});

test('C09 a retry run and a new arrival of the same e-mail at the same time: one draft', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 15485863);
    const w = world({ sheetRows: [errorRow(1)] });
    const a = startRetry(w);
    const b = start(w, [mail(1)]);
    interleave([a, b], (n) => Math.floor(r() * n));
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    assert.equal(w.sheet.rows.length, 1);
    assert.equal(w.drafts.length, 1, `seed ${seed}`);
  }
});

// ------------------------------------------------------------------ C10 - C14: crashes, stale claims, recovery
test('C10 a run that crashed while holding the claim blocks the e-mail for a while, and resuming it releases the claim', () => {
  const w = world();
  w.gmailFailure = () => { throw new Error('Gmail API: 500 backend error'); };
  const a = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.equal(a.error.node, 'Create a draft');
  assert.equal(w.sheet.rows.length, 1);
  assert.equal(w.drafts.length, 0);
  assert.equal(releasesOf(w).length, 0, 'the crashed run kept its claim');

  // A second arrival within the window steps aside: nobody else works on it while the first one can still be resumed.
  const b = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.ok(b.ran.includes('Reserva perdida'));
  assert.equal(w.groqCalls.length, 1);
  assert.equal(w.drafts.length, 0);

  // Gmail is back: "Retry execution" resumes at the failed node and finishes the job.
  w.gmailFailure = null;
  retry(a, { errorWorkflow: errWf });
  assert.equal(a.error, null);
  assert.equal(w.drafts.length, 1);
  assert.equal(w.sheet.rows.length, 1);
  assert.equal(w.groqCalls.length, 1);
  const c = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] });
  assert.ok(c.ran.includes('Duplicado ignorado'));
  assert.equal(w.drafts.length, 1);
  assert.equal(w.groqCalls.length, 1);
  const released = new Set(releasesOf(w).map((x) => x.claim_id));
  for (const claim of claimsOf(w)) assert.ok(released.has(claim.claim_id), 'every claim ends released');
});

test('C11 a claim that was never released expires after 10 minutes: the e-mail is not blocked forever', () => {
  const w = world();
  w.sheetsFailure = (op, _a, node) => { if (node.name === 'Append or update row in sheet') throw new Error('The service is currently unavailable'); };
  const a = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.equal(a.error.node, 'Append or update row in sheet');
  assert.equal(w.sheet.rows.length, 0, 'the first run died before writing anything');
  w.sheetsFailure = null;

  w.advance(STALE_MS - 60 * 1000); // 9 minutes later: still blocked
  const early = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] });
  assert.ok(early.ran.includes('Reserva perdida'));
  assert.equal(w.sheet.rows.length, 0);

  w.advance(2 * 60 * 1000); // 11 minutes after the crash: the claim is stale
  const late = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] });
  assert.equal(late.error, null);
  assert.ok(late.ran.includes('Create a draft'));
  assert.equal(w.sheet.rows.length, 1);
  assert.equal(w.drafts.length, 1);
});

test('C12 KNOWN LIMITATION: resuming a crashed run AFTER another run took over its stale claim can still create a second draft', () => {
  const w = world();
  let down = true;
  w.sheetsFailure = (op, _a, node) => { if (down && node.name === 'Append or update row in sheet') throw new Error('The service is currently unavailable'); };
  const a = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.equal(a.error.node, 'Append or update row in sheet');
  down = false;
  w.advance(STALE_MS + 1000);
  execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] }); // took over and finished
  assert.equal(w.drafts.length, 1);
  retry(a); // "Retry execution" resumes at the failed node and does not look at the lock again
  assert.equal(w.drafts.length, 2, 'documented in KNOWN_LIMITATIONS.md: do not retry an execution that is more than 10 minutes old without checking Gmail drafts');
  assert.equal(w.sheet.rows.length, 1, 'the sheet is still protected by the upsert');
});

test('C13 if the run cannot see its own claim it stops with an error instead of guessing (fail closed)', () => {
  const w = world();
  w.sheetsReadHook = (node, rows) => (node.name === 'Leer reservas' ? [] : rows); // e.g. a read that lags behind the write
  const s = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.equal(s.error.node, 'Decidir reserva');
  assert.match(s.error.message, /reserva propia no aparece/);
  assert.equal(w.groqCalls.length, 0);
  assert.equal(w.sheet.rows.length, 0);
  assert.equal(w.drafts.length, 0);
  assert.equal(w.errorSheet.rows.length, 1);
  assert.equal(w.errorSheet.rows[0].nodo, 'Decidir reserva');
});

test('C14 failures around the lock: claim write and claim read are retried 3 times and then stop the run before any model call', () => {
  for (const nodeName of ['Crear reserva', 'Leer reservas']) {
    const w = world();
    let attempts = 0;
    w.sheetsFailure = (op, _a, node) => { if (node.name === nodeName) { attempts++; throw new Error('Quota exceeded'); } };
    const s = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
    assert.equal(attempts, 3, nodeName);
    assert.equal(s.error.node, nodeName);
    assert.equal(w.groqCalls.length, 0, 'no model call (and no cost) when the lock cannot be taken');
    assert.equal(w.drafts.length, 0);
    assert.equal(w.errorSheet.rows.length, 1);
  }
});

test('C15 a failure while releasing the claim: row and draft exist, the error is logged, resuming releases the claim', () => {
  const w = world();
  let down = true;
  w.sheetsFailure = (op, _a, node) => { if (down && node.name === 'Liberar reserva') throw new Error('The service is currently unavailable'); };
  const s = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)], errorWorkflow: errWf });
  assert.equal(s.error.node, 'Liberar reserva');
  assert.equal(w.sheet.rows.length, 1);
  assert.equal(w.drafts.length, 1);
  assert.equal(w.errorSheet.rows[0].nodo, 'Liberar reserva');
  down = false;
  retry(s, { errorWorkflow: errWf });
  assert.equal(s.error, null);
  assert.equal(w.drafts.length, 1, 'nothing was created twice');
  assert.equal(releasesOf(w).length, 1);
  assert.equal(w.groqCalls.length, 1);
});

test('C16 a batch where one e-mail is a duplicate of an earlier one: every claim is released on every path', () => {
  const w = world();
  execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] });
  const s = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1), mail(2), mail(3)] });
  assert.equal(s.error, null);
  assert.equal(w.drafts.length, 3);
  assert.equal(claimsOf(w).length, 4);
  assert.equal(releasesOf(w).length, 4);
  assert.equal(claimsOf(w).length, new Set(claimsOf(w).map((c) => c.claim_id)).size, 'claim ids are unique');
});

test('C17 a not-drafted outcome (failed model call) also releases the claim, and the retry can claim again', () => {
  const w = createWorld({ groq: () => { throw new Error('503 Service Unavailable'); } });
  const s = execute(wf, w, { start: 'Gmail Trigger', items: [mail(1)] });
  assert.equal(s.error, null);
  assert.equal(w.sheet.rows[0].status, 'error_ia');
  assert.equal(releasesOf(w).length, 1);
  w.groq = model;
  const r = execute(wf, w, { start: 'Reintentar fallidos', items: [{}] });
  assert.equal(r.error, null);
  assert.equal(w.sheet.rows[0].status, 'pendiente_revision');
  assert.equal(w.drafts.length, 1);
  assert.equal(releasesOf(w).length, 2);
});

// ------------------------------------------------------------------ U01 - U10: the two lock Code nodes on their own
const claim = (n, id, at, extra = {}) => ({ request_id: id, claim_id: `c${n}`, event: 'claim', at: new Date(at).toISOString(), row_number: n + 1, ...extra });
const release = (n, id, of, at) => ({ request_id: id, claim_id: `c${of}`, event: 'release', at: new Date(at).toISOString(), row_number: n + 1 });
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const decide = (rows, mine) => runCode(wf, 'Decidir reserva', { items: rows, refs: { 'Preparar reserva': [mine] } })[0];
const me = (n, id = 'r1', at = T0) => ({ request_id: id, claim_id: `c${n}`, claim_at: new Date(at).toISOString(), Email: 'x@example.test' });

test('U01 Decidir reserva: the first claim wins and the others do not', () => {
  const rows = [claim(1, 'r1', T0), claim(2, 'r1', T0 + 10)];
  assert.equal(decide(rows, me(1, 'r1', T0)).claim_won, true);
  const loser = decide(rows, me(2, 'r1', T0 + 10));
  assert.equal(loser.claim_won, false);
  assert.equal(loser.claim_holder, 'c1');
});

test('U02 Decidir reserva: the order is the sheet order (row_number), not the order the rows arrive in', () => {
  const rows = [claim(2, 'r1', T0 + 10), claim(1, 'r1', T0)];
  assert.equal(decide(rows, me(1, 'r1', T0)).claim_won, true);
  assert.equal(decide(rows, me(2, 'r1', T0 + 10)).claim_won, false);
});

test('U03 Decidir reserva: a released claim no longer blocks', () => {
  const rows = [claim(1, 'r1', T0), release(2, 'r1', 1, T0 + 5), claim(3, 'r1', T0 + 20)];
  assert.equal(decide(rows, me(3, 'r1', T0 + 20)).claim_won, true);
});

test('U04 Decidir reserva: a claim older than 10 minutes is stale; one just under 10 minutes still blocks', () => {
  const mineAt = T0 + STALE_MS;
  assert.equal(decide([claim(1, 'r1', T0), claim(2, 'r1', mineAt)], me(2, 'r1', mineAt)).claim_won, true, 'exactly 10 minutes: stale');
  const justUnder = T0 + STALE_MS - 1;
  assert.equal(decide([claim(1, 'r1', T0), claim(2, 'r1', justUnder)], me(2, 'r1', justUnder)).claim_won, false);
});

test('U05 Decidir reserva: claims of other e-mails are ignored', () => {
  const rows = [claim(1, 'other', T0), claim(2, 'r1', T0 + 1)];
  assert.equal(decide(rows, me(2, 'r1', T0 + 1)).claim_won, true);
});

test('U06 Decidir reserva: it throws when its own claim is missing, and when the list is empty', () => {
  assert.throws(() => decide([claim(1, 'r1', T0)], me(9, 'r1', T0 + 1)), /reserva propia no aparece/);
  assert.throws(() => decide([{}], me(1)), /reserva propia no aparece/);
  assert.throws(() => decide([], me(1)), /reserva propia no aparece/);
  // a release row with our claim_id is not a claim
  assert.throws(() => decide([release(2, 'r1', 1, T0)], me(1)), /reserva propia no aparece/);
});

test('U07 Decidir reserva: a claim with an unreadable timestamp counts as stale (a hand-edited row cannot block forever)', () => {
  const rows = [{ ...claim(1, 'r1', T0), at: 'not a date' }, claim(2, 'r1', T0 + 1)];
  assert.equal(decide(rows, me(2, 'r1', T0 + 1)).claim_won, true);
});

test('U08 Decidir reserva: the e-mail data travels on unchanged', () => {
  const out = decide([claim(1, 'r1', T0)], { ...me(1), Email: 'ana@example.test', Mensaje: 'texto' });
  assert.equal(out.Email, 'ana@example.test');
  assert.equal(out.Mensaje, 'texto');
  assert.equal(out.request_id, 'r1');
});

test('U09 Preparar reserva: unique claim ids, ISO timestamp, e-mail untouched; refuses an item without request_id', () => {
  const item = { request_id: 'r1', Email: 'ana@example.test', Mensaje: 'hola' };
  const ids = new Set();
  for (let i = 0; i < 2000; i++) {
    const out = runCode(wf, 'Preparar reserva', { items: [item], now: fakeNow(T0), execution: { id: '77' } })[0];
    ids.add(out.claim_id);
    assert.equal(out.claim_at, new Date(T0).toISOString());
    assert.equal(out.Email, 'ana@example.test');
    assert.match(out.claim_id, /^77-\d+-[a-z0-9]+$/);
  }
  assert.equal(ids.size, 2000, 'two claims never share an id, even in the same millisecond of the same execution');
  assert.throws(() => runCode(wf, 'Preparar reserva', { items: [{ request_id: '' }] }), /no tiene request_id/);
  assert.throws(() => runCode(wf, 'Preparar reserva', { items: [{}] }), /no tiene request_id/);
});

test('U10 Decidir reserva with 200 rows from other e-mails stays fast and correct', () => {
  const rows = [];
  for (let i = 1; i <= 200; i++) rows.push(claim(i, `other-${i}`, T0 + i));
  rows.push(claim(201, 'r1', T0 + 300));
  const t0 = Date.now();
  assert.equal(decide(rows, me(201, 'r1', T0 + 300)).claim_won, true);
  assert.ok(Date.now() - t0 < 500);
});
