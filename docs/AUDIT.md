# LeadFlow AI audit

Technical review of the workflow as it stood at the start of this review (**v1.0**, repository commit `cd33673`) and of the result after the fixes (**v1.1**). Written so that someone who did not take part can see what was wrong, how I know, what changed and what is still open.

- **Scope:** both n8n workflows (`LeadFlow AI` and `LeadFlow AI - Errores`), the four Code nodes, the node settings, the prompt, the documentation and the earlier manual tests.
- **Out of scope:** the Gmail, Google Sheets and Groq services themselves, n8n Cloud internals, and anything that needs credentials that are not in the project.
- **Nothing was sent.** All executions used fictional data. The workflow has no node that sends email.

## How to read the evidence

Every finding says how it was established, because a simulation is not a real run and I do not want to blur the two.

| Label | Meaning |
|---|---|
| **Live** | Reproduced or confirmed in a real execution on the n8n Cloud instance, with the real Google Sheets, Gmail drafts and Groq API. Execution numbers are given. |
| **Sim** | Reproduced with the automated tests, which run the exported workflow graph and the real Code-node source on an in-memory simulation of n8n, Groq, Sheets and Gmail (see [tests/README.md](../tests/README.md)). This is not an end-to-end test. |
| **Static** | Read from the exported configuration or the code. |
| **Deduced** | Follows from how the design works. I could not reproduce it. |

Severity: **High** = can lose or leak data, or fail silently in normal use. **Medium** = wrong or degraded behaviour that a person can notice and work around. **Low / Info** = hygiene or something to be aware of.

## Summary

| ID | Severity | Finding | Status in v1.1 |
|---|---|---|---|
| A-01 | High | Spreadsheet formula injection from email content | Fixed, Live |
| A-02 | High | IBAN and national ID numbers were stored and sent to the model; the test form bypassed the masking | Fixed, Live (residual risk below) |
| A-03 | High | No size limits on the email | Fixed, Sim |
| A-04 | Medium | The `<correo>` block could be escaped with tag variants | Fixed, Sim (prompt injection cannot be eliminated) |
| A-05 | High | A persistent AI failure aborted the batch and could lose the other emails | Fixed, Live |
| A-06 | Medium | The sheet did not say why a request failed | Fixed, Live |
| A-07 | Medium | A draft was created even for invalid, empty or recipient-less results | Fixed, Live |
| A-08 | Medium | Empty subject, empty body, missing sender or id and HTML-only emails were not handled | Fixed, Sim |
| A-09 | Medium | A link or address inserted in the draft was not flagged | Fixed, Sim |
| A-10 | Medium | Two simultaneous runs of the same email give one row but two drafts | **Open**, documented |
| A-11 | Low | A model answer that is valid JSON but not an object was not treated as a parse error | Fixed, Sim |
| A-12 | Low | The AI call had no explicit timeout | Fixed (configured), the timeout itself never provoked |
| A-13 | Low | The error workflow did not identify the email | Partly improved |
| A-14 | Low | A disconnected Gemini node with an outdated prompt stays on the canvas | Documented |
| A-15 | Info | The Gmail sender filter is a test setting | Documented |
| A-16 | Info | n8n keeps execution data, which includes email content | Documented, action for the owner |
| A-17 | Low | Documentation claims that did not match the implementation | Fixed |
| A-18 | Medium | The 100-email load test could not be reproduced from the repository | Fixed (scripted equivalent), real test stays as history |

Totals: 18 findings (4 High, 7 Medium, 5 Low, 2 Info). 14 are fixed or mitigated, 3 are documented only (A-14, A-15, A-16) and 1 is open (A-10).

## Findings

### A-01 Formula injection (High, fixed)

**Problem.** The Google Sheets nodes write with the default cell format, which behaves like typing into the sheet (`USER_ENTERED`). An email whose subject or body starts with `=`, `+`, `-` or `@` was stored as a formula. A subject such as `=HYPERLINK(...)` or `=IMPORTXML(...)` would run when someone opened the sheet.

**Evidence.** *Static:* the node had no `cellFormat` option. *Sim:* scenario S22 fails on v1.0 and passes on v1.1. The test also contains a control that proves it detects the unsafe setting. *Live:* execution **#100** wrote the subject `=1+1 PRUEBA v1.1 (datos ficticios)` and the sheet shows it as text, not as `2`.

**Fix.** `cellFormat: RAW` on both writes of the main workflow and on the append of the error workflow.

**Residual.** Data already in the sheet from earlier tests was not rewritten. It is fictional.

### A-02 Personal and payment data (High, fixed, residual risk)

**Problem.** Only card-like digit sequences were masked, and only in the Gmail path (`Normalizar correo`). IBANs and DNI/NIE numbers were saved in clear text and sent to the model. The test form path (`Edit Fields`) skipped the masking altogether, so the protection depended on which entry point the email used.

**Evidence.** *Sim:* S18 and S23 fail on v1.0. *Live:* execution **#100** (card, ES IBAN, DNI) and **#103** (GB IBAN, NL IBAN, DNI written with a hyphen) show `[número oculto]`, `[IBAN oculto]` and `[documento oculto]` in the sheet. My first IBAN pattern missed GB and NL formats (letters in the bank code) and DNI numbers written with a hyphen; I widened it and confirmed the new version in #103.

**Fix.** One sanitising step (`Preparar petición IA`) that every entry point and every retry passes through. It masks card numbers, IBANs and DNI/NIE before the data reaches the model, the sheet or the draft prompt. The sender address is not masked because the draft needs it. Masking is idempotent, so retried rows are cleaned again without damage.

**Residual.** This is pattern matching. Names, phone numbers, postal addresses and any personal detail written as free text are not removed, and an unusual number format can slip through. The workflow is designed for a business mailbox, and a real deployment would need a data-protection review (legal basis, processor agreement with the model provider, retention). That is not something code can settle.

### A-03 No size limits (High, fixed)

**Problem.** A very long email went to the model and to a sheet cell unchanged. Google Sheets limits a cell to 50,000 characters, the model API has input limits and a cost per token, and the regular expressions of the Code nodes ran on unbounded input.

**Evidence.** *Sim:* S21 and the unit test "oversized fields are cut" fail on v1.0. A 5 MB HTML body is processed in bounded time on v1.1.

**Fix.** Caps applied before anything else: subject 300, body 8,000, sender name 120, address 254, model summary 2,000 characters; control characters removed; HTML-to-text conversion bounded. A cut email is flagged (`Correo recortado por tamaño`) and requires review. The cut never leaves half of a masked number.

### A-04 Prompt structure escape (Medium, fixed; injection remains possible)

**Problem.** The email goes inside a `<correo>` block and the system prompt says the content is data. v1.0 removed only the exact lowercase tags, so `</CORREO>`, `< /correo >` or similar variants could close the block and add text that looked like instructions.

**Evidence.** *Sim:* S17b fails on v1.0 once the test uses lenient tag patterns, and passes on v1.1.

**Fix.** `<` and `>` are removed from everything that goes into the model prompt, so no tag can be opened or closed from inside the email.

**Residual.** A model can still be talked into things by plain text. That is why the defence has layers that do not trust the model: the code sets the priority when it detects orders aimed at the AI, flags links and discounts in the draft, requires review for risky categories, and the workflow can only create drafts. The earlier real tests (T04, T16) showed the model sometimes repeats the hidden order in its summary. That is flagged, not prevented.

### A-05 Persistent AI failure could lose a batch (High, fixed)

**Problem.** When the AI call failed after its three retries, the node stopped the execution. The rest of the emails of that batch were not processed. The Gmail Trigger does not offer an email again once it has delivered it, so those emails could only be recovered if someone noticed the error and retried the failed execution from the n8n interface (this is what T12 did). Nothing in the sheet said which emails were affected.

**Evidence.** *Sim:* S11 and S19b fail on v1.0, and so does the load scenario L3 (7 failing emails inside a batch of 100), which was written afterwards and run against the v1.0 files. *Live:* execution **#101** with the AI endpoint deliberately broken (only in the draft version, never published; the correct URL was restored and checked with a zero-difference comparison) wrote the row with status `error_ia` and the reason, and the execution ended in success. Execution **#102** (`Reintentar fallidos`) reprocessed that row in place, with no new row. Execution **#99** ran the same entry with nothing to retry and changed nothing.

**Fix.** The AI node continues on failure after its retries. `Leer respuesta IA` turns the failure into a readable reason (HTTP code and message, secrets scrubbed, 300 characters at most). `Validar respuesta IA` gives it status `error_ia`, and no draft is created. The duplicate check now ignores rows whose status starts with `error_`, so the same email can be processed again. A manual entry, `Reintentar fallidos`, reads the rows with `error_ia` or `error_validacion`, rebuilds the request from the stored sanitised fields and sends them through the same loop. The write is an upsert, so the row is updated, not duplicated.

**Limits.** Retry is manual by design (press the trigger in n8n); it is the simplest reliable option and it avoids retry storms against a provider that is down. A failure of Google Sheets or Gmail is still fail-fast: the execution stops, the error workflow logs it, and the execution is retried from the n8n interface (scenarios S15, S16, S19a).

### A-06 Failure reasons not visible in the sheet (Medium, fixed)

Rows with a problem showed a status, but the reason lived only in the n8n execution. Reasons are now written into `validation_flags` as `Error: …` entries, next to the other flags. Live: executions #100 to #102.

### A-07 Drafts created from bad results (Medium, fixed)

**Problem.** `Create a draft` ran after every sheet write, including rows with an invalid model answer, an empty draft text or no valid recipient. A person could find a Gmail draft with no content, or addressed to nobody, or built from an answer that had failed validation.

**Evidence.** *Sim:* reproduced on v1.0 (S08, S09, S10). *Live:* executions #101 (`error_ia`, no draft) and #100/#103 (valid result, one draft each).

**Fix.** A gate node, `¿Crear borrador?`, uses `can_draft`, computed by the validation code (valid answer, non-empty draft, recipient with `@`). When it is false the item goes back to the loop without a draft.

### A-08 Missing or empty fields (Medium, fixed)

Empty subject, empty body, invalid sender address, missing message id and emails that contain only HTML were not handled consistently. The HTML-only case arrived as an empty body. v1.1 converts HTML to text as a fallback, uses a deterministic fallback id (`sin-id-<hash>`) so the duplicate check still works, gives an empty subject a default, and raises a flag that forces human review. Sim: S06, S07, S08.

### A-09 Link or address inserted in the draft (Medium, fixed)

An email can try to make the draft contain a phishing link or a contact address of the attacker's choosing. v1.1 flags any URL or email address that appears in the draft (the draft is written by the model and has no reason to contain either) and requires review. Sim: S17. This does not decide whether the link is harmful; it makes sure a person looks.

### A-10 Simultaneous runs of the same email (Medium, open)

**Problem.** If two executions process the same email at the same moment (the case behind T09: a manual run while the workflow is published), both can pass the duplicate lookup before either writes. The upsert by `request_id` keeps the sheet at one row, but **both create a Gmail draft**, so the person finds two identical drafts.

**Evidence.** *Sim:* S14 characterises it (one row, two drafts). *Deduced* from the design. I did not reproduce it live.

**Why it is not fixed.** Closing it needs a lock shared across executions (an external store or a claim step with a write-then-verify). That adds a moving part and its own failure modes for a rare case with a harmless outcome (an extra draft). The mitigation is operational: do not execute the workflow manually while it is published, which is already in the test instructions. The test S14 is written to fail if the behaviour changes, so the documentation cannot silently drift.

### A-11 Non-object JSON (Low, fixed)

If the model returned valid JSON that was not an object (for example `[]` or `"ok"`), parsing succeeded and the failure appeared later in a confusing place. It now counts as a parse error and ends as `error_validacion` with a reason. Sim.

### A-12 No explicit timeout on the AI call (Low, fixed by configuration)

The HTTP node had no timeout of its own. It is now 30 seconds with three tries. *Static* and the integrity test check the configuration. I never provoked a real timeout, so the claim is "configured", not "observed".

### A-13 Error workflow did not identify the email (Low, partly improved)

The `errores` tab records workflow, node, message and execution link, but not which email was involved, because the error trigger does not carry it. For the AI step this is now covered, since the failed request is a row in `solicitudes` with its reason. For a Sheets or Gmail failure the execution link is still the way to find it.

### A-14 Disconnected Gemini node (Low, documented)

`Analizar con IA` (Gemini) is not connected to anything and keeps an earlier version of the prompt (rules 1 to 8). It is useful as an alternative provider but easy to connect by mistake. It is documented in the README and the architecture document, and the integrity test lists it as the only allowed unreachable node.

### A-15 Gmail sender filter (Info)

The trigger filters by sender so the test account does not process its own drafts and unrelated mail. For a real mailbox this must be replaced by proper rules. It is a placeholder in the export.

### A-16 Execution history contains email content (Info, owner action)

n8n stores the data of each execution, including subject and body, according to the instance settings. The masking happens before the model and the sheet, but the original email can still appear in the execution data of the Gmail Trigger node. For anything other than fictional data, set a short retention period for executions and restrict who can open them.

### A-17 Documentation that did not match (Low, fixed)

The README and the test documents described behaviour that v1.1 changes (an API failure used to stop the batch; now it produces `error_ia`). They were rewritten to describe the implementation as it is and to state the limits.

### A-18 The 100-email test was not reproducible (Medium, fixed)

The manual load test (T15) was real, but the emails were generated interactively and no script was kept, so nobody could repeat it. `tests/fixtures/load.js` now generates the same 100 fictional emails (seeded; 35 quote requests, 30 orders, 15 information queries, 10 complaints, 10 odd cases) and `tests/load.test.js` runs them on the simulation. The real test remains documented as history, not as something the repository can re-run without a test mailbox.

## What I reviewed and left as it was

Not everything needed a change. These parts were well designed and are unchanged:

- **The AI proposes, the code decides.** Business rules live in the validation code, not in the prompt.
- **The loop with a batch of one** and the upsert by `request_id`.
- **Schema-enforced JSON output** from the model, with a parser that tolerates both the Gemini and the OpenAI-compatible shapes.
- **Drafts only.** There is no send, reply or forward node, and a test fails if one appears.
- **Credentials live in n8n.** The exported JSON files carry placeholders only; a test scans for real IDs, keys and addresses.
- **The separate error workflow**, which logs to its own tab.

## Baseline against v1.0

The suite can be pointed at the original export with `LEADFLOW_DIR` (a folder containing the v1.0 `leadflow-ai.json` and `leadflow-errores.json`). Run before any change, the suite of that moment (77 tests) gave **34 passed and 43 failed**. Run again at the end with the final 83 tests, it gives **36 passed and 47 failed**. The ones that pass are behaviours that were already right.

Read the failures as a map of what changed, not as a count of bugs: some tests exercise features that did not exist in v1.0 (the retry entry, the `error_ia` status, the draft gate), and some fail on v1.0 because the Code nodes had a different output shape. The findings above are the ones I confirmed one by one.

After the fixes the suite has 83 tests (13 workflow integrity, 38 Code-node, 28 scenario, 4 load) and all pass. The mutation check (`npm run mutation-check`) breaks eleven things one at a time in a copy of the workflow, for example restoring `USER_ENTERED`, removing the draft gate or turning the draft node into a send node, and every one is caught by at least one test.

## Not verified

Being explicit about what I did **not** see:

- A real timeout of the AI call, and a real outage of Google Sheets or Gmail. These are simulated only.
- Concurrency (A-10), which is deduced and simulated.
- The Gmail Trigger in production against a real, busy mailbox. The load test with 100 real emails (T15) ran on v1.0 and was not repeated on v1.1; the v1.1 executions cited here are single emails.
- How n8n Cloud behaves when the manual trigger `Reintentar fallidos` is pressed from the interface by a person (I ran it through the API).
- The behaviour of the free tier of the model provider with real data. It should not be used with real customer data.
- Anything about the quality of the model's answers beyond the cases in [test-cases.md](test-cases.md). Five or six repeats per case show a trend, not a guarantee.
