# 10. Post Mortem

**Criterio:** Post Mortem, 10 puntos. El enunciado pide una reunión o taller de cierre, una reflexión y trabajo futuro.
**Base:** el Post Mortem del Proyecto 1 (p. 13). Fue general y solo positivo: «resultados significativamente positivos».
**Estado:** plantilla con insumos. Las conclusiones las escribe el equipo después del taller, que ocurre después de la feria.

## 10.1 Lo que dijo el Post Mortem del Proyecto 1

- El MVP cumplió las expectativas de las fases iniciales y tenía nombre comercial y logo.
- Las limitaciones para seguir eran tres: la vigencia de los datos, el alcance de los agentes de la interfaz y la publicación en un servidor público.
- El siguiente objetivo era probar el MVP con los usuarios esperados.
- El trabajo en equipo y el reparto de roles funcionaron.

Qué pasó con cada punto en la segunda entrega:
- **Vigencia de los datos:** se atendió con EA-05 y EA-06. La evidencia de paradas ahora tiene fecha y vence.
- **Alcance de los agentes:** se midió en EA-27.
- **Publicación:** se hizo en Render.
- **Pruebas con usuarios:** hasta el 13/11 no se habían hecho.

## 10.2 Hechos documentados para llevar al taller

Son hechos con su fuente, no conclusiones. El taller decide qué se aprende de cada uno.

| Fecha | Hecho | Fuente |
| --- | --- | --- |
| 2/11 | La auditoría del MVP encontró 16 hallazgos. El más grave: el planificador trataba estaciones cercanas al trazado como paradas. | [Auditoría](../auditoria-codigo.md) |
| 2/11 | El plan estimó 13,5 a 15,5 días-persona de trabajo de app para quince días de calendario, sin horas de dedicación cuantificadas. | [Plan de ejecución](../plan-ejecucion.md) |
| 5/11 | El equipo supo que no tendría Mac hasta el 11/11. El código SwiftUI se escribió antes y se compiló en la integración continua de GitHub en macOS. | [Plan de ejecución](../plan-ejecucion.md), issue #68 |
| 6/11 | Se compró un radar que detecta presencia y no mide distancia. La meta de obstáculos quietos (G1) quedó en riesgo desde la compra. | [Plan de firmware](../plan-firmware.md) |
| 10/11 | Las zonas interiores (G3) salieron del alcance. A1 asumió todo el carril de aplicación. | [Plan de ejecución](../plan-ejecucion.md) |
| 11/11 | Primera sesión en un iPhone real: 17 de 18 pruebas. Se decidió SwiftUI sin activar el respaldo en Safari. | Issue #35 |
| 12/11 | El primer banco con la placa real dio 13 hallazgos de firmware y radar. | [Resultados del 12/11](../verificaciones/banco-2026-11-12/resultados.md) |
| 12–13/11 | Dos ramas corrigieron los mismos hallazgos de forma distinta. El equipo eligió una y cerró la otra (#98) sin fusionar. | PR #98 y #101 |
| 12/11 | El modelo de lenguaje no superó a las reglas en el corpus de 100 frases. | [EA-27](../ea-27-evaluacion.md) |
| 13/11 | Se congeló el código del iPhone. La app y el accesorio no se habían probado juntos. | [Plan de ejecución](../plan-ejecucion.md) |
| 2/11–13/11 | Agentes de programación con IA prepararon pull requests. Hasta el 10/11 los operaba A2; desde entonces solo A1 los lanza y revisa cada cambio antes de fusionarlo. | [Acta](../acta-alcance-capacidad.md), [plan de ejecución](../plan-ejecucion.md) |

> **Pendiente:** agregar lo que pase en EA-21 (14–15/11), en el ensayo (16/11) y en la feria (17/11).

## 10.3 Preguntas para el taller

1. ¿Qué haríamos distinto para probar con usuarios antes y no al final?
2. ¿La compra del radar se decidió con la información suficiente? ¿Qué habría cambiado comprar antes un sensor que mida distancia?
3. ¿El alcance era realista para cinco personas en quince días? ¿Qué se debió recortar antes?
4. ¿Qué funcionó y qué no de trabajar con agentes de IA? ¿Cuánto tiempo de revisión exigieron?
5. ¿Cómo se repartió el trabajo entre aplicación y hardware? ¿Hubo cuellos de botella, por ejemplo una sola placa o un solo Mac?
6. ¿Qué aprendimos de decir lo que el producto no hace? Por ejemplo, «sin detección» no es camino libre y no se inventan llegadas.

## 10.4 Conclusiones del taller

> **Pendiente:** fecha del taller, asistentes y conclusiones en cuatro apartados: qué salió bien, qué salió mal, por qué y qué haríamos distinto.

## 10.5 Trabajo futuro

Lista de partida. El taller la ordena por prioridad.

- **Validación con usuarios:** sesiones con personas con discapacidad visual sobre la app y el accesorio, junto con asociaciones como el INCI o el CRAC.
- **Más paradas verificadas:** hoy solo 8 G y 8 T las tienen. Renovar la evidencia antes del 4/12/2026.
- **SITP zonal.**
- **Llegadas en tiempo real**, si se consigue una fuente abierta de posiciones de buses.
- **Un sensor que mida distancia,** como los evaluados en la sección 6.4, y el ensayo completo de G1 y G2.
- **Medir el consumo** y dar al accesorio una batería y una caja que no tapen el radar.
- **Publicar la app en el App Store,** con el programa de desarrolladores, y permitir el uso en segundo plano.
- **Ubicación dentro de las estaciones** con referencias fijas, si un operador lo autoriza.
