# EA-01: acta de alcance, capacidad y pendientes

Fecha: **3 de noviembre de 2026**. Seguimiento: [issue #27](https://github.com/ZuluCode777/proyecto-1-APP/issues/27), parte del [índice #26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26).

**Estado: en elaboración.** El equipo eligió comenzar por EA-01. Este registro reúne lo confirmado y propone criterios verificables; no cierra el alcance ni acredita pruebas físicas. Las respuestas pendientes impiden cerrar #27, pero no bloquean las correcciones independientes del producto.

## Confirmado y pendiente

| Tema | Base confirmada | Falta registrar o comprobar |
| --- | --- | --- |
| Feria | 17 de noviembre de 2026. | Fecha y condiciones de entrega del documento, distintas de la feria. |
| Equipo | Aplicación: Nicolás y Jacobo. Hardware: María Paula, Antonia y Esteban. Compromiso declarado: dedicar el tiempo necesario para terminar antes de la entrega. | Roles de coordinación, reparto interno de hardware y horas cuantificadas hasta el 16 de noviembre. |
| Herramientas Apple | Mac/Xcode disponibles. El equipo indica iPhone entre 16 y 18, modelo por confirmar, e iOS «más reciente». | Confirmar modelo e iOS exactos en el equipo real, versión de Xcode, experiencia Swift y firma/instalación; disponibilidad no equivale a prueba aprobada. |
| Hardware | Presupuesto informado: **COP 150.000–200.000**. **Nicolás realiza las compras** en Bogotá. Sin componentes comprados según la última confirmación documentada. | Actualizar inventario, distribución del presupuesto, referencias, costo total con entrega y recepción efectiva. |
| Metas físicas | Obstáculos estáticos, objetivos móviles y zona interior conocida; enlace y avisos por iPhone/auriculares como condiciones compartidas. | Ensayos y veredictos independientes; ninguna capacidad física está validada por esta acta. |

Base: [plan de ejecución](plan-ejecucion.md) y [confirmaciones y límites](corroboracion.md), sección «Documentos previos y privacidad». No se volvió a preguntar por disponibilidad de Mac/Xcode.

Actualización del 3/11: Nicolás confirmó en conversación los integrantes, compromiso de dedicación, rango presupuestal, responsable de compra y operador de Kiro. Las versiones de Apple siguen sin comprobarse.

Actualización del 6/11: Nicolás confirmó la compra de una placa ESP32-S3-N16R8 y un radar DFRobot SEN0395; ver [plan de firmware](plan-firmware.md).

## Responsables y capacidad

Los identificadores conservan los carriles del plan; no representan asignaciones a cuentas de GitHub. A1/A2 siguen el orden indicado por Nicolás. H1/H2/H3 se proponen en el orden facilitado; el reparto de especialidades de hardware sigue por confirmar. El compromiso de dedicar «el tiempo necesario» no cuantifica horas por fecha del 3 al 16.

| Carril | Trabajo previsto | Nombre | Horas disponibles por fecha / total |
| --- | --- | --- | --- |
| A1 | Backend, catálogo, reglas y coordinación de integración; compras. | Nicolás | Dedicación según necesidad; sin cuantificar. |
| A2 | iPhone, interfaz accesible, firma y audio; operación de Kiro. | Jacobo | Dedicación según necesidad; sin cuantificar. |
| H1 | Coordinación de suministro con Nicolás, referencias interiores y evidencia. | María Paula; reparto propuesto. | Dedicación según necesidad; sin cuantificar. |
| H2 | Lectura de radar y ensayos estáticos/móviles. | Antonia; reparto propuesto. | Dedicación según necesidad; sin cuantificar. |
| H3 | Contrato BLE, firmware y enlace con iPhone. | Esteban; reparto propuesto. | Dedicación según necesidad; sin cuantificar. |

**Compras: Nicolás. Operación de Kiro: Jacobo.** Faltan responsables de coordinación Scrum, prioridad de producto y custodia de evidencia; pueden ser los mismos integrantes. Dentro del rango de **COP 150.000–200.000**, falta distribuir radar, placas, referencias interiores, cables, alimentación y entrega. Este registro no ejecuta compras.

La capacidad sigue **sin calcular**: el compromiso de terminar no demuestra disponibilidad ilimitada. No se multiplican cinco personas por jornadas supuestas ni se cuentan agentes como disponibilidad humana. Cuando existan horas concretas, sumar por carril, reservar integración del 13 al 15 y ensayo del 16, y contrastar con las estimaciones del plan. Si no cabe, reducir pantallas y paridad; conservar validación, cancelación, accesibilidad y ensayos. La fecha de entrega del documento sigue pendiente; la feria confirmada es el 17 de noviembre.

## Corte de feria propuesto

Se conserva la propuesta del [plan vigente](plan-ejecucion.md), condicionada a capacidad y pruebas:

- Corregir semántica de transporte, recuperación del catálogo, ubicación, cancelación y permisos en el backend/web existente; reutilizar esas reglas en iPhone.
- Probar primero firma, instalación, VoiceOver y audio local en el iPhone real. La decisión SwiftUI mínimo depende de EA-09 / #35; no se promete paridad completa.
- Mantener consulta accesible por texto y lectura solicitada; voz y avisos de sesión con control de cancelación. Metro solo como escenario futuro, separado de viajes operativos.
- Mantener las tres metas físicas, cada una con resultado aprobado, fallido o pendiente. Preparar demostración controlada; «sin detección» nunca significa «camino libre».
- Conservar EA-24–EA-27 como evolución posterior; EA-23 cierra después de la feria porque documenta hechos del evento.

Hitos del plan: contrato BLE y decisión iPhone el **4/11**; primera evidencia física el **6/11**; montaje congelado el **12/11**; dictamen el **15/11**; ensayo el **16/11**. Son metas de trabajo, no resultados obtenidos. Ver [arquitectura y experimentos](arquitectura-y-experimentos.md) y [puertas de hardware](puertas-hardware.md).

## Necesidades y requisitos verificables

La base cualitativa son ocho entrevistas de septiembre. Su transcripción anonimizada permanece fuera del repositorio público; se publican aquí solo necesidades agregadas. No acredita preferencia de iPhone ni representatividad poblacional. Los criterios siguientes son propuestas de diseño y ensayo, no exigencias literales de las entrevistas ni resultados aprobados.

| Necesidad y origen | Requisito y prueba observable | Tareas y evidencia prevista |
| --- | --- | --- |
| Entender rutas y qué servicio tomar; entrevistas. | No indicar abordaje, descenso ni transbordo sin paradas y sentido verificados; no afirmar disponibilidad actual sin vigencia/calendario. Probar un expreso que pasa sin parar, sentidos contradictorios y fuente incompleta. | EA-05/#31, EA-06/#32 y EA-17/#43; fuente vigente, casos de referencia y resultados. |
| Recibir información auditiva; entrevistas. | Consultar y oír respuesta con lectura solicitada; cancelar escucha/consulta/emisión sin voz tardía. Probar salida de pantalla, permiso denegado y respuesta demorada. | EA-08/#34, EA-19/#45 y EA-20/#46; casos automatizados y sesión real de audio. |
| Distinguir información con baja visión; entrevistas. | Texto escalable, contraste y etiquetas comprensibles; completar iniciar, consultar y detener con VoiceOver sin depender de mapa o color. | EA-02/#28 y EA-17/#43; prototipo y observación con usuarios. Paridad restante en EA-25/#51. |
| Afrontar obstáculos y dificultades de acceso; entrevistas. | Evaluar por separado blancos estáticos y móviles con referencia física; registrar omisiones, error y falsas detecciones según las puertas propuestas. No convertir esta prueba en certificación de movilidad segura. | EA-11/#37 y EA-16/#42; registros de banco y veredictos por condición. |
| Identificar zona interior; meta del equipo, no preferencia demostrada por las entrevistas. | Ensayar zonas conocidas y mostrar «zona desconocida» al perder referencia. Si se requiere coordenada métrica, medirla por separado; BLE por zonas no la sustituye. | EA-18/#44; plano, visitas, pérdidas de referencia y resultados. |
| Llevar avisos al auricular del iPhone; decisión del equipo. | Medir sensor→sonido y probar desconexión, interrupción y dato vencido; sin salida privada inesperada por altavoz ni repetición de medidas antiguas. | EA-15/#41 y EA-20/#46; combinación real de sensor/iPhone/auricular y datos del ensayo. |

La validación de prioridad iPhone queda **pendiente**. Propuesta para EA-02/EA-21: con usuarios actuales que acepten participar, registrar plataforma que usan, barreras de acceso y resultado de iniciar sesión, consultar transporte, reconocer un fallo y detener. Registrar ayuda necesaria y opiniones divergentes; no convertir una preferencia del equipo en hallazgo de usuarios ni publicar identidades. Responsables y disponibilidad de participantes deben confirmarse.

## Entrega anterior, rúbrica y enunciado final

El 3/11 se leyeron los PDF locales y los cuatro adjuntos aportados por Nicolás mediante conversión a Markdown. La entrega previa también se revisó visualmente, incluidos sus mapas, wireframes, backlog y capturas. **Enunciado ExpoAndes, entrega previa y evaluaciones ya están recuperados y reconciliados** en [la lectura académica actualizada](lectura-rubrica.md). Los originales, identidades y calificaciones no se incorporan al repositorio público.

| Fuente | Qué permite registrar | Pendiente |
| --- | --- | --- |
| `EnunciadoProyectoInicial-202610.pdf`, en la carpeta superior. | Antecedente de Design Thinking, Scrum, MVP y Post Mortem. | Sus cinco minutos de presentación no se trasladan al formato de stand del enunciado ExpoAndes. |
| `Rubrica de calificacion Entrega Documento Final.pdf`, en la carpeta superior. | Doce criterios y 110 puntos, incluidos Feria, Post Mortem y CANVAS. | Fecha y formato no constan; no exige iOS, radar, Render ni IA. |
| `proyecto 1 grupo 6.pdf` y evaluaciones de Documento/MVP Proyecto 1, adjuntos. | Base reutilizable: investigación, mapas, wireframes, backlog, capturas y reflexión previa. Comentarios reconciliados con tareas y evidencia en la lectura académica. | Ejecutar correcciones de citas, comparación de apps, problema, alternativas, viabilidad y validación; actualizar integrantes y alcance. |
| `EnunciadoExpoandes-202610.pdf`, adjunto. | Informe, MVP, afiche/stand/demostración, explicación de todos los integrantes y Post Mortem. | Confirmar fecha/hora y formato del informe; lineamientos audiovisuales de clase y cualquier instrucción adicional del taller no aparecen desarrollados. |

Los adjuntos resuelven la falta de acceso a documentos: no hace falta recuperar Outlook para esta reconciliación. La búsqueda anterior entre servicios conectados no se ejecutó por restricción del conector; no se contrató acceso.

La [matriz de correcciones](lectura-rubrica.md#qué-conservar-y-qué-actualizar) enlaza comentarios con EA-23/#49 y tareas de producto/pruebas; no equivale a correcciones ya ejecutadas. EA-22/#48 prepara afiche y exposición por todos los integrantes; EA-23/#49 integra fuentes, comparación de apps, problema breve, alternativas, viabilidad, resultados, CANVAS y hechos posteriores de feria/Post Mortem.

## Kiro, acceso y comprobaciones

Comprobaciones de lectura del 3/11, antes de abrir el PR de esta acta:

- Repositorio e issue accesibles desde esta sesión. No se encontraron PR abiertos al consultar GitHub; no se inició otra ejecución.
- [CI del commit documental `aaf0987`](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/41563870195/job/125680578961): `verificar`, completado correctamente. No son pruebas nuevas de esta acta.
- El [workflow existente](../../.github/workflows/ci.yml) exige Node 24, tipos, unitarias, prueba PowerShell del instalador, compilación y diagnóstico en Chrome. [AGENTS.md](../../AGENTS.md) exige comprobaciones en verde antes de fusionar.
- GitHub informó `main` sin protección y sin reglas efectivas en `GET /repos/ZuluCode777/proyecto-1-APP/rules/branches/main`. Existe un ruleset activo, pero esa respuesta no acredita protección de `main`. No se modificaron ajustes; falta acordar protección y revisión antes de delegar escrituras.
- **Jacobo opera la instalación existente de Kiro**, según confirmó Nicolás. Repositorio habilitado, permisos efectivos de la instalación y de cada integrante, y plan ya existente: **pendientes de comprobar con Jacobo**. La etiqueta `ready-for-agent` no acredita instalación ni ejecución.

Antes de encargar una tarea, el operador comprueba bloqueadores y trabajo ya abierto, reclama la tarea y registra quién la ejecuta. Se conserva [el procedimiento existente](plan-ejecucion.md#cómo-usar-issues-con-kiro): sin reinstalaciones ni contratación, sin disparadores durante esta planificación y sin secretos o acceso al Windows de producción. Esta acta no cambia workflows ni activa Kiro.

## Cierre de #27

- [x] Integrantes de aplicación y hardware registrados; Nicolás responsable de compras y Jacobo operador de Kiro.
- [x] Rango presupuestal registrado: COP 150.000–200.000.
- [ ] Reparto interno de hardware, roles de coordinación y horas cuantificadas registrados; capacidad contrastada y corte de feria acordado.
- [ ] Modelo/iOS/Xcode, experiencia Swift y vía de firma registrados; pruebas de primera sesión enlazadas a EA-09, sin atribuirlas a esta acta.
- [ ] Inventario actualizado y presupuesto distribuido entre referencias, alimentación y entrega; tres metas físicas conservadas con sus límites.
- [x] Entrega previa, comentarios y enunciado ExpoAndes recuperados; correcciones y criterios trazados a tareas y evidencia.
- [ ] Fecha/hora y formato de entrega del informe confirmados; lineamientos de clase disponibles para afiche y cierre.
- [ ] Requisitos trazados a necesidades; validación de prioridad iPhone realizada o pendiente con responsable y plan explícitos.
- [ ] Permisos de Kiro, comprobaciones y protección de rama revisados con Jacobo; pendientes declarados, sin activación durante planificación.

Se actualizará el estado al recibir las respuestas del equipo. Ninguna casilla pendiente se marca por el solo hecho de crear esta acta.
