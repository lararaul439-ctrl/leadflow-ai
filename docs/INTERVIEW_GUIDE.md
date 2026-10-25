# Guía para explicar LeadFlow AI en una entrevista

Material para preparar la conversación técnica sobre el proyecto. Está escrito para decir la verdad: lo que se hizo, lo que se comprobó, lo que no, y por qué. Las cifras son las que aparecen en el repositorio; si cambias algo, vuelve a comprobarlas.

## El proyecto en 30 segundos

«LeadFlow AI es un flujo de n8n que lee correos comerciales, los clasifica con un modelo de lenguaje, los registra en Google Sheets y deja un borrador de respuesta en Gmail para que lo revise una persona. No envía nada por sí mismo. Lo más interesante no fue montarlo, sino probarlo y auditarlo: encontré fallos reales, como que una orden escondida en el correo podía subir la prioridad, o que un asunto que empezara por `=` se guardaba como fórmula, y los corregí.»

## En 2 minutos

1. **Problema.** Correos comerciales que alguien lee, clasifica, anota y contesta a mano.
2. **Solución.** Gmail → limpieza y enmascarado de datos → modelo de lenguaje con salida JSON con esquema → validación en código → fila en Sheets → borrador en Gmail.
3. **Idea central.** «La IA propone, el código decide.» El modelo da categoría, prioridad, resumen y borrador, pero las reglas que protegen al negocio están en código: reclamación siempre prioridad alta, precios o plazos en el borrador se marcan, una orden dirigida a la IA no puede subir la prioridad.
4. **Control humano.** No hay ningún nodo de envío, y una prueba falla si aparece uno.
5. **Fiabilidad.** Si la API de IA falla, el correo se guarda con el motivo y la tanda sigue; un disparador manual reintenta solo esas filas. Es idempotente: repetir un correo no duplica nada.
6. **Pruebas.** 83 pruebas automáticas sobre una simulación, más pruebas reales documentadas. Auditoría con 18 hallazgos, uno abierto a propósito.
7. **Límites.** Dos ejecuciones simultáneas pueden dar dos borradores; el reintento es manual; el enmascarado es por patrones; no está probado con clientes ni datos reales.

## Preguntas que pueden hacerte y cómo contestarlas

**¿Por qué n8n y no código?**
Para un proceso con servicios externos (Gmail, Sheets, una API) y un volumen bajo, n8n da conexión, credenciales y reintentos hechos, y se ve el flujo. Lo que es lógica propia (limpieza, validación, reintentos) lo escribí en nodos de código y lo probé fuera de n8n, que es justo lo que n8n hace difícil.

**¿Cómo evitas que la IA invente cosas?**
No me fío de la instrucción al modelo. Pongo reglas en el prompt y reglas en código que miran el resultado: precios, plazos, horarios, disponibilidad, «Sí, ofrecemos…», enlaces. En las pruebas la IA inventó un horario y una disponibilidad aun con la regla en el prompt; eso es lo que me llevó a validar en código. Y toda consulta de información exige revisión humana porque las reglas son expresiones regulares y no cubren todo.

**¿Qué pasa con la inyección de instrucciones («ignora tus instrucciones»)?**
Se mitiga, no se elimina. El correo va dentro de una etiqueta como dato, se le quitan todos los ángulos para que no pueda cerrarla, y el prompt dice que no se obedezca. Y, sobre todo, hay capas que no confían en el modelo: la prioridad la fija el código si detecta órdenes, se marcan enlaces y descuentos, y solo se crean borradores. En las pruebas el resumen a veces repite la orden aunque la marque como sospechosa; lo he documentado.

**¿Qué pasa si falla la API de IA?**
Reintenta tres veces con 30 s de timeout; si sigue fallando, el correo se guarda con estado `error_ia` y el motivo, el resto de la tanda continúa y el flujo de errores no se dispara. `Reintentar fallidos` lee esas filas y las reprocesa, y como la escritura es un upsert por identificador no hay duplicados. Se probó en real provocando el fallo con una URL equivocada solo en la versión borrador, sin publicarla, y se comprobó después que el workflow publicado coincidía con el repositorio.

**¿Cómo lo probaste?**
En tres niveles. 16 casos manuales sobre los servicios reales, documentados con sus fallos. 83 pruebas automáticas sobre una simulación del workflow exportado, que ejecutan el código real de los nodos. Y 5 ejecuciones reales de la v1.1 para los cambios de la auditoría. Digo siempre cuál es cuál, porque la simulación no es una prueba de extremo a extremo.

**¿Cómo sabes que las pruebas valen para algo?**
Hay dos comprobaciones. La batería ejecutada contra la exportación original (v1.0): 47 pruebas fallan, así que detectan lo que se corrigió. Y una comprobación por mutaciones que rompe el workflow de 11 maneras (por ejemplo, volver al formato de celda que evalúa fórmulas, o convertir el nodo de borrador en uno de envío) y comprueba que alguna prueba lo detecta. Detecta las 11.

**¿Qué fallo te enseñó más?**
Dos. El primero: probé con 100 correos y todo salió «bien», pero al leer las filas y los borradores aparecieron tres problemas (una orden oculta subía la prioridad, borradores que afirmaban servicios, la hoja no mostraba qué revisar). Procesar sin errores no es lo mismo que procesar bien. El segundo: en la auditoría vi que un fallo persistente de la IA paraba toda la tanda y podía perder correos.

**¿Qué no resolviste?**
Las ejecuciones simultáneas del mismo correo: la fila queda única, pero se crean dos borradores. Cerrarlo exige un bloqueo compartido entre ejecuciones, con sus propios fallos, para un caso raro de consecuencia leve. Lo dejé documentado y hay una prueba que lo describe, para que la documentación no se desvíe.

**¿Es seguro usarlo con datos reales?**
No como está. Oculta tarjetas, IBAN y DNI/NIE, pero otros datos personales pasan; la capa gratuita del proveedor puede usar los datos; el historial de n8n guarda el correo original. Haría falta una revisión de protección de datos, un acuerdo con el proveedor y una política de retención. Está todo en las limitaciones.

**¿Cuánto tiempo o dinero ahorra?**
No lo he medido y no lo afirmo. Lo único medido es el tiempo de proceso: unos 5 o 6 segundos por correo en las pruebas.

**¿Por qué cambiaste de Gemini a Groq?**
Se agotó la cuota diaria gratuita y el flujo falló; el error quedó registrado. Cambiar fue tocar un nodo, porque el lector de la respuesta entiende los dos formatos. Es una buena prueba de que el proveedor se puede intercambiar.

**¿Qué harías después?**
En este orden: repetir la prueba de 100 correos reales en la v1.1; un bloqueo para las ejecuciones simultáneas; programar el reintento con límite de intentos; guardar `customer_name` y `company` en la hoja; un panel de filas fallidas; y evaluar la calidad del modelo con un conjunto de correos etiquetados, no solo con repeticiones.

## Cosas que no debes decir

- Que ahorra tiempo o dinero (no está medido).
- Que es «seguro», «a prueba de fallos» o «listo para producción».
- Que las 83 pruebas son «de extremo a extremo» o que prueban Gmail, Sheets o Groq.
- Que se ha usado con clientes o con datos reales.
- Que la inyección de instrucciones está resuelta.

## Vocabulario útil si la entrevista es en inglés

| Español | English |
|---|---|
| La IA propone, el código decide | The AI proposes, the code decides |
| Borrador, nunca se envía | Draft only, never sent automatically |
| Revisión humana | Human in the loop / human review |
| Inyección de instrucciones | Prompt injection |
| Enmascarar datos | Mask (redact) sensitive data |
| Idempotente | Idempotent: running it twice changes nothing |
| Reintentar | Retry |
| Simulación frente a prueba real | Simulated test versus real run |
| Limitación conocida | Known limitation |

## Frases de 10 segundos

- «Lo que más aprendí es que una instrucción al modelo no es una garantía.»
- «Probé mi propia auditoría: lo que encontré lo corregí y lo que no, lo dejé escrito.»
- «Separé siempre lo simulado de lo real.»
