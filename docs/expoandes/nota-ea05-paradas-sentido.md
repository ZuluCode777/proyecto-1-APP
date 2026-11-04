# EA-05 · Nota de evidencia y límites (issue #31)

Fecha: 2026-11-04, zona America/Bogota. Rama: `ea-05-paradas-verificadas-sentido`.
Base: `main` en `38cf31a`.

Esta nota resume qué se cambió, con qué evidencia y qué quedó sin comprobar.
No cierra la tarea: el coordinador revisa de forma independiente.

## Problema corregido

El catálogo deducía las paradas de cada servicio por cercanía geométrica
(≤ 60 m a la línea, `lib/transmilenio.ts`) y el planificador trataba esa
cercanía como un lugar donde se puede subir, bajar o transbordar
(`lib/routes.ts`, `lib/local-agent.ts`, `components/trip-view.tsx`). Eso produce
instrucciones inseguras: un expreso pasa cerca de una estación sin detenerse.
Además, las etiquetas de sentido (`from`/`to`) y el orden de las estaciones del
trazado se contradecían en algunos servicios (8 G y 8 T, entre otros).

## Qué se hizo (cambios aditivos de contrato/datos)

1. **Separación recorrido vs. parada atendida.** `BusRoute.stops` se documenta
   explícitamente como *estaciones cercanas al trazado* (solo para ilustrar el
   recorrido). Se agrega `BusRoute.servedStops`: paradas **atendidas
   verificadas** con `name`, `order`, `canBoard`, `canAlight`, `source`, `date`
   y `status` (`operativa` / `suspendida` / `sin-verificar`). Campo con
   `default []`, de modo que la copia vieja sigue validando sin convertir ningún
   dato heredado en parada verificada.
2. **Planificador solo con evidencia.** `planTrip`, los transbordos y la
   resolución de abordaje/descenso usan únicamente `servedStops` operativas.
   Sin paradas verificadas (estado actual del catálogo) no se arma ningún plan:
   el asistente ofrece **información de recorrido con incertidumbre**
   (`routesAlongBoth`), sin instruir subir/bajar y sin afirmar que no exista
   servicio.
3. **Reconciliación de sentido.** `reconcileDirection` compara `from`/`to` con
   el orden de la secuencia y marca `directionEvidence.agreement`
   (`consistente` / `contradictorio` / `indeterminado`), siempre con
   `verified: false` mientras no haya fuente oficial vigente. **No se invierte
   ninguna geometría** ni se inventa una dirección. 8 G y 8 T quedan marcados
   como `contradictorio`; el detalle de ruta lo avisa por pantalla y por voz.
4. **Sin certificar operación.** El plan verificado agrega «Confirma el horario
   antes de salir»; la vista de viaje agrega una nota de que no hay horarios en
   tiempo real. El texto horario y `est_ruta=1` no se usan como prueba de
   operación actual.
5. **Consumidores revisados:** `lib/routes.ts`, `lib/local-agent.ts`,
   `lib/ollama.ts` (reutiliza `findPlaces`/`findRouteByCode`, sin cambios de
   contrato), `components/route-detail.tsx`, `components/trip-view.tsx`,
   `components/route-list.tsx` (sin cambios), `components/transit-map.tsx` (sin
   cambios: solo dibuja geometría), `components/diagnostics.tsx` (la prueba del
   asistente acepta tanto plan verificado como recorrido con incertidumbre, y
   sigue rechazando un abordaje inferido).

La copia `data/transmilenio.json` se migró de forma **aditiva** con
`pnpm migrar:paradas-sentido`: se agregaron `servedStops: []` y
`directionEvidence` calculado; estaciones, códigos, recorridos, horarios y la
fecha (`2026-09-24`) quedaron intactos (verificado campo por campo).

## Fuentes consultadas (2026-11-04) y su límite

- **Servicio ArcGIS oficial** (`ConsultaSubgerenciaPlanificacionSITP`, capa 15
  «Servicios»): se listaron sus campos y relaciones. No expone ninguna columna
  ni relación con la **secuencia de paradas atendidas por servicio y sentido**;
  solo geometría, origen/destino, horarios y estado. La descripción del servicio
  indica base geográfica elaborada en 2024 por TMSA.
- **`GTFS_dinamicos`** del operador: responde `services: []`. Un directorio
  vacío **no demuestra** que la matriz oficial no exista; solo que no se obtuvo
  aquí un feed descargable.
- **Datos Abiertos Bogotá** (organización TransMilenio): publican estaciones
  troncales, información general de rutas y trazados (geometría). No se consiguió
  una **matriz de paradas por servicio y sentido** descargable con licencia y
  vigencia verificables en esta sesión. La URL del issue a
  `matriz-de-paradas-rutas-troncales-transmilenio` no entregó un recurso
  confirmable ahora.

**Conclusión de datos:** no hay una fuente de paradas verificadas disponible y
comprobable en esta sesión. Por eso `servedStops` queda vacío en el catálogo
real; el contrato queda listo para llenarlo cuando el coordinador aporte la
matriz/GTFS oficial con licencia y vigencia confirmadas. Las pruebas de viajes
verificados usan **fixtures sintéticas** (`lib/fixtures-sinteticas.ts`),
rotuladas como tales y con fuente `fuente-de-prueba`; **no son catálogo
oficial** y no se copian a `data/`.

## Comandos ejecutados

- `pnpm exec tsc --noEmit` → sin errores (código 0).
- `pnpm test` → **47 pruebas aprobadas, 0 fallos** (antes 36). Las nuevas cubren:
  catálogo real sin viaje inferido; recorrido con incertidumbre; viaje directo y
  transbordo con paradas verificadas (fixtures); expreso que pasa sin parar;
  `servedStops` vacío; reconciliación de sentido y 8 G/8 T contradictorios.
- `pnpm build` → compilación de producción correcta.
- **`pnpm verificar` (parcial).** El arnés usa Chrome headless; en este contenedor
  Chrome-for-Testing no inicializa (fallo de crashpad/zygote) con `--no-sandbox`
  ni con `--single-process`, así que **no se obtuvo el 9/9**. Se validó en su lugar
  el servidor real de producción en `127.0.0.1` con la clave de prueba conocida:
  `/diagnostico` responde `401` sin clave y `200` con clave; `GET /api/agent`
  reporta motor `reglas`; `POST /api/agent` con «cómo llego de Portal Usme a
  Molinos» devuelve `action: "search"` con mensaje de incertidumbre
  (no instruye abordaje) y nombra rutas del recorrido. Queda pendiente correr
  `pnpm verificar` completo en un entorno con Chrome operativo (p. ej. CI o el
  host del equipo).

## Límites y pendientes

- No se integró una matriz oficial de paradas: requiere fuente con licencia y
  vigencia verificables (tarea del backlog / evidencia del coordinador).
- No se tocó el GPS, la voz, el foco ni los demás hallazgos de la auditoría
  (issues 32/33/34); solo #31 y sus consumidores.
- No se ejecutó la prueba PowerShell del instalador (es comprobación de CI a
  preservar); no se modificaron workflows, secretos ni infraestructura.
- `pnpm verificar` con Chrome real quedó sin ejecutar por el entorno; se declara
  explícitamente.
