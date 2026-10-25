'use strict';
// Writes the source of every Code node of the exported workflows to .lint/nodes/ so that a linter can read it.
// The folder is generated and ignored by git. Usage: node tests/extract-code-nodes.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.lint', 'nodes');
fs.rmSync(path.join(root, '.lint'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let count = 0;
for (const file of ['leadflow-ai', 'leadflow-errores']) {
  const wf = JSON.parse(fs.readFileSync(path.join(root, 'workflows', `${file}.json`), 'utf8'));
  for (const node of wf.nodes.filter((n) => n.type.endsWith('.code'))) {
    fs.writeFileSync(path.join(out, `${file}__${node.name.replace(/[^A-Za-z0-9]+/g, '_')}.js`), node.parameters.jsCode);
    count++;
  }
}
console.log(`extracted ${count} Code nodes to .lint/nodes`);
