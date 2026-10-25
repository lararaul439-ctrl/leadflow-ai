'use strict';
// Utilities to load the exported n8n workflows and run their Code nodes
// exactly as exported (the real `jsCode`), with the n8n globals mocked.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

// LEADFLOW_DIR lets you run the whole suite against another copy of the exported workflows
// (for example an older version) without touching the repository.
function workflowPath(file) {
  if (process.env.LEADFLOW_DIR) return path.join(process.env.LEADFLOW_DIR, path.basename(file));
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

function loadWorkflow(file = 'workflows/leadflow-ai.json') {
  return JSON.parse(fs.readFileSync(workflowPath(file), 'utf8'));
}

function getNode(wf, name) {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`Node not found in workflow: ${name}`);
  return node;
}

// The subset of Luxon's DateTime that the Code nodes use.
function fakeNow(ms) {
  return { toMillis: () => ms, toISO: () => new Date(ms).toISOString(), toString: () => new Date(ms).toISOString() };
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Mimics the n8n item API used by the Code nodes: $input.all()/first(),
// and $('Node Name').first()/all().
function makeItemApi(items) {
  const wrapped = () => items.map((json) => ({ json: clone(json) }));
  return {
    all: () => wrapped(),
    first: () => wrapped()[0],
    last: () => wrapped().slice(-1)[0],
  };
}

// items: array of plain json objects (the input of the node)
// refs:  { 'Other node name': [json, ...] }  -> available through $('Other node name')
// now / execution: stand-ins for n8n's `$now` (a Luxon DateTime) and `$execution`.
function runCode(wf, nodeName, { items = [], refs = {}, now, execution = { id: '1' } } = {}) {
  const node = getNode(wf, nodeName);
  const fn = vm.compileFunction(node.parameters.jsCode, ['$input', '$', '$now', '$execution'], {
    filename: `${nodeName}.js`,
  });
  const $now = now || fakeNow(Date.now());
  const $input = makeItemApi(items);
  const $ = (name) => {
    if (!(name in refs)) throw new Error(`Node '${name}' has not been executed`);
    return makeItemApi(refs[name]);
  };
  const out = fn($input, $, $now, execution);
  // Normalise away cross-realm prototypes so assertions compare plain data.
  return clone(out).map((o) => o.json);
}

module.exports = { ROOT, workflowPath, loadWorkflow, getNode, runCode, clone, fakeNow };
