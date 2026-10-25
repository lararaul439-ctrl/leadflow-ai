# Readiness review

An honest assessment of LeadFlow AI v1.2 as if a senior engineer had to decide two things: whether to accept it as a technical reference implementation, and whether to let a company try it on a mailbox. It lists what holds up, what does not, and what blocks real mail. It is a review of this repository and of what was observed on the test instance; it is not a certification.

**Verdict.** As a reference implementation and technical showcase: yes. Its strength is the evidence: a concrete design, failures found and fixed, and a clear line between simulated and real results. As a pilot on a company mailbox: **not yet**. The blockers are listed in the last section and most of them are about data protection and operations, not about the workflow logic.

## Assessment by area

| Area | State | Evidence | What is missing |
|---|---|---|---|
| Security | Good for the threat it targets | Nothing in the workflow can send e-mail (a test enforces it). The e-mail is treated as untrusted data; priority is set by code; risky drafts are replaced by a fixed reply; 119 adversarial tests, including honest e-mails that must not be flagged. | Detection is pattern matching, so a new phrasing can pass. Prompt injection is mitigated, not solved. Nobody other than its author has attacked it. |
| Privacy | Reasonable for fictional data, not enough for real data | Cards, IBANs and ID numbers are masked before the model, the sheet and the draft. The sender's address is not sent to the model. Successful and manual runs store no execution data. The error log masks addresses. | Names, phone numbers and free text still go to the AI provider. Failed runs keep the original e-mail in n8n. Retention, access to executions and execution-data redaction are instance settings that were not applied. No data-protection assessment, provider agreement or retention policy exists. Nothing here is a claim of GDPR compliance. |
| Reliability and recovery | Good design, partly proven | Retries and a timeout on the model call; a failed AI call is saved with its reason and retried by a manual entry; writes are upserts; a claim lock gave one draft where two runs used to give two (observed live at the build that introduced it and again on the final build). | The lock depends on Google Sheets ordering and has known edge cases (a crash blocks one e-mail for up to 10 minutes; resuming an old execution after a takeover can duplicate). Retry is manual. A Sheets or Gmail outage stops the run. |
| Test quality | Strong for its kind | 242 tests, a mutation check that breaks 31 things one at a time, concurrency interleaved at every step, the workflow's own Code-node source under test. The suite fails 131 tests against the previous export, so it detects what was fixed. | It runs on a simulation. No test touches real Gmail, Sheets or the model. Real executions are a small, hand-run set. No coverage percentage was measured. The 100-real-e-mail load test was done on v1.0 and not repeated. |
| Maintainability | Acceptable | Small, commented Code nodes; the logic is tested outside n8n; no dependencies; ESLint is clean. | The logic lives inside JSON exports, which are awkward to diff and easy to damage when pasted through some tools (this happened once, see AUDIT B-07). Large regular-expression lists will need care. The mutation script patches code text, so it is brittle. |
| Installation | Manual but documented | Import two files, create three tabs, choose credentials, fill placeholders; `.env.example` lists what to have ready. | Nothing is automated. Tab selection must be repeated in seven Google Sheets nodes (six in the main workflow, one in the error workflow). The setup was not timed or tried by someone else. |
| Documentation | Detailed and kept consistent | English and Spanish READMEs, architecture, test report, audit, limitations; numbers checked against the last run. | A lot of text to keep in step. The README images are renderings drawn from a real run and from the workflow file; real screenshots and a recording are still missing. |
| Secrets | Clean as far as checked | Credentials live in n8n; exports contain placeholders; a test looks for secrets and real IDs; the whole history (7 commits) was searched for key patterns and for this project's real identifiers: nothing found. | No dedicated secret scanner was available in the review environment, so the search was by pattern. Anyone who exports a workflow from n8n must not commit that file. |
| Observability | Basic | `solicitudes` holds status, review flag and the reason of each failure; `errores` logs failures that stop a run with a link to the execution. | No alerting, metrics or dashboard. Because successful runs store nothing, diagnosis depends on the sheet. The error row does not say which e-mail failed when Sheets or Gmail is the failing node. |
| External-service limits | Known, not solved | Documented: free-tier model quota (it stopped the project once), Google Sheets quota (about six calls per e-mail with the lock), Gmail polling once a minute, the n8n Cloud trial. | A real volume would need paid plans and a better store for the lock than a spreadsheet. |

## What still blocks use with real e-mail

1. **Data protection.** A model provider under an agreement that fits the data, a legal basis, a retention policy and an assessment by someone qualified. Free tiers may use submitted data.
2. **n8n instance settings.** Pruning, who can open executions, and redaction. Until then a failed run keeps a raw e-mail.
3. **Concurrency at scale.** The lock is a spreadsheet log. Fine for a small mailbox; for volume use a store with atomic operations.
4. **A trial on a mailbox with non-sensitive mail**, with a person reading every draft and counting the false alarms of the safe-template rule.
5. **Alerting** on failed executions and on rows in `error_ia`.
6. **Real-service tests** of the final build: the 100-e-mail load run, a real outage, the Gmail Trigger path.

## Recommended next steps, in order

1. Run the real 100-e-mail load test on the final build, in a throwaway mailbox (`npm run load-emails` prints the e-mails). A real concurrency run on the final build has already been done (executions #118 and #119).
2. Move the lock and the log to a store with atomic operations; archive the claim log automatically.
3. Add alerting for failures and for rows waiting in `error_ia`.
4. Evaluate classification quality on a labelled set of e-mails instead of repeats.
5. Add real screenshots and a short recording of a run (the README currently shows renderings).
