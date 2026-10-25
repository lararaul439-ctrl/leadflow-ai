# Portfolio descriptions

Ready-to-paste texts about LeadFlow AI for GitHub, LinkedIn and a CV. They only state things this repository can back up: no savings, revenue or customer numbers, because none were measured. English first, Spanish below.

## GitHub

**Repository description** (the "About" box, 350 characters at most):

> AI-assisted email triage built with n8n, Gmail, Google Sheets and an LLM: classifies customer requests, logs them and leaves a draft reply for a person to review. Never sends email on its own. Includes two audit rounds, 241 automated tests and honest limitations.

**Topics:** `n8n` `ai-automation` `workflow-automation` `llm` `gmail` `google-sheets` `prompt-injection` `human-in-the-loop` `testing` `javascript`

**Pinned-repo blurb (one line):** Human-in-the-loop AI email triage on n8n: validated by code, drafts only, tested and audited.

## Short pitch (profile, 2 to 3 sentences)

I built LeadFlow AI, an n8n workflow that reads customer emails, classifies them with a language model, logs them in a spreadsheet and prepares a draft reply for a person to approve. I focused on what usually goes wrong with AI automations, so the rules that protect the business live in code, personal and payment data is masked before it reaches the model, and nothing is ever sent automatically. I then audited and tested it, and documented what it still does not do.

## LinkedIn: project entry

**Title:** LeadFlow AI, human-in-the-loop email triage with n8n

**Description:**

An n8n workflow that turns incoming customer emails into classified, logged requests with a draft reply waiting for human approval. It never sends email on its own.

What I built and checked:
- A pipeline across Gmail, Google Sheets and an LLM API (JSON output enforced by a schema), with the business rules in code ("the AI proposes, the code decides").
- Protections for data and misuse: masking of card numbers, IBANs and ID numbers before the model sees them; size limits; plain-text spreadsheet writes so email content cannot become a formula; detection of instructions aimed at the AI (including hidden and look-alike characters), with the priority set by code; a risky draft is replaced by a fixed holding reply; no execution data kept for successful runs.
- Reliability: retries, a 30-second timeout, failures saved with the reason instead of stopping a batch, a manual entry to retry them, idempotent writes and a claim lock so a repeated or simultaneous email changes nothing.
- A technical audit in two rounds (25 findings, all fixed, mitigated or documented) and 241 automated tests that run the exported workflow on a simulation, plus a mutation check and real-service test cases, with real and simulated results kept apart.

Stack: n8n, Gmail, Google Sheets, Groq (`gpt-oss-120b`), JavaScript, Node.js test runner.

Repository: github.com/lararaul439-ctrl/leadflow-ai

**Skills to tag:** n8n, Workflow Automation, Prompt Engineering, Generative AI, JavaScript, API Integration, Software Testing, Google Workspace.

## CV bullets

Pick two or three. Each one is backed by something in the repository.

- Designed and built an n8n workflow that classifies customer emails with an LLM, logs them in Google Sheets and creates Gmail drafts for human approval; the workflow has no node able to send email, and a test enforces it.
- Moved business rules out of the prompt and into code (priority, review requirements, flags for prices, deadlines and unsupported claims) after tests showed the model followed the same instruction in one run and not in the next.
- Audited the workflow and fixed spreadsheet formula injection, unmasked IBAN and ID numbers, unbounded input size and a failure mode in which an AI outage stopped a whole batch; in a second round reproduced a duplicate-draft race on the real services, closed it with a claim lock and hardened the code against hostile emails; documented what stays open.
- Wrote 241 automated tests (Node.js built-in runner, no dependencies) that run the exported workflow and its real code on a simulation of n8n and the three services, including concurrency and adversarial suites, with a mutation check that confirms the tests catch 30 deliberate regressions.
- Documented real versus simulated test evidence, known limitations and security trade-offs in plain language for reviewers.

## One-line answers

- **What is it?** An AI email triage workflow where a person approves every reply.
- **Why does it matter?** It shows how to use an LLM in a business process without giving it the last word.
- **What did you learn?** An instruction to the model is not a guarantee; important rules belong in code, and tests have to be checked too.

---

# Descripciones para el portfolio (español)

Textos listos para pegar sobre LeadFlow AI en GitHub, LinkedIn y un CV. Solo dicen cosas que este repositorio puede respaldar: ni ahorros, ni ingresos, ni cifras de clientes, porque no se midieron.

## GitHub

**Descripción del repositorio** (el cuadro «About», 350 caracteres como máximo):

> Triaje de correos con IA hecho con n8n, Gmail, Google Sheets y un LLM: clasifica solicitudes de clientes, las registra y deja un borrador de respuesta para que lo revise una persona. No envía correos por sí solo. Incluye dos rondas de auditoría, 241 pruebas automáticas y limitaciones documentadas.

**Una línea para el repositorio fijado:** Triaje de correos con IA y control humano en n8n: validado por código, solo borradores, probado y auditado.

## Presentación breve (perfil, 2 o 3 frases)

He construido LeadFlow AI, un workflow de n8n que lee correos de clientes, los clasifica con un modelo de lenguaje, los registra en una hoja de cálculo y prepara un borrador de respuesta para que una persona lo apruebe. Me centré en lo que suele fallar en las automatizaciones con IA: las reglas que protegen al negocio están en código, los datos personales y de pago se ocultan antes de llegar al modelo y nunca se envía nada automáticamente. Después lo audité y lo probé, y documenté lo que todavía no hace.

## LinkedIn: entrada de proyecto

**Título:** LeadFlow AI, triaje de correos con control humano en n8n

**Descripción:**

Un workflow de n8n que convierte los correos entrantes de clientes en solicitudes clasificadas y registradas, con un borrador de respuesta a la espera de aprobación humana. No envía correos por sí solo.

Qué construí y qué comprobé:
- Un flujo entre Gmail, Google Sheets y una API de LLM (salida JSON con esquema), con las reglas de negocio en código («la IA propone, el código decide»).
- Protecciones de datos y de uso indebido: ocultación de tarjetas, IBAN y documentos de identidad antes de que los vea el modelo; límites de tamaño; escrituras en texto plano para que el contenido de un correo no pueda ser una fórmula; detección de instrucciones dirigidas a la IA (incluidos caracteres ocultos y parecidos), con la prioridad fijada por código; un borrador con riesgo se sustituye por una respuesta de cortesía fija; sin datos de ejecución guardados en las ejecuciones correctas.
- Fiabilidad: reintentos, 30 segundos de timeout, fallos guardados con su motivo en vez de parar una tanda, una entrada manual para reintentarlos y escrituras idempotentes con una reserva compartida para que un correo repetido o simultáneo no cambie nada.
- Una auditoría técnica en dos rondas (25 hallazgos, todos corregidos, mitigados o documentados) y 241 pruebas automáticas que ejecutan el workflow exportado sobre una simulación, más una comprobación por mutaciones y casos de prueba sobre los servicios reales, con los resultados reales y los simulados separados.

Tecnologías: n8n, Gmail, Google Sheets, Groq (`gpt-oss-120b`), JavaScript, ejecutor de pruebas de Node.js.

**Aptitudes a etiquetar:** n8n, Automatización de flujos de trabajo, Ingeniería de prompts, IA generativa, JavaScript, Integración de APIs, Pruebas de software, Google Workspace.

## Viñetas para el CV

Elige dos o tres. Cada una tiene respaldo en el repositorio.

- Diseñé y construí un workflow de n8n que clasifica correos de clientes con un LLM, los registra en Google Sheets y crea borradores en Gmail para aprobación humana; el workflow no tiene ningún nodo capaz de enviar correo y una prueba lo comprueba.
- Saqué las reglas de negocio del prompt y las llevé a código (prioridad, requisitos de revisión, avisos de precios, plazos y afirmaciones sin respaldo) después de que las pruebas mostraran que el modelo seguía la misma instrucción en una ejecución y no en la siguiente.
- Audité el workflow y corregí la inyección de fórmulas en la hoja, IBAN y documentos sin ocultar, entradas sin límite de tamaño y un modo de fallo en el que una caída de la IA paraba una tanda entera; en una segunda ronda reproduje con los servicios reales una carrera de borradores duplicados, la cerré con una reserva y refuerzo el código frente a correos hostiles; documenté lo que sigue abierto.
- Escribí 241 pruebas automáticas (ejecutor integrado de Node.js, sin dependencias) que ejecutan el workflow exportado y su código real sobre una simulación de n8n y de los tres servicios, con suites de concurrencia y adversariales, y una comprobación por mutaciones que confirma que las pruebas detectan 30 regresiones deliberadas.
- Documenté en lenguaje claro la evidencia real frente a la simulada, las limitaciones conocidas y los compromisos de seguridad.
