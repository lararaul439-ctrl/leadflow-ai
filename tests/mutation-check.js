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
const errBase = fs.readFileSync(`${REPO}/workflows/leadflow-errores.json`, 'utf8');
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
};
let missed = 0;
for (const [name, fn] of Object.entries(mutations)) {
  const w = JSON.parse(JSON.stringify(base));
  fn(w);
  const dir = fs.mkdtempSync(path.join(SP, 'mut-'));
  fs.writeFileSync(`${dir}/leadflow-ai.json`, JSON.stringify(w, null, 2));
  fs.writeFileSync(`${dir}/leadflow-errores.json`, errBase);
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
