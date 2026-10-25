# Known limitations

What LeadFlow AI does **not** do, or does not do reliably, as of v1.2. Each item says what it affects and what to do about it. Findings that were fixed are in [AUDIT.md](AUDIT.md); this file is about what remains.

## Intended scope

- **It is a decision-support tool, not an autopilot.** It drafts and logs; a person reads every draft and decides whether to send it. There is no send node by design.
- **It was built and tested with a test mailbox, a test sheet and fictional data.** It has not been used with a real company mailbox or real customers.
- **One language and one kind of business.** The prompt, the validation rules and the categories (`presupuesto`, `pedido`, `informacion`, `reclamacion`, `otra`) are in Spanish and fit a small merchandise business. Another language or domain means rewriting the prompt and the regular expressions.

## Reliability

| Limitation | Effect | What to do |
|---|---|---|
| **The duplicate-draft lock has edge cases.** Two simultaneous runs of the same email now give one draft (claim lock, AUDIT B-01), but: a run that **crashes while holding the claim** blocks that email for up to 10 minutes, and resuming the old crashed execution **after** another run has taken over its expired claim can still create a second draft (test C12 states it). | A delayed email, or in the rare crash case a duplicate draft. No data is lost. | Retry the failed execution from the n8n interface (it releases the claim). Do not resume a failed execution of an email that has already been processed since. |
| **Each email costs about six Google Sheets calls** (three reads, three writes) because of the lock. | A free Google Cloud project has a per-minute quota; a large batch can hit it, and the workflow then stops with an error that is retried and logged. | For bulk use, raise the quota or keep batches modest. The load test with 100 real emails predates the lock and was not repeated. |
| **The `bloqueos` tab grows** by two rows per email and is never cleaned by the workflow. | Slower reads over time (the lock reads the whole tab). | Archive or clear old rows from time to time. Rows older than 10 minutes never block anything. |
| **Retry is manual.** `Reintentar fallidos` runs when someone presses it. | A failed email waits in the sheet with status `error_ia` or `error_validacion` until then. | Look at the sheet filtered by status, or schedule the retry trigger once you are confident (not done, to avoid retry storms against a provider that is down). |
| **Failures of Google Sheets or Gmail stop the execution.** | The rest of that batch waits until the execution is retried. | Retry the execution from the n8n interface; the upsert prevents duplicate rows. |
| **The AI timeout and the Sheets and Gmail outage paths are simulated, not observed.** | The configuration is real; the behaviour in a real outage has not been seen. | Treat them as designed, not proven. |
| **The error tab does not say which email failed** when the failing node is Sheets or Gmail. | The execution link is the only pointer. | Open the link from the `errores` row. |
| **Polling every minute.** The Gmail Trigger is not instant. | Up to about a minute of delay, plus the processing time (5 to 6 seconds per email in the tests). | Acceptable for this use. |
| **Free-tier limits of the AI provider.** | Daily and per-minute caps. This stopped the workflow once during development. | Use a paid plan with a data-processing agreement for anything real, or change provider by editing one node. |

## Security and data

| Limitation | Effect | What to do |
|---|---|---|
| **Prompt injection is mitigated, not solved.** | A crafted email can still influence the model's summary or the wording of a draft. The detection is regular expressions: orders written with spaces between letters or in leet-speak, in other languages, or phrased as a polite request can pass; hidden text in HTML is dropped only for the cases the parser knows. | The layers around the model are what protect you: priority set by code, a draft that shows any risk is replaced by a fixed template, flags for links, figures that are not in the email, promises and payment talk, mandatory review for risky categories, drafts only. Read every draft. |
| **What the AI provider receives.** The sender's name, the subject and the message (with cards, IBANs and ID numbers masked). The sender's e-mail address is not sent. | Names, phone numbers, postal addresses and anything else written in the message reach the provider. This is processing of personal data by a third party. | Use a plan with a data-processing agreement for anything real, and have the data-protection review done before using real mail. Nothing here is a claim of GDPR compliance. |
| **Masking is pattern matching.** It covers card numbers, IBANs and DNI/NIE. | Names, phone numbers, postal addresses and personal details written as plain text are not removed. An unusual number format can slip through. | Do not feed it data you would not be allowed to send to the model provider. A real deployment needs a data-protection review. |
| **Failed runs keep the original email.** Successful and manual runs are not stored (v1.2), but failed runs are, on purpose, so that they can be diagnosed and retried. The Gmail Trigger output in that stored data has the unmasked message. | The email of a failed run stays in n8n until the instance prunes executions. | Keep the failure rate low, and set the instance retention (below). If you would rather give up retrying from the n8n interface, set `saveDataErrorExecution` to `none` in both workflows; the retry entry `Reintentar fallidos` works from the sheet and does not need stored executions. |
| **Executions stored before v1.2 were not deleted.** | They contain the fictional test emails of the review. | Delete them from the executions list if you want a clean instance. |
| **The sender filter is a test setting.** | In the export it is a placeholder that matches one address. | Replace it with rules suited to the real mailbox before any real use. |
| **The free tiers of AI APIs may use submitted data to improve their models.** | Customer data would leave your control. | Fictional data only on a free tier. |
| **The workflow is flagged as available to n8n's MCP integration** in its settings (`availableInMCP`). | Not a risk by itself in a private instance; worth knowing. It could not be changed from the interface used in the review. | Turn it off in the workflow settings if you do not use it. |
| **The claim log (`bloqueos`) and the error log (`errores`) are plain tabs in the same spreadsheet.** | Anyone who can read the spreadsheet can read them. They hold identifiers, times and bounded error messages with e-mail addresses masked, never email content. | Share the spreadsheet only with the people who work on the requests. |

## AI quality

- **The validation rules are regular expressions.** They cover the cases that were tested, not every possible one. The code blocks explicit claims such as "Yes, we offer…" but not implicit ones ("thank you for your interest in our custom T-shirts"). That is why every information query requires human review.
- **A draft can be replaced by the safe template without a real problem.** Any risk sign (a figure that is not in the email, a link, a promise) swaps the model's draft for a fixed, polite holding reply and a person writes the real one. That is the intended trade: some good drafts are lost to avoid sending a bad one. The honest-email tests (B01 to B14) keep the false alarms down but cannot make them zero.
- **In emails with hidden orders, the summary sometimes repeats what the order asked for**, even when it flags it as suspicious. The priority is not affected because the code sets it. The summary and the extracted fields are cleaned and flagged for links, not rewritten.
- **The extracted fields are the model's reading of the email.** They are stored as given (after cleaning). `requested_service` in particular is free text and is sometimes a generic word.
- **Classification is only as good as the model.** The tests show it classifies the test emails as expected; they do not measure accuracy on real mail. Three of the ten odd emails of the load test (a web-services offer, a job application, a fair invitation) were classified as `informacion` when `otra` could be argued.
- **Repeats are small samples.** Five or six runs per case show a trend, not a guarantee. The model does not answer the same way twice.
- **No measurement of savings.** No time or money savings were measured, and none is claimed.

## Testing

- **The automated suite runs on a simulation**, not on n8n, Gmail, Sheets or Groq. Its assumptions are listed in [tests/README.md](../tests/README.md). That includes all the concurrency and adversarial tests; only the cases listed as "Real executions" in [TEST_REPORT.md](TEST_REPORT.md) were observed on the real services.
- **The 100-email load test on real services was run on v1.0** and not repeated on v1.1 or v1.2. The scripted version is simulated.
- **Concurrency was observed for real at the build that introduced the lock** (executions #108 and #109) and not again on the final build; the lock code is unchanged since.
- **The Gmail Trigger path was not exercised with real incoming mail in v1.2**, because that would mean sending emails to the test mailbox. Everything after `Normalizar correo` was exercised from the test form, and the HTML handling in that node is verified by the simulation only.
- **The workflows were exported from n8n Cloud 2.44.6.** Import into other versions may need small adjustments; nodes may show warnings after import.
- **The n8n Cloud trial is time-limited.** The exported JSON files in this repository are the durable copy of the project.

## Settings that need access to the n8n instance (not applied)

These could not be applied from the interface used for the review, or need a plan this instance may not have. They are the actions left for the owner:

| Setting | Why it matters | Where |
|---|---|---|
| **Execution retention (pruning)**: how many days and how many executions n8n keeps | It decides how long the email of a *failed* run stays stored | Instance environment settings of n8n (self-hosted) or the plan limits (Cloud) |
| **Who can open and reveal executions** | Anyone who can open an execution can read the email in it | Project roles and user management |
| **Execution-data redaction** (per workflow or enforced for the instance) | Would hide the content of stored executions from people without the reveal permission. n8n documents it as an Enterprise feature; I did not verify that it is available on this instance | Workflow menu, Settings; instance Settings, Security |
| **`availableInMCP`** | Whether the workflow can be reached through n8n's MCP integration | Workflow settings |

## Not planned in v1.2

Things a production version would need and this one does not have: authentication of who reads the sheet, an automatic data-retention process, a dashboard for the failed rows, metrics, a second language, attachments handling, multi-mailbox support, archiving of the claim log, alerting beyond the `errores` tab.
