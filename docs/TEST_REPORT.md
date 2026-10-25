# LeadFlow AI test report

What was tested, how, with what result, and what was **not** tested. Version under test: **v1.2** (the second review round; v1.1 results are kept where they still apply). Test data is fictional throughout. No email was sent at any point.

The report separates two kinds of evidence, and they should not be merged:

- **Real runs:** executions on the n8n Cloud instance with the real Google Sheets, Gmail drafts and Groq API.
- **Simulated runs:** the automated suite, which executes the exported workflow graph and the real Code-node source on an in-memory simulation of n8n and the three services. See [tests/README.md](../tests/README.md) for what is real and what is assumed. It is not an end-to-end test.

## Result at a glance

| Check | Result |
|---|---|
| `npm test` (242 tests: 18 integrity, 38 Code-node, 28 scenario, 4 load, 27 concurrency, 119 adversarial, 8 privacy) | 242 passed, 0 failed, about 4 seconds |
| `npm run mutation-check` (31 deliberate breaks) | 31 of 31 caught |
| `npm run lint` (ESLint 10.1.0 on the tests, the config and the 6 extracted Code nodes, 20 files) | 0 errors, 0 warnings. The rule `no-misleading-character-class` is switched off for the Code nodes on purpose: the sanitiser lists invisible and combining characters to strip them |
| markdownlint (structure rules, line length and similar style rules off) | Clean after removing blank lines at the end of one file |
| GitHub Actions (`.github/workflows/ci.yml`) on the pull request, commit `8a465df` | Tests and lint on Node 20 and Node 22, and the mutation check: all three jobs succeeded. This is the same simulated suite on a clean machine, not a test of the real services |
| Same suite against the v1.1 export | 111 passed, 131 failed (the new files fail there by design, see [AUDIT.md](AUDIT.md)) |
| Real executions on v1.2 | #110 to #115, #118, #119 and #120 (below), all as expected |
| Real executions of the lock | #108 and #109 at the build that introduced it, and #118 and #119 on the final published build (one draft where two runs used to give two) |
| Scenarios that exist **only** as simulation | Sheets outage, Gmail draft failure, AI timeout, crash while holding a claim, claim expiry, huge email, 100-email batch, every adversarial case except the one in #110 |
| Not run | Repeat of the 100-real-email test, a real timeout, a real Sheets or Gmail outage, the Gmail Trigger on a busy production mailbox (one batch of three emails was run, #120) |

## How to run

```
node --version        # 20 or later
npm test
npm run mutation-check
LEADFLOW_DIR=/path/to/other/export npm test      # run the suite against another export
```

## The 20 required scenarios

For each scenario: the automated test that covers it (simulated) and the real evidence, if any. "None" means it has **not** been observed on the real services.

| # | Scenario | Automated test (simulated) | Real evidence | Result |
|---|---|---|---|---|
| 1 | Valid commercial email | S01 | #100, #103; T01 | Pass |
| 2 | Quote request with missing information | S02 | #103 (status `incompleta`); T01 | Pass |
| 3 | Information query | S03 | T06, T07 | Pass (human review is mandatory) |
| 4 | Order | S04 | T02 | Pass |
| 5 | Urgent complaint | S05 | T03 | Pass |
| 6 | No subject | S06, unit tests | None | Pass (simulated) |
| 7 | No body, and HTML-only body | S07, unit tests | None | Pass (simulated) |
| 8 | Malformed fields | S08, unit tests | None | Pass (simulated) |
| 9 | Invalid model response | S09 | T14 (produced in the editor, not by the model) | Pass |
| 10 | Incomplete JSON from the model | S10, unit tests | None | Pass (simulated) |
| 11 | AI API error | S11 | T11 (real 429, v1.0); #101 (provoked 404, v1.1) | Pass |
| 12 | AI timeout | S12 | None. The 30 s timeout is configured and checked by the integrity test, but no real timeout was provoked | Pass (simulated) |
| 13 | Duplicate email | S13 | T09 | Pass |
| 14 | Two simultaneous executions | S14, `concurrency.test.js` (C01 to C17) | #104 to #107: two drafts each (before the lock); #108 and #109: one draft (with the lock); #118 and #119: one draft on the final published build | Pass (v1.2). Residual cases in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) |
| 15 | Google Sheets failure | S15, S15b | None | Pass (simulated): execution stops, error logged, no draft, lookups retried 3 times |
| 16 | Gmail draft failure | S16 | None | Pass (simulated): row exists, error logged, a retry creates the draft without duplicating |
| 17 | Malicious instructions in the email | S17, S17b, `adversarial.test.js` (119 cases) | T04, T16, #110 | Pass. Prompt injection is mitigated, not eliminated |
| 18 | Unnecessary personal data | S18, S23, `privacy.test.js` | #100 (card, ES IBAN, DNI), #103 (GB and NL IBAN, DNI with hyphen), #114 (ES IBAN, published version), T08 | Pass |
| 19 | Recovery after an error | S19a, S19b, S19c, C14 to C17 | T12; #101 then #102; #112 then #113 | Pass |
| 20 | Re-execution of a completed process | S20, L2 | #99 (retry entry with nothing to retry) | Pass |

Additional scenarios beyond the twenty: S21 (very large email), S22 (formula injection), S23 (the test form path is sanitised too), S24 (the workflow has no way to send email), the load scenarios L1 to L3 below, and the three new files described next.

## What the three new test files cover (all simulated)

Run on the in-memory engine; nothing here proves the real services behave the same way. The assumptions of the engine are listed in [tests/README.md](../tests/README.md).

| File | Tests | What it checks |
|---|---|---|
| `concurrency.test.js` | 27 | Two executions of the same email interleaved at **every** step boundary: always one draft, one row, one model call. The worst moment (both claim before either reads). Overlapping batches in opposite order. Different emails never block each other. A crash while holding the claim blocks the email for 10 minutes and no longer. A claim that cannot be seen stops the run with an error. Every way out releases the claim. Recovery by retry. C12 documents a known limitation instead of hiding it. |
| `adversarial.test.js` | 119 | A01 to A40: orders aimed at the AI in Spanish and English (override, fake system messages, role change, prompt requests, data exfiltration, encoded text). B01 to B14: **honest** emails that must not be flagged. C01 to C10: evasion with invisible, direction-control, look-alike and full-width characters. D01 to D36: risks in the model's draft (prices, promises, invented figures, links, payment talk, internal details). E01 to E07: invalid model answers. F01 to F03: recipient and header tricks. G01 to G05: hidden HTML. H01 to H04: whole batches with a model that obeys every order. |
| `privacy.test.js` | 8 | Workflow retention settings, no console output, bounded and masked error log, card/IBAN/ID never reach the model, sheet, draft or logs, the sender's address never reaches the model while the draft is still addressed to it, the claim log holds identifiers only. |

Before/after on the same tests: against the v1.1 export the adversarial file passes 27 of 119, the concurrency file 2 of 27 and the privacy file 3 of 8. The mutation check (31 breaks) shows the tests notice when a protection is removed.

## Load: the 100-email test

**The original test (T15) is documented but was not reproducible.** It was real (100 emails in the test mailbox, executions #85 to #94, all rows and drafts present), but the emails were produced interactively and no script was kept. That is why it is listed as history and not as a repeatable test.

**What is reproducible now.** `tests/fixtures/load.js` generates the same 100 fictional emails every time (seeded random numbers; 35 quote requests, 30 orders, 15 information queries, 10 complaints, plus 10 odd cases with hidden instructions, advance payment and similar). `tests/load.test.js` runs them on the simulation:

| Test | What it asserts | Result |
|---|---|---|
| Generator | Exactly 100 emails with the documented mix, unique ids, same output on every call, only fictional addresses | Pass |
| L1 | One batch of 100: 100 rows, 100 drafts, 100 model calls, no duplicates, nothing sent, nothing logged as an error, categories as expected, complaints high priority, the 5 hidden-order emails flagged for review | Pass |
| L2 | The same 100 again: no new rows, no new drafts, no new model calls | Pass |
| L3 | 7 emails hit a persistent AI outage inside the batch: the other 93 complete; the 7 are stored as `error_ia` with the reason; after the outage `Reintentar fallidos` completes only those 7 without duplicating rows and the other 93 are never analysed twice | Pass |

The simulated categories come from a stand-in model that answers with the expected category, so L1 does **not** measure how well the real model classifies. It checks that the workflow handles 100 items correctly: no loss, no duplicates, correct routing. Classification quality is documented in [test-cases.md](test-cases.md) (T15: 35/35, 30/30, 15/15 and 10/10 by the category each email was written for).

**To repeat the real test on v1.1.** Use a test mailbox that is not yours for anything else, run `npm run load-emails`, send the 100 emails from another test account, wait about ten minutes, and compare the sheet with the output. It was not done in this review because it means sending real emails, which was out of bounds for the review; it is on the list of things to run by hand.

## Real executions on v1.1

All on the live n8n Cloud workflow, manual execution, fictional data, no email sent. A Gmail **draft** is created when the gate allows it. Drafts and test rows were left in place and can be deleted.

| Execution | What was done | Observed |
|---|---|---|
| #99 | `Reintentar fallidos` with no rows to retry | Success; the read returned nothing and nothing changed |
| #100 | Form entry with a subject starting with `=` and a body with a DNI, an IBAN and a card number | Subject stored as text; DNI, IBAN and card shown as `[documento oculto]`, `[IBAN oculto]`, `[número oculto]`; payment and ID flags raised; one draft |
| #101 | Same entry, with the AI endpoint deliberately wrong in the draft version (never published; restored and verified by comparing every node against the repository: 0 differences) | The model call failed; the row was saved with status `error_ia` and the reason in `validation_flags`; no draft; execution status success |
| #102 | `Reintentar fallidos` after restoring the endpoint | The `error_ia` row was reprocessed in place, no new row; a draft created |
| #103 | Form entry with a GB IBAN, an NL IBAN and a DNI with a hyphen, after widening the masking patterns | All three masked in the sheet; status `incompleta` because the model asked for more details; one draft |

## Real executions on v1.2

Fictional data. The workflow sent no email, and nothing went to a customer; for #120 the only emails sent were three test emails from the test mailbox to itself. Executions #104 to #113 are manual runs of the draft version that was then published (the draft was compared node by node with the repository before and after: zero differences). Execution #114 is a production run of the published version. Execution #115 is a manual run of the draft that removed the sender address from the model-bound text, published afterwards (the draft was compared node by node with the repository: zero differences). Executions #118 and #119 were run at the end of the final review round on the published version (workflow version `72c9ea6c`, identical to this repository); the test row and the claim log were cleared afterwards. Gmail drafts and test rows were left in place and can be deleted.

| Execution | What was done | Observed |
|---|---|---|
| #104 / #105 | Two simultaneous executions over the same request, **before** the lock (build with the v1.1 flow) | Two drafts with the same subject, created about a second apart; one sheet row |
| #106 / #107 | Same setup, second request | Two drafts again |
| #108 / #109 | Same setup, **with the lock** | One draft; the second run skipped the model call; the `bloqueos` tab shows two claims and two releases |
| #110 | Form entry with "ignore the previous instructions", a fake 90% discount, an order confirmation and a request to forward the customer list | The model proposed priority `alta` and a normal reply; the code set `media`, replaced the draft with the safe template, and flagged four patterns; the five new columns were stored; one draft; claim released |
| #111 | An honest quote request | The model's draft was kept; only "incomplete information" was flagged; one draft |
| #112 | Same kind of entry with the AI endpoint deliberately wrong in the draft (never published; restored and verified: zero differences) | The call failed after its retries; row saved as `error_ia` with the reason; **no draft**; the claim was released; execution status success |
| #113 | `Reintentar fallidos` after restoring the endpoint | The `error_ia` row was reprocessed in place (no new row); one draft; claim released |
| #114 | **Production** run of the published workflow (form entry with the standard example IBAN) | IBAN stored as `[IBAN oculto]` and flagged; the five new columns filled; one draft; the execution is **not stored** (n8n answers "not found"), as configured |
| #115 | Form entry (fictional name, address and a quote request) after the sender address was removed from the model-bound text | Row complete with the five customer fields; one draft addressed to the form's address, greeting by name; read through the sheet and Gmail only (manual runs are not stored either) |
| #118 / #119 | **Final published build.** A fictional row in status `error_ia` retried by two simultaneous manual runs of `Reintentar fallidos`, so both rebuilt the same `request_id`. Read through the sheet and Gmail only (manual runs are not stored) | One draft and one row (updated in place to `incompleta`). The `bloqueos` tab showed two claims 3 ms apart and two releases: the second run released about two seconds after claiming, well before the first finished (draft created about four seconds after the claims, release about five seconds after). Whether the second run skipped the model call cannot be read back, because manual runs leave no data; one draft and the early release are what was observed |
| #120 | **Gmail Trigger, final published build.** Three fictional emails sent from the test mailbox to itself: a complete quote request, a vague question and an email that gives orders to the AI. Read through the inbox, the claim log, the sheet and Gmail (successful runs are not stored). Record: [real-run-2026-10-25.md](real-run-2026-10-25.md) | The trigger took the three emails in one batch at its next poll, one claim and one release each, about 5 to 6 seconds per email. Three rows (all `incompleta`), three drafts, none sent, no duplicates, no error rows. The quote request got a draft asking for the missing data and quoting no price or date; the vague question got a draft asking for details; the hostile email kept priority `baja` although it demanded a high one, was flagged for human review with four manipulation patterns named, and its draft was replaced by the safe template. One run and three emails: an observation, not a measurement |

Executions #110 to #113 were read with their full data before the privacy settings were applied; after that, successful runs leave no data to read, which is why #114 and #115 are verified through the sheet and Gmail only.

Earlier real tests T01 to T16 (v1.0 and early v1.1 work) are in [test-cases.md](test-cases.md).

## Problems found while testing, and what was done

1. **A test that could not fail.** The tag break-out test (S17b) passed on v1.0 because its pattern was exactly the one v1.0 stripped. The pattern was made lenient so it fails on v1.0 and passes on v1.1. That is why the report includes a baseline against v1.0: a test is only worth something if it fails when the thing it guards is broken.
2. **A real IBAN pattern gap.** A hostile-input check showed that GB and NL IBANs (letters in the bank code) and DNI numbers written with a hyphen were not masked by the first pattern. The patterns were widened, covered with tests, published and confirmed in execution #103.
3. **A wrong assumption about the shape of API errors.** The first reader of failed AI calls looked for the error text in the wrong place. It was rebuilt from the shape n8n really produces on a failed call, captured from a real execution, and the unit test uses that captured shape instead of an invented one.
4. **A test that must not pass for the wrong reason.** The formula-injection test (S22) contains a control that runs the same input with the unsafe cell format and checks that the test notices it.
Second round:

5. **The lock was reproduced before it was built.** The duplicate-draft race (A-10) was first reproduced on the real services (#104 to #107), so the fix could be judged against a failure that had actually been seen.
6. **A mutation that changed nothing.** While adding mutations it turned out that a typo can make a mutation a no-op and still look "detected". The script now refuses a mutation that does not change the workflow.
7. **Over-broad rules.** Several first versions of the injection patterns flagged honest emails (for example Spanish "dan", "a partir de ahora", "soy el director", an invoice to forward). The honest-email guards (B01 to B14) caught them; the patterns were narrowed.
8. **Escapes altered in transit.** Deploying the hardened Code nodes turned `\uXXXX` escapes into raw invisible characters. The node-by-node comparison with the repository found it before anything ran; the code now uses `\u{XXXX}` and an integrity test forbids raw invisible characters in Code nodes (AUDIT B-07).
9. **A slow parser.** The adversarial test for hidden HTML elements took 4.4 seconds because skipping nested hidden elements was quadratic; it now has a work budget.

## Not tested, and why

- **A real AI timeout, Sheets outage or Gmail outage.** They cannot be provoked safely on a shared service; they are simulated only. The behaviour they exercise (continue on error, retries, error workflow) is real n8n configuration, but it has not been observed firing for these causes.
- **A crash while holding a claim, and the expiry of a claim.** Simulated only. Concurrency itself was observed on the real services at the build that introduced the lock (#108 and #109) and again on the final published build (#118 and #119).
- **The 100-email load test on the final build.** Prepared, not run: `npm run load-emails` prints the 100 fictional emails (fixed seed) and the scripted version runs on the simulation. A real run leaves 100 drafts and 100 rows in the test mailbox and sheet and uses about 600 Sheets calls and 100 model calls on free tiers, so it should be run deliberately, in a throwaway mailbox with the sender filter set. Afterwards count rows, drafts and duplicates.
- **Execution-data redaction, retention and access control of n8n.** These are instance settings. The workflow-level retention settings were applied and verified (#114); the rest is on the owner list in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- **Hostile HTML in real Gmail messages.** The hidden-text handling is verified in the simulation. The three real emails of #120 were plain text.
- **The Gmail Trigger with a continuous stream of emails.** The trigger was exercised once, on the final published build, with three fictional emails in one batch (#120, [real-run-2026-10-25.md](real-run-2026-10-25.md)). Earlier real runs started from the test form and from the manual retry entry. Larger batches, mail arriving over hours or days, and a real mailbox were not exercised.
- **Pressing `Reintentar fallidos` by hand in the n8n editor.** It was executed through the API.
- **Real customer data, and any production mailbox.** Out of scope; see the known limitations.
- **Model quality at scale.** Five or six repeats per case are a trend, not a measurement. No time or money savings were measured and none is claimed.

## Limits of this report

The tests found problems; they cannot prove there are none. The validation rules are regular expressions that cover the cases that were anticipated. Human review of every draft is part of the design for that reason.
