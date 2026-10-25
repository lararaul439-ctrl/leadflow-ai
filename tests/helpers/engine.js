'use strict';
// A deliberately small simulation of the parts of n8n that LeadFlow AI uses.
//
// WHAT IS REAL: the workflow graph (nodes + connections), every Code node (the exported
// `jsCode`), every expression (`={{ ... }}`) and every node parameter come from the exported JSON.
// WHAT IS SIMULATED: n8n itself and the three external services. Groq, Google Sheets and Gmail are
// in-memory mocks (see createWorld). Semantics assumed for n8n are listed in tests/README.md.
//
// This is NOT an end-to-end test against n8n, Gmail or Google Sheets.
const { runCode, clone } = require('./workflow');

class NodeError extends Error {
  constructor(node, message) {
    super(message);
    this.node = node;
  }
}

// ---------- in-memory world: Groq, Google Sheets, Gmail ----------
function createWorld({ groq, sheetRows = [], clockStart = Date.UTC(2026, 9, 24, 10, 0, 0) } = {}) {
  let tick = 0;
  const world = {
    groq: groq || (() => { throw new Error('no groq mock'); }),
    groqCalls: [],
    sheet: { rows: sheetRows.map(clone), formulaCells: [] },
    errorSheet: { rows: [] },
    drafts: [],
    sent: [], // nothing in the workflow can send; any test can assert this stays empty
    // failure injection: (operation, attempt, node) => throws to simulate an outage
    sheetsFailure: null,
    gmailFailure: null,
    now: () => {
      const t = clockStart + 1000 * tick++;
      return { toMillis: () => t, toString: () => new Date(t).toISOString() };
    },
  };
  return world;
}

// ---------- expressions ----------
const api = (items) => ({
  first: () => ({ json: items[0] }),
  all: () => items.map((json) => ({ json })),
  last: () => ({ json: items[items.length - 1] }),
});

function evalExpr(expr, ctx) {
  const fn = new Function('$json', '$', '$now', `return (${expr}\n);`);
  const $ = (name) => {
    if (!(name in ctx.outputs)) throw new Error(`Node '${name}' has not been executed`);
    return api(ctx.outputs[name]);
  };
  return fn(ctx.json, $, ctx.now());
}

function evalParam(value, ctx) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const tpl = value.slice(1);
  const single = tpl.match(/^\s*\{\{([\s\S]*?)\}\}\s*$/);
  if (single && !single[1].includes('}}')) return evalExpr(single[1], ctx);
  return tpl.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const v = evalExpr(e, ctx);
    return v == null ? '' : String(v);
  });
}

// ---------- node handlers ----------
function withRetries(node, fn) {
  const tries = node.retryOnFail ? node.maxTries || 3 : 1;
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return fn(attempt);
    } catch (err) {
      last = err;
    }
  }
  if (node.onError === 'continueRegularOutput') return { __continued: { error: last.message } };
  throw new NodeError(node.name, last.message);
}

function cellLooksLikeFormula(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v);
}

const handlers = {
  'n8n-nodes-base.gmailTrigger': (_n, { items }) => [items],
  'n8n-nodes-base.formTrigger': (_n, { items }) => [items],
  'n8n-nodes-base.manualTrigger': (_n, { items }) => [items],
  'n8n-nodes-base.errorTrigger': (_n, { items }) => [items],
  'n8n-nodes-base.noOp': (_n, { items }) => [items],

  'n8n-nodes-base.code': (node, { items, state, wf }) => {
    const refs = {};
    for (const [k, v] of Object.entries(state.outputs)) refs[k] = v;
    try {
      return [runCode(wf, node.name, { items, refs })];
    } catch (e) {
      throw new NodeError(node.name, e.message);
    }
  },

  'n8n-nodes-base.set': (node, { items, ctxFor }) => {
    const p = node.parameters;
    return [
      items.map((json) => {
        const ctx = ctxFor(json);
        const out = {};
        for (const a of p.assignments.assignments) {
          let v = evalParam(a.value, ctx);
          if (a.type === 'string' && v != null) v = String(v);
          out[a.name] = v;
        }
        const keep = p.includeOtherFields === undefined ? false : evalParam(p.includeOtherFields, ctx);
        return keep ? { ...json, ...out } : out;
      }),
    ];
  },

  'n8n-nodes-base.if': (node, { items, ctxFor }) => {
    const yes = [];
    const no = [];
    for (const json of items) {
      const ctx = ctxFor(json);
      const results = node.parameters.conditions.conditions.map((c) => {
        const left = evalParam(c.leftValue, ctx);
        const { type, operation } = c.operator;
        if (type === 'boolean' && operation === 'true') {
          if (typeof left !== 'boolean') throw new NodeError(node.name, `Wrong type: '${left}' is not a boolean`);
          return left === true;
        }
        if (type === 'string' && operation === 'notEmpty') {
          if (left !== undefined && left !== null && typeof left !== 'string') throw new NodeError(node.name, 'Wrong type: not a string');
          return typeof left === 'string' && left !== '';
        }
        throw new NodeError(node.name, `Unsupported IF operator in test engine: ${type}.${operation}`);
      });
      const pass = node.parameters.conditions.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
      (pass ? yes : no).push(json);
    }
    return [yes, no];
  },

  'n8n-nodes-base.httpRequest': (node, { items, ctxFor, world }) => {
    const out = [];
    for (const json of items) {
      const ctx = ctxFor(json);
      let body;
      try {
        body = JSON.parse(evalParam(node.parameters.jsonBody, ctx));
      } catch (e) {
        throw new NodeError(node.name, `JSON parameter needs to be valid JSON: ${e.message}`);
      }
      const res = withRetries(node, () => {
        world.groqCalls.push(body);
        return world.groq(body, world.groqCalls.length);
      });
      out.push(res && res.__continued ? res.__continued : res);
    }
    return [out];
  },

  'n8n-nodes-base.googleSheets': (node, { items, ctxFor, world }) => {
    const p = node.parameters;
    const op = p.operation || 'read';
    const out = [];
    for (const json of items) {
      const ctx = ctxFor(json);
      const result = withRetries(node, (attempt) => {
        if (world.sheetsFailure) world.sheetsFailure(op, attempt, node);
        if (op === 'read') {
          const filters = ((p.filtersUI && p.filtersUI.values) || []).map((f) => ({
            col: f.lookupColumn,
            val: String(evalParam(f.lookupValue, ctx)),
          }));
          const combine = p.combineFilters || 'AND';
          const rows = world.sheet.rows.filter((r) => {
            if (filters.length === 0) return true;
            const m = filters.map((f) => String(r[f.col]) === f.val);
            return combine === 'OR' ? m.some(Boolean) : m.every(Boolean);
          });
          return rows.map(clone);
        }
        if (op === 'appendOrUpdate' || op === 'append') {
          const values = {};
          for (const [k, v] of Object.entries(p.columns.value)) values[k] = evalParam(v, ctx);
          const raw = p.options && p.options.cellFormat === 'RAW';
          const target = node.parameters.sheetName.cachedResultName === 'errores' ? world.errorSheet : world.sheet;
          if (!raw) {
            for (const [col, v] of Object.entries(values)) {
              if (cellLooksLikeFormula(v)) target.formulaCells = (target.formulaCells || []).concat({ column: col, value: v });
            }
          }
          if (op === 'appendOrUpdate') {
            const keys = p.columns.matchingColumns;
            const idx = target.rows.findIndex((r) => keys.every((k) => String(r[k]) === String(values[k])));
            if (idx >= 0) target.rows[idx] = { ...target.rows[idx], ...values };
            else target.rows.push({ ...values });
          } else {
            target.rows.push({ ...values });
          }
          return [clone(values)];
        }
        throw new NodeError(node.name, `Unsupported Sheets operation in test engine: ${op}`);
      });
      if (result && result.__continued) out.push(result.__continued);
      else if (result.length === 0 && node.alwaysOutputData) out.push({});
      else out.push(...result);
    }
    return [out];
  },

  'n8n-nodes-base.gmail': (node, { items, ctxFor, world }) => {
    const p = node.parameters;
    if (p.resource !== 'draft') throw new NodeError(node.name, `Gmail resource '${p.resource}' is not allowed: LeadFlow AI must only create drafts`);
    const out = [];
    for (const json of items) {
      const ctx = ctxFor(json);
      withRetries(node, (attempt) => {
        if (world.gmailFailure) world.gmailFailure(attempt, node);
        world.drafts.push({
          to: evalParam(p.options.sendTo, ctx),
          subject: evalParam(p.subject, ctx),
          message: evalParam(p.message, ctx),
        });
      });
      out.push({ id: `draft-${world.drafts.length}` });
    }
    return [out];
  },

  // Loop Over Items (batch size 1). Same semantics as n8n v3: output 1 = "loop", output 0 = "done".
  'n8n-nodes-base.splitInBatches': (node, { items, state }) => {
    const size = Number(node.parameters.batchSize || 1);
    let loop = state.loops[node.name];
    if (!loop) {
      loop = state.loops[node.name] = { pending: clone(items), results: [] };
    } else {
      loop.results.push(...clone(items));
    }
    if (loop.pending.length === 0) {
      delete state.loops[node.name];
      return [loop.results, []];
    }
    const batch = loop.pending.splice(0, size);
    return [[], batch];
  },
};

// ---------- execution ----------
function startExecution(wf, world, { start, items }) {
  return {
    wf,
    world,
    queue: [{ node: start, items: clone(items) }],
    outputs: {},
    loops: {},
    ran: [],
    error: null,
    finished: false,
  };
}

function step(state) {
  if (state.error || state.queue.length === 0) {
    state.finished = !state.error && state.queue.length === 0;
    return false;
  }
  const task = state.queue.shift();
  const node = state.wf.nodes.find((n) => n.name === task.node);
  const handler = handlers[node.type];
  if (!handler) throw new Error(`Unsupported node type in test engine: ${node.type} (${node.name})`);
  const ctxFor = (json) => ({ json, outputs: state.outputs, now: state.world.now });
  try {
    const outs = handler(node, { items: task.items, state, wf: state.wf, world: state.world, ctxFor });
    state.ran.push(node.name);
    state.outputs[node.name] = outs[0] && outs[0].length ? outs[0] : outs.find((o) => o.length) || [];
    const conns = (state.wf.connections[node.name] && state.wf.connections[node.name].main) || [];
    outs.forEach((outItems, idx) => {
      if (!outItems.length) return;
      for (const c of conns[idx] || []) state.queue.push({ node: c.node, items: clone(outItems) });
    });
  } catch (err) {
    state.queue.unshift(task); // like "retry from the failed node": the task is kept
    state.error = { node: err.node || node.name, message: err.message, task };
  }
  return true;
}

function runToEnd(state) {
  let guard = 0;
  while (step(state)) {
    if (++guard > 10000) throw new Error('Execution did not finish (infinite loop in the graph?)');
  }
  return state;
}

// n8n runs the separate error workflow when a production execution fails.
function runErrorWorkflow(errWf, world, state, executionId = 1) {
  const s = startExecution(errWf, world, {
    start: 'Error Trigger',
    items: [{
      workflow: { name: state.wf.name },
      execution: {
        id: executionId,
        url: `https://n8n.example.test/execution/${executionId}`,
        lastNodeExecuted: state.error.node,
        error: { message: state.error.message },
      },
    }],
  });
  return runToEnd(s);
}

function execute(wf, world, { start, items, errorWorkflow }) {
  const state = startExecution(wf, world, { start, items });
  runToEnd(state);
  if (state.error && errorWorkflow) state.errorRun = runErrorWorkflow(errorWorkflow, world, state);
  return state;
}

// "Retry execution" in n8n resumes from the failed node using the stored execution data.
function retry(state, { errorWorkflow } = {}) {
  if (!state.error) throw new Error('Nothing to retry');
  state.error = null;
  runToEnd(state);
  if (state.error && errorWorkflow) state.errorRun = runErrorWorkflow(errorWorkflow, state.world, state);
  return state;
}

// Convenience builders ----------------------------------------------------
function groqOk(ai) {
  return { choices: [{ message: { content: typeof ai === 'string' ? ai : JSON.stringify(ai) }, finish_reason: 'stop' }] };
}

module.exports = { createWorld, startExecution, step, runToEnd, execute, retry, runErrorWorkflow, groqOk, NodeError, evalParam };
