# LeadFlow AI audit

Technical review of the workflow in two rounds. The first looked at the workflow as it stood at the start (**v1.0**, repository commit `cd33673`) and ended with **v1.1**. The second round (**v1.2**, findings B-01 to B-07 at the end of this file) closed the open items of the first and went deeper into concurrency, privacy and hostile input. Written so that someone who did not take part can see what was wrong, how I know, what changed and what is still open.

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

| ID | Severity | Finding | Status |
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
| A-10 | Medium | Two simultaneous runs of the same email give one row but two drafts | Fixed in v1.2 (claim lock), Live, see B-01 |
| A-11 | Low | A model answer that is valid JSON but not an object was not treated as a parse error | Fixed, Sim |
| A-12 | Low | The AI call had no explicit timeout | Fixed (configured), the timeout itself never provoked |
| A-13 | Low | The error workflow did not identify the email | Partly improved |
| A-14 | Low | A disconnected Gemini node with an outdated prompt stays on the canvas | Fixed in v1.2 (node removed), see B-06 |
| A-15 | Info | The Gmail sender filter is a test setting | Documented |
| A-16 | Info | n8n keeps execution data, which includes email content | Mitigated in v1.2; instance-level actions remain for the owner, see B-02 |
| A-17 | Low | Documentation claims that did not match the implementation | Fixed |
| A-18 | Medium | The 100-email load test could not be reproduced from the repository | Fixed (scripted equivalent), real test stays as history |

Totals: 18 findings (4 High, 7 Medium, 5 Low, 2 Info). After the second round none is open: 16 are fixed or mitigated, A-13 is only partly improved, A-15 is a placeholder to replace before real use, and A-16 needs two settings that only the owner of the n8n instance can change. The second round's own findings are B-01 to B-07 at the end of this file.

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

### A-10 Simultaneous runs of the same email (Medium, fixed in v1.2)

**Problem.** If two executions process the same email at the same moment (the case behind T09: a manual run while the workflow is published), both can pass the duplicate lookup before either writes. The upsert by `request_id` keeps the sheet at one row, but **both create a Gmail draft**, so the person finds two identical drafts.

**Evidence.** *Sim:* S14 characterises it (one row, two drafts). *Deduced* from the design. I did not reproduce it live.

**Update (v1.2).** Fixed with a claim lock, described in B-01. The text below is the reasoning of the first round, kept as history; the "why not" no longer applies.

**Why it was not fixed in v1.1.** Closing it needs a lock shared across executions (an external store or a claim step with a write-then-verify). That adds a moving part and its own failure modes for a rare case with a harmless outcome (an extra draft). The mitigation is operational: do not execute the workflow manually while it is published, which is already in the test instructions. The test S14 was written to fail if the behaviour changed, so the documentation could not silently drift. It did fail when the lock arrived, and it now asserts one draft.

### A-11 Non-object JSON (Low, fixed)

If the model returned valid JSON that was not an object (for example `[]` or `"ok"`), parsing succeeded and the failure appeared later in a confusing place. It now counts as a parse error and ends as `error_validacion` with a reason. Sim.

### A-12 No explicit timeout on the AI call (Low, fixed by configuration)

The HTTP node had no timeout of its own. It is now 30 seconds with three tries. *Static* and the integrity test check the configuration. I never provoked a real timeout, so the claim is "configured", not "observed".

### A-13 Error workflow did not identify the email (Low, partly improved)

The `errores` tab records workflow, node, message and execution link, but not which email was involved, because the error trigger does not carry it. For the AI step this is now covered, since the failed request is a row in `solicitudes` with its reason. For a Sheets or Gmail failure the execution link is still the way to find it.

### A-14 Disconnected Gemini node (Low, documented)

`Analizar con IA` (Gemini) was not connected to anything and kept an earlier version of the prompt (rules 1 to 8). It was useful as an alternative provider but easy to connect by mistake. In v1.1 it was documented and the integrity test listed it as the only allowed unreachable node. **In v1.2 it was removed** (B-06); the response reader still understands the Gemini response shape, so switching provider is a change to one node.

### A-15 Gmail sender filter (Info)

The trigger filters by sender so the test account does not process its own drafts and unrelated mail. For a real mailbox this must be replaced by proper rules. It is a placeholder in the export.

### A-16 Execution history contains email content (Info, owner action)

n8n stores the data of each execution, including subject and body, according to the instance settings. The masking happens before the model and the sheet, but the original email can still appear in the execution data of the Gmail Trigger node. For anything other than fictional data, set a short retention period for executions and restrict who can open them. **v1.2 applies the workflow-level part of this (B-02)**; retention and access are instance settings and stay as owner actions.

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

At the end of the first round (v1.1) the suite had 83 tests (13 workflow integrity, 38 Code-node, 28 scenario, 4 load) and all passed, and the mutation check broke eleven things one at a time.

**Second round.** The suite now has 241 tests (18 integrity, 38 Code-node, 28 scenario, 4 load, 27 concurrency, 119 adversarial, 7 privacy) and all pass. Pointed at the v1.1 export it gives **113 passed and 128 failed**; the new files account for most of it: the adversarial file passes 27 of 119 on v1.1 (the passing ones are the honest-email guards and basic shape checks), the concurrency file 2 of 27, the privacy file 3 of 7. The mutation check now breaks thirty things one at a time (the original eleven, ten for the lock, five for the hostile-input hardening, one for the extracted fields, three for privacy) and every one is caught. It also refuses a mutation that changes nothing, so a typo in the script cannot pass as "detected".

## Not verified

Being explicit about what I did **not** see:

- A real timeout of the AI call, and a real outage of Google Sheets or Gmail. These are simulated only.
- Concurrency on the **final** v1.2 build. The lock was observed on real services at the build that introduced it (executions #108 and #109); the lock nodes have not changed since, but the later changes were not re-run under concurrency.
- The Gmail Trigger in production against a real, busy mailbox. The load test with 100 real emails (T15) ran on v1.0 and was not repeated on v1.1 or v1.2; the real executions cited here are single emails. The HTML-to-text step in `Normalizar correo` runs only on Gmail emails, so its hardening (hidden text, bounded parsing) is verified by the simulation and not on real Gmail messages.
- How n8n Cloud behaves when the manual trigger `Reintentar fallidos` is pressed from the interface by a person (I ran it through the API).
- The behaviour of the free tier of the model provider with real data. It should not be used with real customer data.
- Anything about the quality of the model's answers beyond the cases in [test-cases.md](test-cases.md). Five or six repeats per case show a trend, not a guarantee.

## Second round (v1.2)

Findings of the follow-up review. Same labels as above (Live, Sim, Static, Deduced).

| ID | Severity | Finding | Status |
|---|---|---|---|
| B-01 | Medium | Duplicate drafts under simultaneous runs (A-10), reproduced on the real services | Fixed, Live and Sim |
| B-02 | Medium | Personal data kept in n8n execution data, in the error log and in the claim log | Mitigated; instance-level items for the owner |
| B-03 | High | Prompt injection and unsafe model output: hidden text, look-alike letters, invented figures, unsafe recipients | Hardened, Live (one case) and Sim (119 cases); not eliminated |
| B-04 | Medium | Extracted fields (`customer_name`, `company`, `requested_service`, `quantity`, `missing_information`) were validated but never stored | Fixed, Live |
| B-05 | Low | Test coverage for errors, recovery, concurrency and hostile input was thin | Fixed (158 new tests) |
| B-06 | Low | The disconnected Gemini node (A-14) | Removed |
| B-07 | Low | Invisible characters in the deployed code | Found and fixed while deploying; a test now guards it |

### B-01 Duplicate drafts under concurrency (Medium, fixed)

**Problem.** A-10 had been deduced and simulated. In this round it was reproduced for real: two simultaneous executions over the same request, started within a second of each other, each ended with two Gmail drafts (executions #104 to #107; the Gmail drafts carry the same subject and were created within a second of each other). The sheet stayed at one row, as designed.

**Fix.** A claim lock built from existing node types, no external service.

1. Before the duplicate lookup, each run appends a *claim* (`request_id`, a unique `claim_id`, event `claim`, time) to a shared tab, `bloqueos`.
2. It then reads the whole tab. The winner is the **first active claim in sheet order** for that request. A claim is active if it has not been released and is younger than 10 minutes.
3. The winner continues (duplicate lookup, model, sheet row, draft). The loser stops before the model call, so it costs nothing, and releases its own claim.
4. Every way out of an email (draft created, no draft needed, duplicate ignored, lost the claim) appends a `release` event before the loop moves on.

Design points that matter: the log is **append-only** (no row is edited, so there is no read-then-write race); the append uses `useAppend` (a single Sheets call; the default append of the node reads first and writes after, which is racy); the order of rows is decided by Sheets, not by clocks; if a run cannot see its own claim it **stops with an error** instead of guessing; claim and release writes are retried three times.

**Evidence.** *Live:* executions **#108 and #109**, the same setup that gave two drafts before, ended with **one draft**; the second run skipped the model call, and the `bloqueos` tab shows two claims and two releases for the request. *Sim:* `tests/concurrency.test.js` interleaves two executions at every step boundary (27 tests, including crashes, expiry, overlapping batches and retries); 25 of them fail on the v1.1 export. The mutation check breaks ten parts of the lock and every break is caught.

**Residual, documented in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).** (1) If a run crashes while holding a claim, the same email is blocked for up to 10 minutes; retrying the failed execution releases it earlier. (2) Resuming an *old* crashed execution after another run has taken over its expired claim can create a second draft (test C12 states this). (3) Each email now costs about six Sheets calls (three reads, three writes), which matters for the per-minute quota of a free Google project. (4) The `bloqueos` tab grows by two rows per email and should be archived from time to time.

### B-02 Privacy of data at rest (Medium, mitigated)

**What was reviewed.** Where an email's content can end up: n8n execution data, the `errores` tab, the new `bloqueos` tab, error messages, Code-node console output, the prompt and the draft.

**Applied in the workflows (both of them).**
- Successful runs store **no execution data** (`saveDataSuccessExecution: none`). Manual runs are not stored. No partial progress is saved.
- Failed runs **are** stored (`saveDataErrorExecution: all`). That is a deliberate trade-off: a failed run is the only case where someone needs the data to diagnose it or to retry it from the failed node, and failures are rare. It means the original email of a *failed* run is kept until the instance prunes executions.
- The error log (`errores` tab) masks e-mail addresses in the error message and caps it at 300 characters; it never contains email fields.
- The claim log holds identifiers and times only. No Code node writes to the console.

**Evidence.** *Live:* execution #114 (a production run of the published workflow) is not stored: n8n answers "not found" when asked for it, while the sheet row and the draft exist. *Static and Sim:* `tests/privacy.test.js` (7 tests; four fail on the v1.1 export) and three mutations.

**Not applied, because it needs access to the n8n instance or a plan this one does not have.** See the list in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md): retention and pruning of stored executions, who can open or reveal executions, n8n's execution-data redaction (documented by n8n as an Enterprise feature; no setting for it is exposed by the interface used for this review), and the `availableInMCP` flag. Executions stored *before* this change still hold fictional test data and were not deleted.

### B-03 Prompt injection and unsafe output (High, hardened)

**Method.** I wrote an adversarial suite first (119 cases), ran it against v1.1, and only then changed the code. On v1.1, 92 of the 119 fail. The suite has two halves: hostile emails that must be flagged, cleaned or neutralised, and honest emails that must **not** be flagged (a guard against solving the problem by flagging everything).

**What changed.**
- *Input cleaning* (`Preparar petición IA`): invisible and direction-control characters, the Unicode "tag" block and zero-width joiners inside words are removed; look-alike letters (full-width, mathematical, enclosed) are normalised; unusual spaces become plain spaces; the sender must be one clean address, otherwise there is no recipient and no draft. Mixed-alphabet words raise a flag.
- *HTML* (`Normalizar correo`): comments, scripts, styles and elements hidden with CSS are dropped, and a hostile HTML document cannot make the parser run away (single pass, work budget).
- *Validation* (`Validar respuesta IA`): the text is searched for orders aimed at the AI in more phrasings and in Spanish and English, on a copy where look-alike letters are flattened. The model's draft is checked for figures that are not in the email, confirmations and promises on behalf of the company, payment talk, internal details, links, markup and length. **If any risk is found, the draft is replaced by a fixed template written in the code** (no figures, links or promises) and a person writes the real answer. Priority is set by the code when the email gives orders. Extracted fields are cleaned before they are stored.
- Human review of every draft stays. The workflow still has no node that can send.

**Evidence.** *Live:* execution **#110**, a fictional email with "ignore the previous instructions…", a fake 90% discount, an order confirmation and a request to forward the customer history: the model proposed priority `alta`; the code set `media`; the model's own draft was replaced by the safe template; the flags name the patterns found; one draft was created, nothing was sent. Execution **#111**, an honest email, kept the model's draft and raised only "incomplete information". *Sim:* the 119 adversarial cases, 7 privacy cases, 27 concurrency cases and the mutation check.

**Residual.** These are text rules. They reduce risk; they do not remove it. Spaced-out or leet-speak orders, orders in other languages, and a persuasive but harmless-looking request can pass. That is why the draft is never sent by the workflow and why the replacement template exists. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

### B-04 Extracted fields were not stored (Low, fixed)

The model extracts five fields and the validator checks them, but the sheet had no columns for them, so the data was thrown away after validation and the documentation said so. The `solicitudes` tab now has `customer_name`, `company`, `requested_service`, `quantity` and `missing_information` (joined with ` | `). *Live:* executions #110, #111, #113 and #114. An integrity test fails if an extracted field has no column, and a mutation removes one.

### B-05 Test coverage (Low, fixed)

158 tests were added (27 concurrency, 119 adversarial, 7 privacy, 5 integrity), listed with their purpose in [tests/README.md](../tests/README.md). Real and simulated evidence are separated in [TEST_REPORT.md](TEST_REPORT.md).

### B-06 Gemini node removed (Low, fixed)

Removed from the workflow and the export. The integrity test now requires that every node is reachable from a trigger. Switching provider remains a one-node change.

### B-07 Invisible characters in deployed code (Low, found while deploying)

When the hardened Code nodes were deployed, the transport layer turned the `\uXXXX` escapes written inside regular expressions into the real characters, some of them invisible and two of them line separators. I found it because I compared every Code node of the live workflow with the repository, node by node, and two differed. Nothing ran in that state (it was a draft). The fix writes those characters in the `\u{XXXX}` form with the `u` flag, which survives, and `tests/workflow-integrity.test.js` now fails if any Code node contains an invisible, control or line-separator character. The check was verified to catch the faulty version. After the fix the comparison with the live workflow shows zero differences.

