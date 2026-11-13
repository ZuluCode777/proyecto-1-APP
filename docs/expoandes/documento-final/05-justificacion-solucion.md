# 5. Justificación de la solución

**Criterio:** Justificación de solución, 5 puntos.
**Base:** el Proyecto 1 no mostraba otras ideas ni por qué se eligió una aplicación. La evaluación lo señaló y pidió comparar con apps existentes como Lazarillo y Moovit.

> **Nota para el equipo:** el Proyecto 1 no registró una sesión de ideación con alternativas. La comparación de la sección 5.1 se hace ahora, mirando hacia atrás, y el documento debe decirlo así. No hay que presentarla como una sesión que ocurrió en septiembre.

## 5.1 Alternativas consideradas

Criterios de comparación:
- **Hallazgos:** responde a lo que dijeron las entrevistas.
- **Equipo:** el equipo puede construirla y probarla en el semestre.
- **Costo:** cabe en el presupuesto.
- **Terceros:** cuánto depende de que otra entidad actúe.

| Alternativa | Hallazgos | Equipo | Costo | Terceros | Resultado |
| --- | --- | --- | --- | --- | --- |
| **A. Señalización física**: guías podotáctiles y anuncios sonoros en las estaciones. | Alta. Atiende los letreros ilegibles y la falta de anuncios de voz. | No. Es infraestructura del sistema. | Muy alto. | Total: TransMilenio e IDU. | Descartada como proyecto del equipo. Se cita como contexto: el 98 % de las estaciones no tiene guía en el suelo (El Tiempo, 2024). |
| **B. Acompañamiento humano**: personal de apoyo en estaciones y paraderos. | Alta. Los mapas lo piden. | No. | Alto y recurrente. | Total: el operador. | Descartada como proyecto del equipo. |
| **C. Recomendar apps que ya existen**: TransMiApp, Moovit, Lazarillo. | Media. Ver la sección 5.2. | Sí, pero no hay nada que construir. | Cero. | Depende de lo que cada app ya ofrece. | Descartada como solución única. Se usa como punto de comparación. |
| **D. Solo un dispositivo**: un sensor que avisa de obstáculos, sin app. | Baja. Atiende las caídas, pero no qué bus tomar ni dónde bajarse. | Sí. | Bajo. | Ninguna. | Descartada como solución única. Se incorpora como accesorio de E. |
| **E. App accesible propia con accesorio** | Alta. Voz para elegir el bus y bajarse, interfaz para baja visión y ceguera, accesorio para presencia cercana. | Sí, con alcance acotado. | Hosting gratuito. Hardware cerca del tope de COP 200.000; el precio real está por confirmar. | Baja: solo los datos abiertos de TransMilenio. | **Elegida.** |

## 5.2 Apps existentes

| App | Qué ofrece, según su fuente oficial | Qué no resuelve o falta verificar |
| --- | --- | --- |
| **TransMiApp** (oficial de TransMilenio) | Planea viajes. Consulta rutas, horarios y paraderos, y muestra la ubicación de los buses troncales y zonales en tiempo real (TransMilenio S.A., s. f.; Alcaldía de Bogotá, 2025). | No encontramos información oficial sobre su uso con lector de pantalla ni sobre un modo para baja visión. Falta probarla con VoiceOver. |
| **Moovit** | Pantallas optimizadas para VoiceOver y TalkBack (Moovit, s. f.). En España, con la Fundación ONCE, agregó un aviso de audio para bajarse a tiempo del bus (Moovit, 2021). | Ese aviso se anunció para España. Falta verificar la cobertura y la calidad de los datos de TransMilenio en Bogotá. |
| **Lazarillo** | GPS accesible para personas ciegas. Anuncia por voz lugares, calles e intersecciones cercanas mientras se camina (Lazarillo, s. f.). | Está pensada para caminar. Falta verificar si dice qué bus de TransMilenio tomar y dónde bajarse. |

> **Pendiente:** probar TransMiApp y Moovit con VoiceOver en un iPhone durante unos 30 minutos, con una tarea fija: «cómo llego de Ricaurte a Calle 72». Registrar qué se pudo hacer sin ver la pantalla. Así la comparación se apoya en observación propia y no solo en lo que dice cada empresa.

## 5.3 Qué aporta TransMiVoz y qué no

**Aporta:**
- Está hecha desde el principio para baja visión y ceguera total, con dos modos y la voz como forma principal de uso.
- Se le puede preguntar en español, como se hablaría, y pide aclaración cuando falta un dato, por ejemplo el origen.
- Es honesta con los datos. Solo dice dónde abordar cuando la parada está verificada, y separa el Metro futuro de los viajes reales. No inventa llegadas.
- Integra en el mismo teléfono un accesorio que avisa de presencia cercana por los auriculares.

**No aporta:**
- No tiene llegadas en tiempo real; TransMiApp sí.
- No cubre el SITP zonal.
- El accesorio no mide distancia y todavía no está validado con usuarios.

## 5.4 Por qué una aplicación con accesorio

- **Es lo que piden los entrevistados.** 8 de 8 dicen que usarían una aplicación con ayuda auditiva o visual, y 7 de 8 piden información por voz.
- **No exige infraestructura nueva.** Ya llevan el teléfono, así que la solución no depende de instalar nada en las estaciones.
- **El equipo puede construirla.** Usa datos abiertos y herramientas gratuitas, y cabe en el semestre.
- **El accesorio atiende las caídas, con límites.** 5 de 8 entrevistados han sufrido caídas. El accesorio se presenta como un aviso adicional y no como garantía de seguridad.
