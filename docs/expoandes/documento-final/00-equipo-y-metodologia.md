# Equipo y metodología

Esta sección no tiene puntaje propio en la rúbrica. El enunciado de ExpoAndes sí pide mantener Design Thinking y Scrum, con roles, sprints semanales y reuniones diarias ([lectura-rubrica.md](../lectura-rubrica.md), sección «Feria y Post Mortem en el enunciado final»).

## Integrantes

| Integrante | Carril | Responsabilidad en la segunda entrega |
| --- | --- | --- |
| Nicolás | A1 | Backend, datos de TransMilenio, reglas del asistente, integración y compras. Desde el 10/11 también la app de iPhone. |
| Jacobo | A2 | App de iPhone, interfaz accesible, firma y audio, hasta el 10/11. |
| María Paula | H1 | Suministro de hardware, registro de pruebas y evidencia. |
| Antonia | H2 | Lectura del radar y ensayos en banco. |
| Esteban | H3 | Contrato Bluetooth, firmware y enlace con el iPhone. |

Fuente: [acta de alcance y capacidad](../acta-alcance-capacidad.md) del 3/11 y [plan de ejecución](../plan-ejecucion.md), sección «Cambios al 11 de noviembre».

> **Por confirmar:**
> - Apellidos de todos para la portada.
> - Si David Moreno sigue en el equipo. Aparece en el Proyecto 1 como Product Owner y no figura en el acta del 3/11.
> - Qué hizo Jacobo después del 10/11, cuando A1 asumió las tareas del iPhone.
> - El reparto de hardware entre H1, H2 y H3. El acta lo marca como «propuesto».

## Roles Scrum

| Rol | Proyecto 1 | Segunda entrega |
| --- | --- | --- |
| Scrum Master | María Paula | Por confirmar |
| Product Owner | David Moreno | Por confirmar |
| Equipo de desarrollo | Nicolás y Jacobo | Aplicación: Nicolás y Jacobo. Hardware: María Paula, Antonia y Esteban |

El acta del 3/11 registra que faltaban responsables de coordinación Scrum, de prioridad de producto y de custodia de la evidencia.

## Cómo se trabajó

**Design Thinking.** Las fases del Proyecto 1 se conservan y se reparten así en este documento:

| Fase | Dónde está |
| --- | --- |
| Empatizar: entrevistas y mapas de empatía | Sección 1 |
| Definir: análisis y declaración del problema | Secciones 1 y 2 |
| Idear: requisitos, alternativas y propuesta | Secciones 3, 4 y 5 |
| Prototipar: wireframes, prototipo del iPhone y MVP | Secciones 7 y 8 |
| Probar: pruebas automáticas, banco de hardware y sesiones con usuarios | Sección 8 |

**Gestión del trabajo.**
- El backlog de la segunda entrega está en GitHub. El índice [#26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26) enlaza 27 tareas, de EA-01 a EA-27. Después se agregaron EA-28 y EA-29.
- Cada tarea es un issue con resultado observable, prioridad (P0 a P2), responsable, bloqueadores, criterios de aceptación y evidencia exigida. Las dependencias entre tareas se registraron como bloqueadores en GitHub.
- Cada cambio de código entró por un pull request con revisión. La integración continua corre tipos, pruebas, compilación y la verificación en Chrome, y solo se fusiona con todo en verde ([AGENTS.md](../../../AGENTS.md)).
- Se usaron agentes de programación con IA para preparar pull requests. Desde el 10/11 solo A1 los lanza, uno por tarea, y A1 revisa cada cambio antes de fusionarlo ([plan de ejecución](../plan-ejecucion.md)).

> **Por confirmar:**
> - Duración de los sprints y frecuencia de las reuniones en la segunda entrega. El enunciado las pide y el repositorio no las registra.
> - Cómo exige el curso declarar el uso de herramientas de IA.

## Fechas principales

| Fecha (2026) | Hecho |
| --- | --- |
| 25/09 | Entrega del Proyecto 1 y presentación del MVP web |
| 2/11 | Auditoría del código, investigación y plan de la segunda entrega |
| 3/11 | Acta de alcance: equipo de cinco, presupuesto de COP 150.000–200.000 |
| 6/11 | Compra de la placa ESP32-S3 y del radar SEN0395. Primera medición en Render |
| 10/11 | Las zonas interiores (G3) salen del alcance. A1 asume la app de iPhone |
| 11/11 | Llega el Mac. Primera sesión en un iPhone real; se decide SwiftUI |
| 12/11 | Primer banco del accesorio con la placa real |
| 13/11 | Segundo banco. Congelación del código del iPhone a las 15:00 |
| 14–15/11 | Validación integrada con usuarios (EA-21), planeada |
| 16/11 | Ensayo de la demostración (EA-22), planeado |
| 17/11 | Feria ExpoAndes |
