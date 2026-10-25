'use strict';
// Mutation check: break ONE thing at a time in a COPY of the workflow and confirm that the test suite notices.
// It answers "would these tests really catch a regression?" and it never touches workflows/.
//
//   npm run mutation-check
//
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const REPO = path.resolve(__dirname, '..');
const SP = fs.mkdtempSync(path.join(os.tmpdir(), 'leadflow-mutations-'));
const base = JSON.parse(fs.readFileSync(`${REPO}/workflows/leadflow-ai.json`, 'utf8'));
const errBase = JSON.parse(fs.readFileSync(`${REPO}/workflows/leadflow-errores.json`, 'utf8'));
const N = (w, n) => w.nodes.find((x) => x.name === n);
const mutations = {
  'Groq node no longer continues on error': (w) => { delete N(w, 'Analizar con IA (Groq)').onError; },
  'Sheets back to USER_ENTERED': (w) => { N(w, 'Append or update row in sheet').parameters.options = {}; },
  'duplicate rule ignores status again': (w) => { N(w, '¿Duplicado?').parameters.conditions.conditions[0].leftValue = '={{ !!$json.request_id }}'; },
  'draft gate removed (always draft)': (w) => { w.connections['Append or update row in sheet'] = { main: [[{ node: 'Create a draft', type: 'main', index: 0 }]] }; },
  'masking removed from Preparar': (w) => { const n = N(w, 'Preparar petición IA'); n.parameters.jsCode = n.parameters.jsCode.replace(/\[número oculto\]/, '$&').replace(/\.replace\(\/\\b\(\?:\\d\[ -\]\?\)\{12,18\}\\d\\b\/g, '\[número oculto\]'\)/, ''); },
  'size cap removed': (w) => { const n = N(w, 'Preparar petición IA'); n.parameters.jsCode = n.parameters.jsCode.replace('const MAX_MENSAJE = 8000;', 'const MAX_MENSAJE = 1e9;'); },
  'upsert key changed to sender_email': (w) => { N(w, 'Append or update row in sheet').parameters.columns.matchingColumns = ['sender_email']; },
  'manipulation priority override removed': (w) => { const n = N(w, 'Validar respuesta IA'); n.parameters.jsCode = n.parameters.jsCode.replace('if (fijada) priority = fijada;', ''); },
  'Gmail node changed to send': (w) => { N(w, 'Create a draft').parameters.resource = 'message'; },
  'retry entry disconnected': (w) => { delete w.connections['Preparar reintento']; },
  'loop dead end (IF false unconnected)': (w) => { w.connections['¿Crear borrador?'].main[1] = []; },
  // the lock (concurrency)
  'lock bypassed (no claim before the duplicate lookup)': (w) => { w.connections['Preparar petición IA'] = { main: [[{ node: 'Buscar duplicado', type: 'main', index: 0 }]] }; },
  'every run wins its claim': (w) => { const n = N(w, 'Decidir reserva'); n.parameters.jsCode = n.parameters.jsCode.replace('claim_won: !!winner && winner.claim_id === mine.claim_id', 'claim_won: true'); },
  'the LAST claim wins instead of the first': (w) => { const n = N(w, 'Decidir reserva'); n.parameters.jsCode = n.parameters.jsCode.replace('const winner = active[0];', 'const winner = active[active.length - 1];'); },
  'claims never expire': (w) => { const n = N(w, 'Decidir reserva'); n.parameters.jsCode = n.parameters.jsCode.replace('reference - Date.parse(r.at) < STALE_MS', 'true'); },
  'released claims still block': (w) => { const n = N(w, 'Decidir reserva'); n.parameters.jsCode = n.parameters.jsCode.replace('!released.has(r.claim_id)', 'true'); },
  'a missing own claim no longer stops the run': (w) => { const n = N(w, 'Decidir reserva'); n.parameters.jsCode = n.parameters.jsCode.replace('if (!rows.some(', 'if (false && !rows.some('); },
  'the run that lost keeps going': (w) => { w.connections['¿Gana la reserva?'].main[1] = [{ node: 'Buscar duplicado', type: 'main', index: 0 }]; },
  'one path forgets to release (draft -> loop)': (w) => { w.connections['Create a draft'] = { main: [[{ node: 'Procesar de uno en uno', type: 'main', index: 0 }]] }; },
  'the claim is written without useAppend': (w) => { delete N(w, 'Crear reserva').parameters.options.useAppend; },
  'claim read no longer outputs on empty': (w) => { delete N(w, 'Leer reservas').alwaysOutputData; },
  // hardening against hostile e-mails and unsafe model answers
  'an unsafe model draft is no longer replaced by the safe template': (w) => { const n = N(w, 'Validar respuesta IA'); n.parameters.jsCode = n.parameters.jsCode.replace("(manipulacion || riesgos.length > 0)", 'false'); },
  'figures that are not in the e-mail are no longer flagged': (w) => { const n = N(w, 'Validar respuesta IA'); n.parameters.jsCode = n.parameters.jsCode.replace('regla(inventadas.length > 0,', 'regla(false,'); },
  'the recipient address is no longer validated': (w) => { const n = N(w, 'Preparar petición IA'); n.parameters.jsCode = n.parameters.jsCode.replace(".test(Email)) {\n  Email = '';", ".test(Email) || true) {\n  Email = Email;"); },
  'invisible characters are no longer removed from the e-mail': (w) => { const n = N(w, 'Preparar petición IA'); n.parameters.jsCode = n.parameters.jsCode.replace("s = s.replace(INVISIBLES, '').replace(ENTRE_LETRAS, '');", ''); },
  'text hidden with CSS is no longer dropped from HTML e-mails': (w) => { const n = N(w, 'Normalizar correo'); n.parameters.jsCode = n.parameters.jsCode.replace('(SIEMPRE_FUERA.has(nombre) || OCULTO.test(etiqueta))', 'SIEMPRE_FUERA.has(nombre)'); },
  'an extracted field is no longer stored in the sheet': (w) => { const c = N(w, 'Append or update row in sheet').parameters.columns; delete c.value.company; c.schema = c.schema.filter((x) => x.id !== 'company'); },
  // privacy
  'successful runs store their data again': (w) => { w.settings.saveDataSuccessExecution = 'all'; },
  'the error log no longer masks e-mail addresses': (w, e) => { N(e, 'Append row in sheet').parameters.columns.value.mensaje = '={{ $json.execution.error.message }}'; },
  'manual runs of the error workflow are stored again': (w, e) => { e.settings.saveManualExecutions = true; },
};
let missed = 0;
for (const [name, fn] of Object.entries(mutations)) {
  const w = JSON.parse(JSON.stringify(base));
  const e = JSON.parse(JSON.stringify(errBase));
  const before = JSON.stringify([w, e]);
  fn(w, e);
  if (JSON.stringify([w, e]) === before) { console.log('INVALID (the mutation changed nothing, fix the script) ' + name); missed++; continue; }
  const dir = fs.mkdtempSync(path.join(SP, 'mut-'));
  fs.writeFileSync(`${dir}/leadflow-ai.json`, JSON.stringify(w, null, 2));
  fs.writeFileSync(`${dir}/leadflow-errores.json`, JSON.stringify(e, null, 2));
  const r = cp.spawnSync('node', ['--test'], { cwd: REPO, env: { ...process.env, LEADFLOW_DIR: dir }, encoding: 'utf8' });
  const failed = (r.stdout.match(/^not ok \d+ - .*/gm) || []).map((l) => l.replace(/^not ok \d+ - /, '').slice(0, 70));
  const killed = failed.length > 0;
  if (!killed) missed++;
  console.log((killed ? 'KILLED ' : 'SURVIVED ') + name + (killed ? '  <- ' + failed.slice(0, 2).join(' | ') : ''));
  fs.rmSync(dir, { recursive: true });
}
fs.rmSync(SP, { recursive: true, force: true });
console.log(missed ? `${missed} mutation(s) survived` : 'all mutations detected');
process.exit(missed ? 1 : 0);
