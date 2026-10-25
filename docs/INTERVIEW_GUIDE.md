# Guía para explicar LeadFlow AI en una entrevista

Material para preparar la conversación técnica sobre el proyecto. Está escrito para decir la verdad: lo que se hizo, lo que se comprobó, lo que no, y por qué. Las cifras son las que aparecen en el repositorio; si cambias algo, vuelve a comprobarlas.

## El proyecto en 30 segundos

«LeadFlow AI es un flujo de n8n que lee correos comerciales, los clasifica con un modelo de lenguaje, los registra en Google Sheets y deja un borrador de respuesta en Gmail para que lo revise una persona. No envía nada por sí mismo. Lo más interesante no fue montarlo, sino probarlo y auditarlo: encontré fallos reales, como que una orden escondida en el correo podía subir la prioridad, que un asunto que empezara por `=` se guardaba como fórmula o que dos ejecuciones simultáneas creaban dos borradores (lo reproduje con los servicios reales antes de arreglarlo), y los corregí.»

## En 2 minutos

1. **Problema.** Correos comerciales que alguien lee, clasifica, anota y contesta a mano.
2. **Solución.** Gmail → limpieza y enmascarado de datos → reserva del correo → modelo de lenguaje con salida JSON con esquema → validación en código → fila en Sheets → borrador en Gmail.
3. **Idea central.** «La IA propone, el código decide.» El modelo da categoría, prioridad, resumen y borrador, pero las reglas que protegen al negocio están en código: reclamación siempre prioridad alta, precios o plazos en el borrador se marcan, una orden dirigida a la IA no puede subir la prioridad, y un borrador con cualquier señal de riesgo se sustituye por una respuesta de cortesía fija.
4. **Control humano.** No hay ningún nodo de envío, y una prueba falla si aparece uno.
5. **Fiabilidad.** Si la API de IA falla, el correo se guarda con el motivo y la tanda sigue; un disparador manual reintenta solo esas filas. Es idempotente: repetir un correo no duplica nada, ni siquiera si dos ejecuciones empiezan a la vez (reserva compartida en una pestaña de la hoja).
6. **Pruebas.** 242 pruebas automáticas sobre una simulación (con 27 de concurrencia y 119 adversariales), una comprobación por mutaciones con 31 roturas, lint con ESLint y CI en GitHub Actions, y pruebas reales documentadas. Auditoría en dos rondas: 18 hallazgos en la primera y 7 en la segunda.
7. **Límites.** El reintento es manual; el enmascarado y la detección de inyección son por patrones; la reserva tiene casos límite conocidos (una caída bloquea ese correo hasta 10 minutos); hay ajustes de la instancia de n8n que solo puede cambiar su propietario; no está probado con clientes ni datos reales.

## Preguntas que pueden hacerte y cómo contestarlas

**¿Por qué n8n y no código?**
Para un proceso con servicios externos (Gmail, Sheets, una API) y un volumen bajo, n8n da conexión, credenciales y reintentos hechos, y se ve el flujo. Lo que es lógica propia (limpieza, validación, reintentos) lo escribí en nodos de código y lo probé fuera de n8n, que es justo lo que n8n hace difícil.

**¿Cómo evitas que la IA invente cosas?**
No me fío de la instrucción al modelo. Pongo reglas en el prompt y reglas en código que miran el resultado: precios, plazos, horarios, disponibilidad, «Sí, ofrecemos…», enlaces, promesas y cualquier cifra que no esté en el correo. Si salta alguna, el borrador del modelo se sustituye por una respuesta de cortesía fija y una persona escribe la real. En las pruebas la IA inventó un horario y una disponibilidad aun con la regla en el prompt; eso es lo que me llevó a validar en código. Y toda consulta de información exige revisión humana porque las reglas son expresiones regulares y no cubren todo.

**¿Qué pasa con la inyección de instrucciones («ignora tus instrucciones»)?**
Se mitiga, no se elimina. El correo va dentro de una etiqueta como dato, se le quitan todos los ángulos para que no pueda cerrarla, y el prompt dice que no se obedezca. Antes de aplicar las reglas se quitan los caracteres invisibles y se normalizan las letras parecidas, y el texto oculto en HTML se descarta. Y, sobre todo, hay capas que no confían en el modelo: la prioridad la fija el código si detecta órdenes, se marcan enlaces, descuentos y cifras inventadas, el borrador de riesgo se sustituye y solo se crean borradores. 119 pruebas adversariales lo cubren, incluidas las de correos honestos que no deben marcarse. En las pruebas el resumen a veces repite la orden aunque la marque como sospechosa; lo he documentado.

**¿Qué pasa si falla la API de IA?**
Reintenta tres veces con 30 s de timeout; si sigue fallando, el correo se guarda con estado `error_ia` y el motivo, el resto de la tanda continúa y el flujo de errores no se dispara. `Reintentar fallidos` lee esas filas y las reprocesa, y como la escritura es un upsert por identificador no hay duplicados. Se probó en real provocando el fallo con una URL equivocada solo en la versión borrador, sin publicarla, y se comprobó después que el workflow publicado coincidía con el repositorio.

**¿Cómo lo probaste?**
En tres niveles. 16 casos manuales sobre los servicios reales, documentados con sus fallos. 242 pruebas automáticas sobre una simulación del workflow exportado, que ejecutan el código real de los nodos. Y ejecuciones reales para cada ronda de cambios: 5 para la v1.1 y 11 para la v1.2 (la carrera de borradores antes y después de la reserva, un correo hostil, uno honesto, un fallo de la IA con su reintento y una ejecución de producción). Digo siempre cuál es cuál, porque la simulación no es una prueba de extremo a extremo.

**¿Cómo sabes que las pruebas valen para algo?**
Hay dos comprobaciones. La batería ejecutada contra exportaciones anteriores: 47 de las 83 pruebas originales fallaban contra la v1.0 y 131 de las 242 actuales fallan contra la v1.1, así que detectan lo que se corrigió. Y una comprobación por mutaciones que rompe el workflow de 31 maneras (por ejemplo, volver al formato de celda que evalúa fórmulas, convertir el nodo de borrador en uno de envío, hacer que gane la última reserva en vez de la primera o dejar de guardar un campo extraído) y comprueba que alguna prueba lo detecta. Detecta las 31; y si una mutación no cambia nada, el script lo marca como error, para que una errata no cuente como «detectada».

**¿Qué fallo te enseñó más?**
Tres. El primero: probé con 100 correos y todo salió «bien», pero al leer las filas y los borradores aparecieron tres problemas (una orden oculta subía la prioridad, borradores que afirmaban servicios, la hoja no mostraba qué revisar). Procesar sin errores no es lo mismo que procesar bien. El segundo: en la auditoría vi que un fallo persistente de la IA paraba toda la tanda y podía perder correos. El tercero: al desplegar el código reforzado, mi herramienta alteró mis propias expresiones regulares (secuencias de escape convertidas en caracteres invisibles); solo lo vi porque comparé cada nodo publicado con el repositorio, y desde entonces una prueba lo vigila.

**¿Cómo evitaste los borradores duplicados?**
Primero lo reproduje con los servicios reales: dos ejecuciones simultáneas dieron dos borradores, dos veces. Google Sheets no tiene un «crear si no existe» atómico, así que cada ejecución añade una reserva a un registro, lo relee entero y gana la primera reserva activa por orden de fila; la otra se aparta antes de llamar al modelo. Después repetí el experimento: un borrador. Tiene límites que dejé escritos: una caída mientras se tiene la reserva bloquea ese correo hasta 10 minutos, y reanudar una ejecución antigua después de un relevo puede duplicar (hay una prueba que lo describe).

**¿Qué no resolviste?**
Cosas que no están en mi mano o que no merecía la pena resolver: el reintento sigue siendo manual; el enmascarado y la detección de inyección son por patrones; y hay ajustes de la instancia de n8n (retención de ejecuciones, quién puede abrirlas, ocultación de datos de ejecución) que solo puede cambiar su propietario. Los dejé en una lista precisa, no los di por hechos.

**¿Es seguro usarlo con datos reales?**
No como está. Oculta tarjetas, IBAN y DNI/NIE, pero otros datos personales pasan; la capa gratuita del proveedor puede usar los datos; las ejecuciones fallidas conservan el correo original en n8n (las correctas ya no guardan datos). Haría falta una revisión de protección de datos, un acuerdo con el proveedor y una política de retención. Está todo en las limitaciones.

**¿Cuánto tiempo o dinero ahorra?**
No lo he medido y no lo afirmo. Lo único medido es el tiempo de proceso: unos 5 o 6 segundos por correo en las pruebas.

**¿Por qué cambiaste de Gemini a Groq?**
Se agotó la cuota diaria gratuita y el flujo falló; el error quedó registrado. Cambiar fue tocar un nodo, porque el lector de la respuesta entiende los dos formatos. Es una buena prueba de que el proveedor se puede intercambiar.

**¿Qué harías después?**
En este orden: repetir la prueba de 100 correos reales en la versión final (la reserva añade unas seis llamadas a Sheets por correo y conviene medir el efecto); archivar automáticamente la pestaña de reservas; programar el reintento con límite de intentos; un panel de filas fallidas; y evaluar la calidad del modelo con un conjunto de correos etiquetados, no solo con repeticiones.

## Cosas que no debes decir

- Que ahorra tiempo o dinero (no está medido).
- Que es «seguro», «a prueba de fallos» o «listo para producción».
- Que las 242 pruebas son «de extremo a extremo» o que prueban Gmail, Sheets o Groq.
- Que se ha usado con clientes o con datos reales.
- Que la inyección de instrucciones está resuelta, o que la reserva elimina todo riesgo de duplicados.

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
