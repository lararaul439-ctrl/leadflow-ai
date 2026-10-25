# Case study: LeadFlow AI

A portfolio project: AI-assisted triage of incoming sales emails, with a person approving every reply. Built with n8n, Gmail, Google Sheets and an LLM on Groq. Tested on a simulation and on the real services with fictional data.

[Demo video](media/leadflow-ai-real-run-2026-10-25.mp4) · [Repository README](../README.md) · [Known limitations](KNOWN_LIMITATIONS.md)

## The problem

A small sales team receives quote requests, questions and orders by email. Someone has to read each one, decide how urgent it is, note who the customer is and what they want, and write a reply. That takes time, and it is easy to lose a request.

An AI can help with the reading and the first draft. The risk is letting it answer on its own: a model can promise a price, a date or a discount that nobody approved, and an email can contain text written to steer the model.

## What was built

An n8n workflow of 25 nodes:

1. **Gmail Trigger** picks up new emails (polling every minute).
2. **Clean-up:** fields are normalised, HTML is turned into text, hidden text is dropped, bank account and ID numbers are masked.
3. **Claim lock:** each email is claimed in a log before it is processed, so two overlapping runs cannot create two drafts.
4. **Duplicate check** against the requests already logged.
5. **LLM call** (Groq, `openai/gpt-oss-120b`): proposes category, priority, customer data, missing information and a reply.
6. **Validation in code:** JavaScript rules check every field, set the priority and the human-review flag, and replace the reply with a fixed holding message when the email tries to give orders to the AI.
7. **Google Sheets:** one row per request (an upsert, so a retry updates the row instead of adding one).
8. **Gmail draft** for a person to read. There is no send node anywhere.

A second workflow logs failures with email addresses masked, and a manual entry retries requests whose AI call failed.

## Results that can be checked

| What | Evidence |
|---|---|
| 242 automated tests pass; 31 of 31 deliberate breaks are caught | [TEST_REPORT.md](TEST_REPORT.md), CI on GitHub Actions (Node 20 and 22) |
| Real run through the Gmail Trigger: 3 emails, 3 rows, 3 drafts, none sent, no duplicates, no errors | [real-run-2026-10-25.md](real-run-2026-10-25.md) and the [demo video](media/leadflow-ai-real-run-2026-10-25.mp4) |
| An email with instructions aimed at the AI kept a low priority, was flagged for review and got the fixed reply | Same run, case C |
| The duplicate-draft race was reproduced before the lock (two drafts) and fixed with it (one draft), also on the final build | [TEST_REPORT.md](TEST_REPORT.md), executions #104 to #109, #118 and #119 |
| 100 fictional emails in a row on an earlier version: 100 rows, 100 drafts, no duplicates, nothing sent | [TEST_REPORT.md](TEST_REPORT.md) |

No time or money savings have been measured, and none is claimed.

## What it is not

- A reference implementation, tested with fictional data on a test mailbox. It has not run on a company mailbox or with real customer data.
- The injection detection is a list of patterns; a new phrasing could pass. Human review of every draft is part of the design for that reason.
- Not certified for production or for GDPR. Using it with real data needs a data-processing agreement with the model provider and instance settings that only the owner can apply.

## Skills shown

Workflow automation with n8n · LLM integration and prompt design · Gmail and Google Sheets integrations · validation rules in JavaScript · defensive handling of untrusted input · testing on a simulation, mutation testing and CI · documenting limits honestly.

The author came to automation from telephone sales and customer service, which is the process this project supports.
