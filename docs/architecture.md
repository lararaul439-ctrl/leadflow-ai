# LeadFlow AI architecture

How the workflow works and why it is built this way. [Versión en español](arquitectura.md).

## Data flow

```mermaid
flowchart TB
    GT["Gmail Trigger<br/>new email in INBOX"] --> NC["Normalize email<br/>fields, HTML to text, hidden text dropped, fallback id"]
    FM["Test form"] --> EF["Edit Fields<br/>id, date, status"]
    RT["Retry failed<br/>manual trigger"] --> RD["Read rows with error<br/>error_ia, error_validacion"]
    RD --> PR["Prepare retry<br/>rebuild the request from the row"]

    NC --> BU
    EF --> BU
    PR --> BU

    BU["Process one at a time<br/>Loop Over Items, batch of 1"] --> PP["Prepare AI request<br/>clean, mask IBAN, card, ID. Size caps. Strip angle brackets"]
    PP --> CL[("Claim lock, tab bloqueos<br/>append claim, read log,<br/>first active claim wins")]
    CL --> WIN{"Won the claim?"}
    WIN -- "no" --> LOST["Stand aside<br/>no AI call, no draft"]
    WIN -- "yes" --> BD["Look up duplicate<br/>by request_id"]
    BD --> DUP{"Already processed?<br/>error rows do not count"}
    DUP -- "yes" --> IG["Duplicate ignored"]
    DUP -- "no" --> IA["Analyze with AI<br/>Groq, schema-enforced JSON<br/>30 s timeout, 3 tries, continue on error"]
    IA --> LR["Read AI response<br/>safe parsing, readable API error"]
    LR --> VR["Validate AI response<br/>code rules, safe template, status, can_draft"]
    VR --> SH[("Google Sheets, solicitudes<br/>plain text, upsert by request_id")]
    SH --> GATE{"Create draft?<br/>can_draft"}
    GATE -- "yes" --> BR["Gmail: create draft<br/>never sent"]
    BR -.-> HUM{{"A person reviews the draft<br/>and decides whether to send it"}}
    LOST --> REL
    IG --> REL
    GATE -- "no" --> REL
    BR --> REL["Release the claim<br/>append release"]
    REL --> BU

    FALLO["Any failure that is not handled in the flow"] -.-> ER["Error workflow<br/>Error Trigger"]
    ER -.-> SE[("Google Sheets, errores")]

    classDef ia fill:#fff1cc,stroke:#c28f00,color:#222
    classDef codigo fill:#dff3e4,stroke:#2e8b57,color:#222
    classDef humano fill:#dbe9ff,stroke:#2f6fd0,color:#222
    class IA ia
    class NC,PP,LR,VR,PR,GATE,WIN,CL,REL,LOST codigo
    class HUM humano
```

Orange: the only step that uses a language model. Green: custom code, which validates and does not depend on the AI. Blue: the human decision.

The node, tab and status names are in Spanish because the project was built in Spanish. The tables below give the name each node has in the workflow, so you can match them with what you see in n8n.

## Step by step

1. **Entry.** Three ways in, all ending in the same loop: the Gmail Trigger (production), a test form (`On form submission`) and the manual `Reintentar fallidos` trigger, which feeds rows that failed before.
2. **Process one at a time.** `Loop Over Items` with batch size 1. Each email goes through the whole chain by itself, so one bad email cannot take the others with it.
3. **Prepare the AI request.** The only place where the email is cleaned. Every entry point and every retry passes through it. It removes control, invisible and direction-control characters, normalises look-alike and full-width letters, caps the length, masks card numbers, IBANs and DNI/NIE numbers, strips `<` and `>` from the model-bound text, checks that the sender is one clean address, and flags anything unusual (empty subject, empty body, invalid sender, cut email, orders aimed at the AI).
4. **Claim the email.** Before anything else touches the sheet or the model, the run appends a *claim* for this `request_id` to the `bloqueos` tab, reads the tab back, and wins only if its claim is the first active one in sheet order (active: not released and less than 10 minutes old). A run that loses stops here: no model call, no draft. A run that cannot find its own claim in the read-back fails with an error instead of carrying on. Every exit of the branch appends a release.
5. **Duplicate check.** The sheet is queried by `request_id` (the Gmail message id). A row that already exists with a normal status ends the branch. A row with a status starting with `error_` does not count as processed, so a failed email can be retried.
6. **Ask the model.** HTTP call to an OpenAI-compatible API (Groq). The answer must be JSON that satisfies a schema. Timeout 30 s, three tries, and on persistent failure the node **continues** with an error item instead of stopping the execution.
7. **Read the answer.** Parses the JSON safely. A non-object or incomplete answer becomes a parse error. A failed API call becomes a readable reason (HTTP code and message, with anything that looks like a key removed, at most 300 characters). The original email fields always win over what the model returns.
8. **Validate.** The rules in code (below) set the status, the flags, the priority where needed, whether human review is mandatory and `can_draft`. If the draft shows any sign of risk, it is replaced by a fixed holding reply.
9. **Write the row.** Google Sheets upsert keyed by `request_id`, stored as plain text so email content cannot become a formula. The row holds the 17 columns, including the customer fields the model extracted.
10. **Gate and draft.** If `can_draft` is true, Gmail receives a draft addressed to the sender. If not, the item goes on. The workflow has no node that sends, replies or forwards.
11. **Release the claim.** Every path (draft created, no draft, duplicate, lost claim) ends in `Liberar reserva`, which appends a release and returns to the loop.

## Components

| Component | Node in the workflow | Function |
|---|---|---|
| Gmail Trigger | `Gmail Trigger` | Polls the inbox every minute. Filters by the `INBOX` label and by sender, so it does not process its own drafts. |
| Normalize email | `Normalizar correo` | Common format (`request_id`, `Nombre`, `Email`, `Asunto`, `Mensaje`). Converts an HTML-only body to text (dropping comments, scripts, styles and CSS-hidden elements, with a work budget), gives a fallback id (`sin-id-<hash>`) when Gmail returns none, and processes every email of a batch. |
| Test form | `On form submission` → `Edit Fields` | Entry for testing without Gmail. Sets id, date and initial status. |
| Retry entry | `Reintentar fallidos` → `Leer filas con error` → `Preparar reintento` | Manual trigger. Reads the rows with status `error_ia` or `error_validacion` and rebuilds the request from the stored (already sanitised) fields. |
| Process one at a time | `Procesar de uno en uno` | `Loop Over Items`, batch size 1. |
| Prepare AI request | `Preparar petición IA` | Sanitising and prompt text (see step 3). |
| Claim lock | `Preparar reserva` → `Crear reserva` → `Leer reservas` → `Decidir reserva` → `¿Gana la reserva?` / `Reserva perdida` | Append-only claim log in the `bloqueos` tab (see step 4). A lost claim ends at `Reserva perdida`. `Crear reserva` and `Leer reservas` retry 3 times. |
| Release claim | `Liberar reserva` | Appends the release event; every exit of the branch goes through it. |
| Look up duplicate | `Buscar duplicado` | Sheet lookup by `request_id`. `Always Output Data` is on so the flow continues when there is no match. |
| Duplicate? | `¿Duplicado?` / `Duplicado ignorado` | Boolean test: the row exists and its status does not start with `error_`. |
| Analyze with AI | `Analizar con IA (Groq)` | HTTP call with timeout, retries and continue-on-error. |
| Read AI response | `Leer respuesta IA` | Safe parsing; understands the OpenAI-compatible shape and the Gemini one, so the provider can be swapped by editing only the call node. |
| Validate AI response | `Validar respuesta IA` | Shape checks plus the business rules and the safe template. |
| Append or update row | `Append or update row in sheet` | Upsert by `request_id`, plain text, 17 columns. |
| Draft gate | `¿Crear borrador?` | Passes only when `can_draft` is true. |
| Create draft | `Create a draft` | Gmail draft. Never sent. |
| Error workflow | `LeadFlow AI - Errores` | Separate workflow with `Error Trigger`. Logs the workflow, the node, the message (e-mail addresses masked, at most 300 characters) and the execution link in the `errores` tab (plain text as well). |

## Design decisions

**The AI proposes, the code decides.** The model returns a category, a priority, a summary and a draft. The rules that protect the business are in code and do not depend on what the model says:

- A complaint (`reclamacion`) is always high priority and requires review.
- Information queries always require review, because the model cannot be trusted to know what the company offers.
- A draft that mentions prices, discounts, warranties, deadlines, opening hours or availability is flagged. A draft that claims the company offers something ("Yes, we offer…") is flagged, but "a colleague will confirm whether we offer…" is not, because it claims nothing.
- A draft that contains a link or an email address is flagged.
- A draft that contains a figure that does not appear in the email, a promise or confirmation, payment talk or internal details is flagged.
- When any of those flags fires, the draft is **replaced** by a fixed holding reply written in the code, and the row says so in `validation_flags`.
- If the email gives orders to the AI, it is flagged as a possible manipulation and the **code** sets the priority from the category, so "promise delivery tomorrow" cannot raise it.
- Payment data and ID numbers are masked before anything else sees them, and the email is flagged.
- An empty draft, or no valid recipient, means no draft is created.

**The email is data, not instructions.** It goes inside a `<correo>` block, every `<` and `>` is removed from it so nothing can close the block or open another, and the system prompt says explicitly that the content must not be obeyed. Before the rules run, invisible characters are removed and look-alike letters are normalised, so spacing tricks and homoglyphs do not hide an order. This reduces prompt injection; it does not eliminate it, which is why the code rules above exist.

**Data minimisation.** IBANs, card numbers and DNI/NIE numbers are masked before they reach the model, the sheet or the draft. The sender address is kept because the draft needs it.

**Nothing is sent automatically.** The workflow only creates drafts. A test fails if any Gmail node can send, reply or forward.

**A failure should not lose an email.** The AI step cannot stop a batch: after three tries the email is saved with status `error_ia` and the reason, and the loop goes on. Those rows can be retried with `Reintentar fallidos`. An invalid model answer is saved as `error_validacion`. Failures of Google Sheets or Gmail stop the execution, are logged by the error workflow and are retried from the n8n interface.

**Repeating a run should change nothing.** The claim and the duplicate lookup come first, and the write is an upsert. Running the same email twice, even at the same moment, leaves one row, one draft and one model call.

**Why an append-only claim log.** Google Sheets has no atomic "create if absent". Two runs that both read before either writes would both see "free". So each run first *appends* a claim, then reads the whole log, and the first active claim in row order wins; appends are totally ordered by the sheet, so both runs agree on the winner. The cost is about six Sheets calls per email and a tab that grows (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)). The claim tab holds only identifiers and times, never email content.

**Data kept by n8n itself.** Successful and manual runs store no execution data, and the progress of a run is not saved, so the content of an email does not sit in n8n's execution history. Failed runs are kept on purpose, to be diagnosed and retried. No node writes to the console, and the error log masks e-mail addresses and caps the message. Retention, who can open executions and execution-data redaction are instance settings, listed in the limitations.

**Spreadsheet cells are plain text.** Both Sheets writes use the `RAW` cell format. With the default format a subject starting with `=` is stored as a formula.

**The provider can be swapped.** Only the call node has to change (the reader of the answer accepts both response shapes). The project started on Gemini and moved to Groq when the free daily quota ran out.

## Request statuses

| Status | Meaning | Draft created |
|---|---|---|
| `pendiente_revision` | The AI found nothing missing. A person reviews anyway. | Yes |
| `incompleta` | Details are missing that the customer can provide, or the input had a problem. | Yes, asking for them |
| `error_validacion` | The AI answer did not pass validation. The reason is in `validation_flags`. | No |
| `error_ia` | The AI call failed after its retries. The reason is in `validation_flags`. | No |

The status says what happened to the request. To decide what a person should look at first, use `human_review_required` and `validation_flags`.

## What happens when something fails

| Failure | What the workflow does | How to recover |
|---|---|---|
| The AI API fails or times out | 3 tries, then the row is saved as `error_ia` with the reason. The batch continues. | Run `Reintentar fallidos`. |
| The AI returns something invalid | Row saved as `error_validacion` with the reason. No draft. | Run `Reintentar fallidos`, or handle it by hand. |
| Google Sheets fails | The lookup is retried 3 times; a failed write stops the execution. The error workflow logs it. | Retry the execution in n8n. |
| Gmail fails to create the draft | The row already exists; the execution stops and is logged. | Retry the execution: the row is updated, not duplicated, and the draft is created. |
| The same email arrives twice | Ignored at the duplicate check. | Nothing to do. |
| Two runs process the same email at once | The claim lock lets one run through: one row, one draft. The other stops before calling the model. | Nothing to do. |
| A run crashes while holding the claim | The email is blocked for up to 10 minutes, then the claim expires. | Retry the failed execution (it releases the claim) or wait. Do not resume an old execution after another run has taken over (known limitation C12). |
| The claim log cannot be read back, or the run's own claim is missing | The run fails with an error instead of continuing without protection. | Retry the execution. |

More in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). How each part was checked is in [TEST_REPORT.md](TEST_REPORT.md) and [AUDIT.md](AUDIT.md).
