# Known limitations

What LeadFlow AI does **not** do, or does not do reliably, as of v1.1. Each item says what it affects and what to do about it. Findings that were fixed are in [AUDIT.md](AUDIT.md); this file is about what remains.

## Intended scope

- **It is a decision-support tool, not an autopilot.** It drafts and logs; a person reads every draft and decides whether to send it. There is no send node by design.
- **It was built and tested with a test mailbox, a test sheet and fictional data.** It has not been used with a real company mailbox or real customers.
- **One language and one kind of business.** The prompt, the validation rules and the categories (`presupuesto`, `pedido`, `informacion`, `reclamacion`, `otra`) are in Spanish and fit a small merchandise business. Another language or domain means rewriting the prompt and the regular expressions.
- **The sheet does not store `customer_name` or `company`.** The model extracts them, but they are not columns yet.

## Reliability

| Limitation | Effect | What to do |
|---|---|---|
| **Two simultaneous executions of the same email** create one row and two drafts. | A person finds a duplicate draft. No data is lost. | Do not execute the workflow manually while it is published. Delete the extra draft. Closing this needs a lock shared between executions; it was left out on purpose (see AUDIT A-10). |
| **Retry is manual.** `Reintentar fallidos` runs when someone presses it. | A failed email waits in the sheet with status `error_ia` or `error_validacion` until then. | Look at the sheet filtered by status, or schedule the retry trigger once you are confident (not done, to avoid retry storms against a provider that is down). |
| **Failures of Google Sheets or Gmail stop the execution.** | The rest of that batch waits until the execution is retried. | Retry the execution from the n8n interface; the upsert prevents duplicate rows. |
| **The AI timeout and the Sheets and Gmail outage paths are simulated, not observed.** | The configuration is real; the behaviour in a real outage has not been seen. | Treat them as designed, not proven. |
| **The error tab does not say which email failed** when the failing node is Sheets or Gmail. | The execution link is the only pointer. | Open the link from the `errores` row. |
| **Polling every minute.** The Gmail Trigger is not instant. | Up to about a minute of delay, plus the processing time (5 to 6 seconds per email in the tests). | Acceptable for this use. |
| **Free-tier limits of the AI provider.** | Daily and per-minute caps. This stopped the workflow once during development. | Use a paid plan with a data-processing agreement for anything real, or change provider by editing one node. |

## Security and data

| Limitation | Effect | What to do |
|---|---|---|
| **Prompt injection is mitigated, not solved.** | A crafted email can still influence the model's summary or the wording of a draft. | The layers around the model are what protect you: priority set by code, flags for links, discounts and promises, mandatory review for risky categories, drafts only. Read every draft. |
| **Masking is pattern matching.** It covers card numbers, IBANs and DNI/NIE. | Names, phone numbers, postal addresses and personal details written as plain text are not removed. An unusual number format can slip through. | Do not feed it data you would not be allowed to send to the model provider. A real deployment needs a data-protection review. |
| **Execution history contains the original email.** | The Gmail Trigger node's output, in n8n's execution data, has the unmasked message. | Set a short retention for executions and limit who can open them (AUDIT A-16). |
| **The sender filter is a test setting.** | In the export it is a placeholder that matches one address. | Replace it with rules suited to the real mailbox before any real use. |
| **The free tiers of AI APIs may use submitted data to improve their models.** | Customer data would leave your control. | Fictional data only on a free tier. |
| **The workflow is flagged as available to n8n's MCP integration** in its settings (`availableInMCP`). | Not a risk by itself in a private instance; worth knowing. | Turn it off in the workflow settings if you do not use it. |

## AI quality

- **The validation rules are regular expressions.** They cover the cases that were tested, not every possible one. The code blocks explicit claims such as "Yes, we offer…" but not implicit ones ("thank you for your interest in our custom T-shirts"). That is why every information query requires human review.
- **In emails with hidden orders, the summary sometimes repeats what the order asked for**, even when it flags it as suspicious. The priority is not affected because the code sets it.
- **Classification is only as good as the model.** The tests show it classifies the test emails as expected; they do not measure accuracy on real mail. Three of the ten odd emails of the load test (a web-services offer, a job application, a fair invitation) were classified as `informacion` when `otra` could be argued.
- **Repeats are small samples.** Five or six runs per case show a trend, not a guarantee. The model does not answer the same way twice.
- **No measurement of savings.** No time or money savings were measured, and none is claimed.

## Testing

- **The automated suite runs on a simulation**, not on n8n, Gmail, Sheets or Groq. Its assumptions are listed in [tests/README.md](../tests/README.md).
- **The 100-email load test on real services was run on v1.0** and not repeated on v1.1. The scripted version is simulated (see [TEST_REPORT.md](TEST_REPORT.md)).
- **The workflows were exported from n8n Cloud 2.44.6.** Import into other versions may need small adjustments; nodes may show warnings after import.
- **The n8n Cloud trial is time-limited.** The exported JSON files in this repository are the durable copy of the project.

## Not planned in v1.1

Things a production version would need and this one does not have: authentication of who reads the sheet, a data-retention process, a dashboard for the failed rows, metrics, a second language, attachments handling, multi-mailbox support, a lock for concurrent runs, alerting beyond the `errores` tab.
