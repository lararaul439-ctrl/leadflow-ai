# Automated tests

```
npm test                  # 242 tests, about 4 seconds, no dependencies, no network
npm run mutation-check    # breaks the workflow in 31 ways, one at a time (about 12 minutes); every break must make a test fail
npm run lint              # extracts the Code nodes to .lint/nodes and runs ESLint over them and over tests/ (needs the network once, to fetch ESLint)
npm run load-emails       # prints the 100 fictional load-test emails as JSON (to send by hand to a TEST mailbox)
```

Requires Node.js 20 or later. There is nothing to install: the tests use the built-in `node:test` runner.

## What these tests are, and what they are not

They run **the exported workflow** (`workflows/*.json`) on a small in-memory simulation of n8n and of the three services around it. That means:

| Real, taken from the exported files | Simulated |
|---|---|
| The graph: nodes and connections | n8n itself (a small engine of about 370 lines in `helpers/engine.js`) |
| The source code of every Code node, run as written | The Groq API (a function that returns what the test needs) |
| Every expression `={{ ... }}` and every node parameter | Google Sheets (rows in memory) |
| Node settings: retries, timeout, continue on error | Gmail (drafts in memory; the world has a `sent` list that must stay empty) |

**This is not an end-to-end test.** It cannot tell you that Gmail, Sheets or Groq behave as assumed, or that n8n Cloud has no quirk the engine does not model. The real runs are documented separately, with execution numbers, in [docs/TEST_REPORT.md](../docs/TEST_REPORT.md) and [docs/test-cases.md](../docs/test-cases.md).

What the simulation is good for: the logic that is mine (sanitising, validation, routing, retries, deduplication, what gets written and what does not) can be checked in seconds, repeatedly, with failures that are hard or unwise to provoke for real (a Sheets outage, an AI timeout, two simultaneous runs, a hostile email).

### Assumptions about n8n built into the engine

If one of these is wrong, the tests that depend on it prove less than they appear to. They are listed so they can be questioned.

1. **Loop Over Items** (version 3): output 1 is the loop body, output 0 is "done", and the node receives the results of each batch back through its input.
2. **IF node** with strict type validation: a condition that expects a boolean fails on anything else.
3. **`Always Output Data`**: a lookup with no rows still produces one empty item.
4. **Retry on fail** repeats the same call up to `maxTries`; **continue on error** passes an error item downstream instead of stopping.
5. **Retrying an execution** resumes from the failed node with the stored data.
6. **Google Sheets**: with the default cell format the value is interpreted as if typed (so `=...` becomes a formula); with `RAW` it is stored as text. Upsert matches on the configured column.
7. **Concurrency** is modelled by interleaving the steps of two executions. It shows what the design allows, not what n8n's scheduler does in practice.
8. **Google Sheets appends are totally ordered** and a read after an append sees every earlier append. The claim lock depends on this. It was observed on the real sheet (executions #108 and #109, see [docs/TEST_REPORT.md](../docs/TEST_REPORT.md)), not proven in general.
9. **The model is a function.** The adversarial tests decide what the "model" answers (including answers that obey a hostile email), so they test the code around the model, not the model's own resistance.

## Files

| File | Tests | What it checks |
|---|---|---|
| `workflow-integrity.test.js` | 18 | Structure of the two exported workflows: valid connections, no unreachable node, no dead ends inside the loop, no node that can send email, no secrets or real IDs, no hidden characters in the code, timeouts and retries configured, plain-text writes, upsert key, every extracted field is stored. |
| `code-nodes.test.js` | 38 | Each Code node on its own: `Normalizar correo`, `Preparar petición IA`, `Leer respuesta IA`, `Validar respuesta IA`. Includes the shape n8n really produces on an API failure, captured from a real execution. |
| `scenarios.test.js` | 28 | The whole workflow, one situation per test (S01 to S24): good emails, odd emails, model failures, service failures, duplicates, malicious content, recovery. |
| `load.test.js` | 4 | 100 fictional emails in one batch, the same 100 again, and 7 failures inside the 100 healed by `Reintentar fallidos`. |
| `concurrency.test.js` | 27 | The claim lock: two executions interleaved at every step boundary, the worst moment, overlapping batches, a crash while holding a claim, claim expiry, a claim that cannot be seen, release on every exit, recovery (C01 to C17, U01 to U10). C12 is a documented limitation. |
| `adversarial.test.js` | 119 | Hostile and honest emails against the code around the model: orders in Spanish and English, hidden and look-alike characters, hidden HTML, tag break-outs, an obedient "model", invented figures, links, payment talk, tampered recipients. Honest emails (B01 to B14) must **not** be flagged. |
| `privacy.test.js` | 8 | What n8n and the AI provider are allowed to see: retention settings, nothing written to the console, masked error messages, card/IBAN/ID numbers reaching neither the model, the sheet, the draft nor any log, and a claim log that holds only identifiers. |
| `mutation-check.js` | 31 mutations | Not a test: a script that checks the tests would notice a regression. Eleven break the original behaviour, ten the lock, six the hardening and the stored fields, four the privacy settings and the data sent to the model. A mutation that changes nothing is reported as an error, so a typo cannot pass as "detected". |
| `extract-code-nodes.js` | | Not a test: writes the Code nodes of the exported workflows to `.lint/nodes/` (ignored by git) so that `npm run lint` can analyse them. |
| `fixtures/data.js`, `fixtures/load.js` | | Fictional emails and model answers. All addresses are `example.test` or `example.com`. |
| `helpers/` | | The engine and the loaders. |

## Pointing the tests at another export

```
LEADFLOW_DIR=/path/to/folder npm test
```

The folder must contain `leadflow-ai.json` and `leadflow-errores.json`. This is how the original v1.0 export was run through the suite to see what the fixes changed (see [docs/AUDIT.md](../docs/AUDIT.md)), and how the mutation check works.

## Known limitation, on purpose

`C12` documents a limitation instead of hiding it: if a run crashes while holding its claim, another run takes over after the claim expires, and the **old** execution is then resumed, it can still create a second draft. The test asserts exactly that. If someone fixes the limitation the test will fail, which is the cue to update [docs/KNOWN_LIMITATIONS.md](../docs/KNOWN_LIMITATIONS.md). (The v1.1 gap this replaces, two simultaneous runs giving two drafts, is closed: `S14` and the concurrency tests assert one draft.)
