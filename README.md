# LeadFlow AI

[![CI](https://github.com/lararaul439-ctrl/leadflow-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/lararaul439-ctrl/leadflow-ai/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [Español](README.es.md)

LeadFlow AI is a human-in-the-loop workflow for n8n that turns incoming customer emails into classified, logged requests with a draft reply waiting for approval. It reads each email, classifies it with a language model, logs it in Google Sheets and leaves a draft in Gmail. **It never sends an email on its own.**

Built with n8n, Gmail, Google Sheets and a language-model API. The business rules live in code rather than in the prompt, and the project comes with an automated test suite and two documented technical reviews.

> **Status:** a tested reference implementation. All data in this repository and in the tests is fictional, and nothing has been used with real customers. See [Status and limitations](#status-and-limitations).

## The problem

Companies receive sales emails that someone has to read, classify, log and answer by hand. It is repetitive work where opportunities get lost. LeadFlow AI automates reading, classifying and logging, and prepares a reply, but leaves the decision to send it to a person.

## Who it is for

- Sales and customer-service teams that receive requests by email and want faster triage without giving up control of what is sent.
- Teams evaluating how to put a language model into a business process safely: the repository shows the design, the tests and the limits.
- Developers and automation specialists who want a worked example of validation, concurrency control and testing in n8n.

## What it does

1. Detects new emails in Gmail (or takes a request from a test form, or a failed one to retry).
2. Cleans the email: removes control, invisible and look-alike characters, hidden HTML text, caps its size, masks card numbers, IBANs and ID numbers, and flags anything unusual.
3. Claims the email in a shared log, so that two runs that start at the same moment cannot both create a draft.
4. Checks whether that email is already logged.
5. Asks a language model for a JSON with category, priority, customer details, missing information, a summary and a draft reply.
6. Validates the answer with code rules that do not depend on the AI. If the draft shows any sign of risk (a figure that is not in the email, a promise, a link, payment talk), it is replaced by a fixed, polite holding reply.
7. Saves the request in Google Sheets (as plain text, one row per email) with its status, the extracted customer fields, whether it needs human review and the validation flags.
8. Creates a draft in Gmail, only when the result is valid and has a recipient.
9. If the AI step fails, saves the email with the reason and keeps going; a manual entry retries those rows.

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

Orange is the only step that uses the language model. Green is custom code. Blue is the human decision. Design decisions, node by node: [docs/architecture.md](docs/architecture.md).

## In action

### Example run

A fictional email arrives with payment data in it:

> **Subject:** PRUEBA enmascarado IBAN (datos ficticios)
> **Body:** Hola, quiero un presupuesto de 50 tazas. Para la factura: IBAN GB29 NWBK 6016 1331 9268 19, otro IBAN NL91 ABNA 0417 1643 00 y mi DNI 12345678-Z. Gracias.

This is the row that ended up in the sheet (a real execution, #103 on v1.1, with fictional data; texts are in Spanish because the workflow is; since v1.2 the row also carries the extracted customer fields):

| Column | Value |
|---|---|
| `body` | Hola, quiero un presupuesto de 50 tazas. Para la factura: IBAN **[IBAN oculto]**, otro IBAN **[IBAN oculto]** y mi DNI **[documento oculto]**. Gracias. |
| `category` / `priority` | `presupuesto` / `media` |
| `status` | `incompleta` (the model asked for delivery address and contact details) |
| `human_review_required` | `sí` |
| `validation_flags` | El correo contiene datos de pago o credenciales \| El correo contiene un documento de identidad (ocultado) \| Información incompleta |

The numbers never reached the model or the sheet, and a Gmail **draft** asking for the missing details was created for a person to read. Nothing was sent.

### Illustrations

The four images below are **renderings, not screenshots**. They were drawn from the data of a real run on the test instance (fictitious emails, nothing sent) and from the exported workflow file, and each one says so in its footer. Real screenshots and a screen recording are not included yet.

**One email in, one logged request out.** The IBAN and the ID number are masked before the model and before the sheet.

![An email with an IBAN and an ID number on the left, and the row written to the solicitudes tab on the right, where both numbers appear as masked tags](docs/img/inbox-to-sheet.png)

**Drafts only.** The workflow prepares a reply; a person decides whether to send it.

![Two Gmail drafts marked as not sent: a model-written reply asking for missing details, and a fixed holding reply](docs/img/draft.png)

**A hostile email is treated as data.** The code flags it, fixes the priority, forces human review and swaps the draft for a fixed reply.

![An email that tells the AI to ignore its instructions, and the row written for it with manipulation flags and human review set to yes](docs/img/prompt-injection.png)

**The workflow**, drawn from `workflows/leadflow-ai.json`.

![The 25 nodes of the workflow: three entry points, the claim lock, the AI call, validation, the sheet row and the Gmail draft](docs/img/workflow-canvas.png)

## Safeguards

| Risk | How it is handled |
|---|---|
| The email tries to give orders to the AI | The email is treated as untrusted data: it goes inside a tag, all angle brackets are stripped so it cannot close the tag, and the instructions forbid obeying it. The code also detects typical phrases in Spanish and English, flags the email for review and sets the priority itself, so "promise delivery tomorrow" cannot raise it. Prompt injection is mitigated, not eliminated; 119 adversarial tests cover it. |
| The text hides its orders | Invisible and direction-control characters are removed, look-alike and full-width letters are normalised before the rules run, and text hidden in HTML (comments, scripts, styles, CSS-hidden elements) is dropped and flagged. |
| The AI invents information | Rules in the prompt and rules in code that flag prices, discounts, warranties, deadlines, opening hours, availability, "Yes, we offer…" claims, promises and confirmations, payment talk, internal details, links and addresses, and **any figure that does not appear in the email**. If any of them fires, the draft is replaced by a fixed holding reply written in the code. |
| The recipient is tampered with | The sender must be a single clean address; otherwise there is no recipient and no draft. |
| Something is sent by mistake | The workflow only creates drafts. There is no send node, and a test fails if one appears. |
| Payment and ID data in an email | Card numbers, IBANs and DNI/NIE numbers are masked before the model, the sheet or the draft see them, on every entry point, and the email is flagged. Other personal data is not removed. |
| A spreadsheet formula in an email | Both Sheets writes store plain text, so a subject starting with `=` is not evaluated. |
| An enormous email | Subject, body, name, address and summary are capped; a cut email is flagged. |
| Invalid AI response | The schema is validated. An invalid answer is saved with status `error_validacion` and the reason, and no draft is created. |
| The AI API is down | 30 s timeout, three tries, then the email is saved as `error_ia` with the reason and the rest of the batch continues. `Reintentar fallidos` retries those rows without duplicating them. |
| The same email arrives twice | The email ID is looked up before analysis and the write is an upsert. |
| Two runs process the same email at the same moment | A claim lock in a shared tab: the first active claim in sheet order wins, the other run stands aside before calling the model, and every exit releases its claim. Tested for real (one draft where two used to appear) and with 27 simulated concurrency tests. |
| Keys and credentials | Stored in n8n credentials, not in the nodes. The exported workflows only carry placeholders, and a test scans them for secrets. |
| Personal data sent to the AI provider | Only the sender's name, the subject and the cleaned message are sent. The sender's e-mail address is not (the draft is addressed from the flow's own field), and card numbers, IBANs and ID numbers are masked first. Names, phone numbers and anything written in the message body still go to the provider, so a real deployment needs a data-processing agreement. |
| Personal data in n8n's own records | Successful and manual runs store no execution data; the error log masks e-mail addresses and caps the message; no node writes to the console. Failed runs are kept on purpose (to diagnose and retry them). Retention and access to executions are instance settings. |
| Personal data in the tests | Tests use only fictional data and a test Gmail account with a sender filter. |

What is still open (retries are manual, masking and injection detection are pattern matching, a few lock edge cases, and the n8n instance settings only the owner can change) is in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md). The review rounds that found and fixed the rest are in [docs/AUDIT.md](docs/AUDIT.md).

## Tests and results

### Running the tests

```
npm test                  # 242 tests, about 4 seconds, nothing to install (Node.js 20+)
npm run mutation-check    # breaks the workflow 31 ways (a few minutes); every break must be caught
npm run lint              # static analysis of the tests and of the Code nodes (downloads ESLint on the fly; no dependency is added)
npm run load-emails       # prints the 100 fictional load-test emails
```

The tests run the exported workflow and the real Code-node source on a **simulation** of n8n, Groq, Sheets and Gmail. They are not end-to-end tests against the real services, and the report says which scenarios were also run for real. See [tests/README.md](tests/README.md) and [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

### Results

- **Automated:** 242 tests (18 workflow integrity, 38 on the Code nodes, 28 whole-workflow scenarios, 4 load tests, 27 concurrency, 119 adversarial, 8 privacy). All pass. The same suite fails 131 tests against the v1.1 export, which is how the second review round found what needed fixing. The mutation check breaks 31 things one at a time and every one is caught. ESLint reports no errors or warnings on the tests and on the extracted Code nodes, and a GitHub Actions workflow (`.github/workflows/ci.yml`) runs the tests, the lint and the mutation check on every pull request.
- **Real runs:** 16 manual test cases on the real services (detail in [docs/test-cases.md](docs/test-cases.md), including the failures and their fixes), five real executions of v1.1 for the first audit, and fourteen for v1.2 (#104 to #115, #118 and #119: the duplicate-draft race before and after the lock, and once more on the final published build, a hostile email, an honest email, an AI failure and its retry, and a production run of the published workflow).
- **Load:** 100 fictional emails sent back to back to the real workflow (v1.0): 100 rows and 100 drafts, no duplicates, no draft sent, about 10 minutes. A scripted, repeatable version now runs on the simulation. The real test has not been repeated since the lock was added (the lock costs about six Sheets calls per email, see the limitations).
- **Measurement:** three emails processed in the same batch took between 15 and 17 seconds in total, about 5 or 6 seconds per email. No time or money savings have been measured and none is claimed.

### What is verified, and how

| Level | What it covers |
|---|---|
| **Implemented and covered by automated tests** (simulation) | Cleaning and masking, validation rules and the safe template, statuses and review flags, duplicate lookup, the claim lock, the retry path, error logging, and the absence of any send node. 242 tests and a 31-mutation check run on a simulation of n8n, Groq, Sheets and Gmail, and again in CI on Node 20 and 22. |
| **Verified on the real services** (fictional data, test mailbox) | 16 manual cases, 14 executions of v1.2 and 5 of v1.1: the duplicate-draft race before and after the lock and again on the final build, a hostile email, an honest email, an AI failure and its retry, and a production run. Detail in [docs/TEST_REPORT.md](docs/TEST_REPORT.md). |
| **Simulated only** | Outages of Sheets, Gmail or the AI provider, a real AI timeout, a crash while holding a claim, claim expiry, the 100-email batch, and the HTML handling of real Gmail messages. |
| **Not done yet** | The 100-email load test on the final build (`npm run load-emails` prints the emails), the Gmail Trigger with a real stream of mail, real screenshots and a recording, a measurement of classification quality on labelled data, and any run on a company mailbox or with real customer data. |
| **Needs a person** | A data-processing agreement and data-protection review, the n8n instance settings (retention, access, redaction), the sender filter and credentials, and reading every draft before anything is sent. |

## Status and limitations

LeadFlow AI is a reference implementation. It has been exercised with fictional data on a test mailbox, on a simulation and on the real services, and reviewed in two technical rounds. It has **not** been run on a company mailbox or with real customer data, and it is not ready for that yet. What stands between it and a pilot with real mail:

- **Data protection.** Names, phone numbers and free text still reach the AI provider, so a real deployment needs a data-processing agreement, a legal basis and a retention policy.
- **Instance settings.** Retention and access to stored executions are n8n settings that the owner of the instance has to configure.
- **Scale.** The claim lock is a spreadsheet log, which is fine for a small mailbox; higher volumes need a store with atomic operations.
- **Operations.** Retries are manual and there is no alerting yet.

The full assessment is in [docs/READINESS.md](docs/READINESS.md), the open items in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) and the review rounds in [docs/AUDIT.md](docs/AUDIT.md). The problems found along the way and their fixes are in [docs/engineering-notes.md](docs/engineering-notes.md).

## Getting started

**Prerequisites:** an n8n instance (Cloud or self-hosted), a **test** Gmail account, a Google account for Sheets and an API key for an OpenAI-compatible model provider. Import the two workflows from `workflows/`, create the three tabs in the spreadsheet, choose your credentials and publish. The step-by-step guide, with every placeholder to fill in, is in [docs/SETUP.md](docs/SETUP.md).

## Technology

- **n8n** (Cloud) as the automation engine
- **Gmail** to receive emails and create drafts
- **Google Sheets** as the log
- **A language model API** with schema-enforced JSON output. The project uses Groq with `openai/gpt-oss-120b`. The project started on Gemini and switched when the free daily quota ran out.
- **JavaScript** in the code nodes for sanitising and validation, and the Node.js built-in test runner for the tests

## Documentation

```
README.md, README.es.md     English (default) and Spanish
LICENSE                     MIT license
.env.example                checklist of the values to configure (no secrets, not read by anything)
package.json                scripts for the tests and the lint; no dependencies
eslint.config.js            static-analysis rules (no plugins needed)
.github/workflows/ci.yml    CI: tests, lint and mutation check on every pull request
workflows/
  leadflow-ai.json          main workflow (n8n export, placeholders instead of credentials)
  leadflow-errores.json     error workflow
tests/                      automated tests, fixtures and the mutation check (see tests/README.md)
docs/
  SETUP.md                  step-by-step setup guide (English)
  INSTALACION.md            the same, in Spanish
  architecture.md           architecture and design decisions (English)
  arquitectura.md           the same, in Spanish
  AUDIT.md                  what the review found, fixed and left open
  TEST_REPORT.md            what was tested, real versus simulated
  READINESS.md              senior-style review: what holds up and what blocks real e-mail
  KNOWN_LIMITATIONS.md      what it does not do
  test-cases.md             16 manual test cases on the real services (English)
  casos-de-prueba.md        the same, in Spanish
  engineering-notes.md      problems found while testing and how they were fixed (English)
  notas-de-ingenieria.md    the same, in Spanish
  img/                      renderings used in this README (see img/README.md)
```

## Contact and collaboration

Interested in using or adapting LeadFlow AI, or in working with its author? Get in touch through the GitHub profile: [@lararaul439-ctrl](https://github.com/lararaul439-ctrl). Help with deployment, adaptation and support for teams that want to use it is available on request.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Raul Vicente Lara.
