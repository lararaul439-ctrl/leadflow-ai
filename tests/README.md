# Automated tests

```
npm test                  # 83 tests, under a second, no dependencies, no network
npm run mutation-check    # breaks the workflow in 11 ways, one at a time; every break must make a test fail
npm run load-emails       # prints the 100 fictional load-test emails as JSON (to send by hand to a TEST mailbox)
```

Requires Node.js 20 or later. There is nothing to install: the tests use the built-in `node:test` runner.

## What these tests are, and what they are not

They run **the exported workflow** (`workflows/*.json`) on a small in-memory simulation of n8n and of the three services around it. That means:

| Real, taken from the exported files | Simulated |
|---|---|
| The graph: nodes and connections | n8n itself (a small engine of about 330 lines in `helpers/engine.js`) |
| The source code of every Code node, run as written | The Groq API (a function that returns what the test needs) |
| Every expression `={{ ... }}` and every node parameter | Google Sheets (rows in memory) |
| Node settings: retries, timeout, continue on error | Gmail (drafts in memory; the world has a `sent` list that must stay empty) |

**This is not an end-to-end test.** It cannot tell you that Gmail, Sheets or Groq behave as assumed, or that n8n Cloud has no quirk the engine does not model. The real runs are documented separately, with execution numbers, in [docs/TEST_REPORT.md](../docs/TEST_REPORT.md) and [docs/test-cases.md](../docs/test-cases.md).

What the simulation is good for: the logic that is mine (sanitising, validation, routing, retries, deduplication, what gets written and what does not) can be checked in under a second, repeatedly, with failures that are hard or unwise to provoke for real (a Sheets outage, an AI timeout, two simultaneous runs).

### Assumptions about n8n built into the engine

If one of these is wrong, the tests that depend on it prove less than they appear to. They are listed so they can be questioned.

1. **Loop Over Items** (version 3): output 1 is the loop body, output 0 is "done", and the node receives the results of each batch back through its input.
2. **IF node** with strict type validation: a condition that expects a boolean fails on anything else.
3. **`Always Output Data`**: a lookup with no rows still produces one empty item.
4. **Retry on fail** repeats the same call up to `maxTries`; **continue on error** passes an error item downstream instead of stopping.
5. **Retrying an execution** resumes from the failed node with the stored data.
6. **Google Sheets**: with the default cell format the value is interpreted as if typed (so `=...` becomes a formula); with `RAW` it is stored as text. Upsert matches on the configured column.
7. **Concurrency** is modelled by interleaving the steps of two executions. It shows what the design allows, not what n8n's scheduler does in practice.

## Files

| File | Tests | What it checks |
|---|---|---|
| `workflow-integrity.test.js` | 13 | Structure of the two exported workflows: valid connections, no dead ends inside the loop, no node that can send email, no secrets or real IDs, timeouts and retries configured, plain-text writes, upsert key. |
| `code-nodes.test.js` | 38 | Each Code node on its own: `Normalizar correo`, `Preparar petición IA`, `Leer respuesta IA`, `Validar respuesta IA`. Includes the shape n8n really produces on an API failure, captured from a real execution. |
| `scenarios.test.js` | 28 | The whole workflow, one situation per test (S01 to S24): good emails, odd emails, model failures, service failures, duplicates, malicious content, recovery. |
| `load.test.js` | 4 | 100 fictional emails in one batch, the same 100 again, and 7 failures inside the 100 healed by `Reintentar fallidos`. |
| `mutation-check.js` | 11 mutations | Not a test: a script that checks the tests would notice a regression. |
| `fixtures/data.js`, `fixtures/load.js` | | Fictional emails and model answers. All addresses are `example.test` or `example.com`. |
| `helpers/` | | The engine and the loaders. |

## Pointing the tests at another export

```
LEADFLOW_DIR=/path/to/folder npm test
```

The folder must contain `leadflow-ai.json` and `leadflow-errores.json`. This is how the original v1.0 export was run through the suite to see what the fixes changed (see [docs/AUDIT.md](../docs/AUDIT.md)), and how the mutation check works.

## Known gap, on purpose

`S14` documents a limitation instead of hiding it: two simultaneous executions of the same email produce **one row and two drafts**. The test asserts exactly that. If someone fixes the limitation the test will fail, which is the cue to update the documentation.
