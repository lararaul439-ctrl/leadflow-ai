# Setup guide

Back to the [README](../README.md).

The workflows were exported from n8n Cloud 2.44.6. The JSON files contain no credentials, sheet IDs or email addresses: you fill in your own. [.env.example](../.env.example) is a checklist of the values you need to have ready; the project does not read environment variables.

**Prerequisites:** an n8n instance (Cloud or self-hosted), a **test** Gmail account, a Google account for Sheets, and an API key for an OpenAI-compatible model provider (Groq's free tier works for fictional data).

1. **A test Gmail account.** Do not use your personal email.
2. **A Google Sheets document** with three tabs. The first one must be `solicitudes`:
   - `solicitudes`, with these headers in row 1: `request_id`, `received_at`, `sender_name`, `sender_email`, `subject`, `body`, `category`, `priority`, `summary`, `status`, `human_review_required`, `validation_flags`, `customer_name`, `company`, `requested_service`, `quantity`, `missing_information`
   - `errores`, with the headers: `fecha`, `flujo`, `nodo`, `mensaje`, `url_ejecucion`
   - `bloqueos` (the claim log), with the headers: `request_id`, `claim_id`, `event`, `at`. The workflow only appends to it; archive old rows from time to time.
3. **Credentials in n8n:**
   - Gmail (OAuth with the test account).
   - Google Sheets (OAuth with the same account).
   - A `Header Auth` credential for the AI API, with header name `Authorization` and value `Bearer <your key>`.
4. **Import the two workflows** from the `workflows/` folder (Workflows → Import from file), first `leadflow-errores.json` and then `leadflow-ai.json`.
5. **Fill in what the JSON files leave blank:**

   | In the JSON | What to do |
   |---|---|
   | `CONFIGURAR_CREDENCIAL` | Open each node that uses a credential (Gmail Trigger, Create a draft, the six Google Sheets nodes of the main workflow and the AI API node) and choose your own credential. |
   | `TU_ID_DE_HOJA` | In the Google Sheets nodes, choose your document and the tab: `solicitudes` (`Buscar duplicado`, `Append or update row in sheet`, `Leer filas con error`) and `bloqueos` (`Crear reserva`, `Leer reservas`, `Liberar reserva`) in the main workflow, and `errores` in the error workflow. Re-select the tab in every one of them, even where a tab name is already shown. |
   | `TU_CORREO_DE_PRUEBAS@ejemplo.com` | In the Gmail Trigger, the sender filter: the address of the test account. |
   | `ID_DEL_FLUJO_DE_ERRORES` | In the settings of the main workflow, choose `LeadFlow AI - Errores` as the error workflow. |

6. **Check the AI node.** The workflow uses `Analizar con IA (Groq)`. To use another provider, change only that node; the response reader understands both the OpenAI-compatible and the Gemini response shapes.
7. **Review the privacy settings** in the settings of both workflows. The export saves no data for successful or manual runs and keeps failed runs. Retention and who can open executions are settings of your n8n instance (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
8. **Publish** both workflows.
9. Send a test email to the test account and wait a minute. A row should appear in `solicitudes` and a draft in Gmail, and nothing is sent.

**Retrying failed emails.** If the AI provider was down, some rows will have status `error_ia`. When it is back, open the main workflow and run the `Reintentar fallidos` trigger manually. It reprocesses only those rows, in place.

The workflow, node, tab and status names are in Spanish, because the project was built in Spanish. They are kept as they are in the files, so they match what you see in n8n.
