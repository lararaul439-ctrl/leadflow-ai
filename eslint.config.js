'use strict';
// Static analysis for the project's own JavaScript: the test suite and the Code nodes of the exported
// workflows (extracted to .lint/nodes by `npm run lint`). Dependency-free: `npx eslint@9` is enough.
const rules = {
  'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-unreachable': 'error',
  'no-dupe-keys': 'error', 'no-dupe-else-if': 'error', 'no-empty': 'warn', 'no-useless-escape': 'warn', 'no-redeclare': 'error',
  'no-self-assign': 'error', 'no-constant-condition': 'warn', 'no-cond-assign': 'error', 'no-fallthrough': 'error',
  'no-unsafe-finally': 'error', 'no-prototype-builtins': 'warn', 'no-sparse-arrays': 'error', 'use-isnan': 'error',
  'valid-typeof': 'error', 'no-const-assign': 'error', 'no-dupe-args': 'error', 'no-func-assign': 'error',
  'no-import-assign': 'error', 'no-loss-of-precision': 'error', 'no-unsafe-negation': 'error',
  eqeqeq: ['warn', 'always', { null: 'ignore' }],
};
const nodeGlobals = {
  require: 'readonly', module: 'writable', process: 'readonly', __dirname: 'readonly', console: 'readonly',
  Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly',
};
const n8nGlobals = { $input: 'readonly', $: 'readonly', $json: 'readonly', $now: 'readonly', $execution: 'readonly', $items: 'readonly', $node: 'readonly' };

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    // Code nodes run as the body of a function, so a top-level `return` is legal there.
    files: ['.lint/nodes/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', parserOptions: { ecmaFeatures: { globalReturn: true } }, globals: n8nGlobals },
    // The character classes of the sanitiser list invisible and combining characters on purpose, to strip them.
    rules: { ...rules, 'no-misleading-character-class': 'off' },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
    rules: { ...rules, 'no-misleading-character-class': 'error' },
  },
];
