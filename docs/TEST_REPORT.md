# LeadFlow AI test report

What was tested, how, with what result, and what was **not** tested. Version under test: **v1.1**. Test data is fictional throughout. No email was sent at any point.

The report separates two kinds of evidence, and I ask the reader not to merge them:

- **Real runs:** executions on the n8n Cloud instance with the real Google Sheets, Gmail drafts and Groq API.
- **Simulated runs:** the automated suite, which executes the exported workflow graph and the real Code-node source on an in-memory simulation of n8n and the three services. See [tests/README.md](../tests/README.md) for what is real and what is assumed. It is not an end-to-end test.

## Result at a glance

| Check | Result |
|---|---|
| `npm test` (83 tests: 13 integrity, 38 Code-node, 28 scenario, 4 load) | 83 passed, 0 failed, under 1 second |
| `npm run mutation-check` (11 deliberate breaks) | 11 of 11 caught |
| Same suite against the v1.0 export | 36 passed, 47 failed (see [AUDIT.md](AUDIT.md)) |
| Real executions on v1.1 | #99 to #103 (below), all as expected |
| Scenarios that exist **only** as simulation | Sheets outage, Gmail draft failure, AI timeout, simultaneous runs, huge email, 100-email batch |
| Not run | Repeat of the 100-real-email test on v1.1, a real timeout, a real Sheets or Gmail outage, the Gmail Trigger in production on v1.1 |

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
| 14 | Two simultaneous executions | S14 | T09 saw duplicated rows on v1.0 before the upsert was introduced | **Known limitation**: one row, two drafts |
| 15 | Google Sheets failure | S15, S15b | None | Pass (simulated): execution stops, error logged, no draft, lookups retried 3 times |
| 16 | Gmail draft failure | S16 | None | Pass (simulated): row exists, error logged, a retry creates the draft without duplicating |
| 17 | Malicious instructions in the email | S17, S17b | T04, T16 | Pass. Prompt injection is mitigated, not eliminated |
| 18 | Unnecessary personal data | S18, S23 | #100 (card, ES IBAN, DNI), #103 (GB and NL IBAN, DNI with hyphen), T08 | Pass |
| 19 | Recovery after an error | S19a, S19b, S19c | T12; #101 then #102 | Pass |
| 20 | Re-execution of a completed process | S20, L2 | #99 (retry entry with nothing to retry) | Pass |

Additional scenarios beyond the twenty: S21 (very large email), S22 (formula injection), S23 (the test form path is sanitised too), S24 (the workflow has no way to send email), and the load scenarios L1 to L3 below.

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

**To repeat the real test on v1.1.** Use a test mailbox that is not yours for anything else, run `npm run load-emails`, send the 100 emails from another test account, wait about ten minutes, and compare the sheet with the output. I did not do this in this review because it means sending real emails, which was out of bounds for the review; it is on the list of things to run by hand.

## Real executions on v1.1

All on the live n8n Cloud workflow, manual execution, fictional data, no email sent. A Gmail **draft** is created when the gate allows it. Drafts and test rows were left in place and can be deleted.

| Execution | What was done | Observed |
|---|---|---|
| #99 | `Reintentar fallidos` with no rows to retry | Success; the read returned nothing and nothing changed |
| #100 | Form entry with a subject starting with `=` and a body with a DNI, an IBAN and a card number | Subject stored as text; DNI, IBAN and card shown as `[documento oculto]`, `[IBAN oculto]`, `[número oculto]`; payment and ID flags raised; one draft |
| #101 | Same entry, with the AI endpoint deliberately wrong in the draft version (never published; restored and verified by comparing every node against the repository: 0 differences) | The model call failed; the row was saved with status `error_ia` and the reason in `validation_flags`; no draft; execution status success |
| #102 | `Reintentar fallidos` after restoring the endpoint | The `error_ia` row was reprocessed in place, no new row; a draft created |
| #103 | Form entry with a GB IBAN, an NL IBAN and a DNI with a hyphen, after widening the masking patterns | All three masked in the sheet; status `incompleta` because the model asked for more details; one draft |

Earlier real tests T01 to T16 (v1.0 and early v1.1 work) are in [test-cases.md](test-cases.md).

## Problems found while testing, and what I did

1. **A test that could not fail.** The tag break-out test (S17b) passed on v1.0 because its pattern was exactly the one v1.0 stripped. I made the pattern lenient so it fails on v1.0 and passes on v1.1. That is why the report includes a baseline against v1.0: a test is only worth something if it fails when the thing it guards is broken.
2. **A real IBAN pattern gap.** A hostile-input check showed that GB and NL IBANs (letters in the bank code) and DNI numbers written with a hyphen were not masked by my first pattern. I widened the patterns, covered them with tests, published the change and confirmed it in execution #103.
3. **A wrong assumption about the shape of API errors.** My first reader of failed AI calls looked for the error text in the wrong place. I rebuilt it from the shape n8n really produces on a failed call, captured from a real execution, and the unit test uses that captured shape instead of an invented one.
4. **A test that must not pass for the wrong reason.** The formula-injection test (S22) contains a control that runs the same input with the unsafe cell format and checks that the test notices it.

## Not tested, and why

- **A real AI timeout, Sheets outage or Gmail outage.** They cannot be provoked safely on a shared service; they are simulated only. The behaviour they exercise (continue on error, retries, error workflow) is real n8n configuration, but I have not seen it fire for these causes.
- **Concurrency in n8n Cloud.** Simulated and deduced (AUDIT A-10).
- **The Gmail Trigger on v1.1 with a real stream of emails.** The v1.1 real runs started from the test form and from the manual retry entry. The Gmail path shares every node after the trigger and normalisation, but I did not send emails to exercise the trigger itself.
- **Pressing `Reintentar fallidos` by hand in the n8n editor.** I executed it through the API.
- **Real customer data, and any production mailbox.** Out of scope; see the known limitations.
- **Model quality at scale.** Five or six repeats per case are a trend, not a measurement. No time or money savings were measured and none is claimed.

## Limits of this report

The tests found problems; they cannot prove there are none. The validation rules are regular expressions that cover the cases I thought of. Human review of every draft is part of the design for that reason.
