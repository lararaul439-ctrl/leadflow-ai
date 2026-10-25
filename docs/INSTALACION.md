# Guía de instalación

Volver al [README](../README.es.md).

Los workflows se exportaron de n8n Cloud 2.44.6. Los JSON no llevan credenciales, ni identificadores de hojas, ni direcciones de correo: hay que completarlos con los tuyos. [.env.example](../.env.example) es una lista de comprobación de los valores que debes tener a mano; el proyecto no lee variables de entorno.

**Requisitos previos:** una instancia de n8n (Cloud o propia), una cuenta de Gmail **de pruebas**, una cuenta de Google para Sheets y una clave de API de un proveedor de modelos compatible con OpenAI (el nivel gratuito de Groq sirve con datos ficticios).

1. **Cuenta de Gmail de pruebas.** No uses tu correo personal.
2. **Hoja de Google Sheets** con tres pestañas. La primera debe ser `solicitudes`:
   - `solicitudes`, con estas cabeceras en la fila 1: `request_id`, `received_at`, `sender_name`, `sender_email`, `subject`, `body`, `category`, `priority`, `summary`, `status`, `human_review_required`, `validation_flags`, `customer_name`, `company`, `requested_service`, `quantity`, `missing_information`
   - `errores`, con las cabeceras: `fecha`, `flujo`, `nodo`, `mensaje`, `url_ejecucion`
   - `bloqueos` (el registro de reservas), con las cabeceras: `request_id`, `claim_id`, `event`, `at`. El workflow solo añade filas; archiva las antiguas de vez en cuando.
3. **Credenciales en n8n:**
   - Gmail (OAuth con la cuenta de pruebas).
   - Google Sheets (OAuth con la misma cuenta).
   - Una credencial `Header Auth` para la API de IA, con el nombre de cabecera `Authorization` y el valor `Bearer <tu clave>`.
4. **Importar los dos workflows** desde la carpeta `workflows/` (Workflows → Import from file), primero `leadflow-errores.json` y después `leadflow-ai.json`.
5. **Rellenar lo que los JSON dejan en blanco:**

   | En el JSON | Qué hacer |
   |---|---|
   | `CONFIGURAR_CREDENCIAL` | Abrir cada nodo con credencial (Gmail Trigger, Create a draft, los seis nodos de Google Sheets del flujo principal y el de la API de IA) y elegir la credencial propia. |
   | `TU_ID_DE_HOJA` | En los nodos de Google Sheets, elegir tu documento y la pestaña: `solicitudes` (`Buscar duplicado`, `Append or update row in sheet`, `Leer filas con error`) y `bloqueos` (`Crear reserva`, `Leer reservas`, `Liberar reserva`) en el flujo principal, y `errores` en el flujo de errores. Vuelve a elegir la pestaña en cada uno, aunque ya se vea un nombre. |
   | `TU_CORREO_DE_PRUEBAS@ejemplo.com` | En el Gmail Trigger, filtro de remitente: la dirección de la cuenta de pruebas. |
   | `ID_DEL_FLUJO_DE_ERRORES` | En los ajustes del workflow principal, elegir como flujo de errores `LeadFlow AI - Errores`. |

6. **Revisar el nodo de IA.** El flujo usa `Analizar con IA (Groq)`. Para usar otro proveedor basta con cambiar ese nodo; el lector de la respuesta entiende el formato compatible con OpenAI y el de Gemini.
7. **Revisar los ajustes de privacidad** en los ajustes de ambos workflows. La exportación no guarda datos de las ejecuciones correctas ni de las manuales, y conserva las fallidas. La retención y quién puede abrir las ejecuciones son ajustes de tu instancia de n8n (ver [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
8. **Publicar** ambos workflows.
9. Escribir un correo de prueba a la cuenta de pruebas y esperar un minuto. Debe aparecer una fila en `solicitudes` y un borrador en Gmail, y no se envía nada.

**Reintentar correos fallidos.** Si el proveedor de IA estuvo caído, algunas filas tendrán estado `error_ia`. Cuando vuelva, abre el workflow principal y ejecuta a mano el disparador `Reintentar fallidos`. Reprocesa solo esas filas, en su sitio.

Los nombres de workflows, nodos, pestañas y estados están en español porque el proyecto se construyó en español. Se mantienen tal cual en los archivos para que coincidan con lo que se ve en n8n.
