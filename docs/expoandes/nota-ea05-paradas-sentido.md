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

---

## Actualización 2026-11-04 (tarde): evidencia GTFS corroborada e iteración

El coordinador aportó evidencia primaria: descargó y verificó el GTFS oficial
diario (manifest, hash, routes/trips/stop_times, calendar, unión GIS↔GTFS). Con
ella se corrigió el cierre previo de «no se obtuvo fuente»: **sí existe** un GTFS
oficial utilizable.

### Fuente primaria confirmada (comprobada 2026-11-04)

- `https://gtfs.transmilenio.gov.co/manifest.json`: `generated_at`
  2026-11-03T04:19:59-05:00; `GTFS.zip` 119 934 110 bytes, `last_modified`
  2026-11-03. (No se descarga el ZIP de 120 MB al repo; `stop_times` pesa 573 MB
  y se procesa en origen por streaming.)
- Licencia del catálogo institucional (`package_show`): **CC-BY-SA-4.0**;
  metadatos del catálogo de 2022/2023, que documentan la licencia pero NO la
  frescura. El ZIP diario no repite la licencia; se documenta el alcance sin
  inventar una licencia específica ni tratar la ausencia de aviso como
  prohibición. Atribución: **TransMilenio S.A.**

La evidencia corroborada quedó transcrita en `lib/evidencia-gtfs.ts`, con su
fuente, fecha y nodos. Es el único punto donde se declara catálogo oficial.

### Reconciliación 8 G / 8 T (con evidencia)

- GTFS route_id 13307 (8 G) y 13308 (8 T) coinciden con los GIS route_id por
  unión de claves. El patrón dominante de 8 G va **Terminal (nodo 2502) →
  Guatoque - Veraguas (nodo 7201)** y el de 8 T al revés. En GIS, `orig_ruta`/
  `dest_ruta` estaban **invertidos** para ambos.
- Corrección aplicada: `from`/`to`/`label` corregidos desde GTFS,
  `directionEvidence.verified = true`, paradas atendidas verificadas (extremos
  del patrón dominante, con nodo), y calendario verificado. Se **preserva** la
  geometría (`stops`, `path`); no se invierte nada. Solo cambian 8 G y 8 T.
- Límite honesto: de las 27 paradas del patrón solo se transcribieron los
  EXTREMOS verificados (los que el coordinador detalló con nodo); las
  intermedias quedan como recorrido, en abstención segura, hasta transcribir la
  secuencia completa.

### H72 no para en Calle 127 (con evidencia, independiente del aviso de 2018)

- GTFS route_id 13476: ningún patrón de H72 incluye el nodo 2202 (Calle 127);
  el patrón principal va Toberín (2101) → Portal Usme (90004). H72 queda sin
  `servedStops`, así que el planificador se abstiene y nunca ofrece abordar en
  Calle 127. Verificado en el servidor real: «Calle 127 → Portal Usme» responde
  recorrido con incertidumbre, sin instrucción de abordaje.

### Aplicación en vivo y en copia

La corrección se aplica en `normalizeTransmilenio` (consulta en vivo) y al cargar
la copia (`lib/transmilenio-data.ts`), además de quedar escrita en el snapshot
por la migración. Así llega a la app sin depender de qué origen respondió.
Verificado contra el servidor real con datos `source: live`.

### Fallos reproducidos por el coordinador, ya corregidos

Validación compartida en `lib/evidencia.ts`, usada por planificador, asistente,
TripView, detalle y diagnóstico:

- **Evidencia basura ya no prescribe.** `source` vacío, fecha vacía/inválida/
  futura/vencida o estado no operativo hacen que `planTrip` devuelva 0 planes.
  `paradaPrescriptible` exige fuente no vacía, estado `operativa` y
  `fechaEvidenciaVigente` (no futura, ≤ 400 días).
- **Órdenes duplicados/ambiguos → abstención.** `secuenciaAtendidaValida`
  rechaza `order` repetidos; el nombre de la parada se toma del **registro que
  coincidió**, no por `.find(order)` (que devolvía otra estación).
- **Sin calendario verificado no se afirma operación ni salida inmediata.**
  `route_info`/`schedule` citan «horario publicado», no «opera»;
  `RouteDetail.describe` avisa ausencia de paradas y de calendario;
  `calendarioOperaEnFecha` evalúa ventana, día y excepciones en America/Bogota.
- **TripView revalida.** `tripSummaryStillValid` re-chequea cada tramo contra la
  evidencia actual antes de dar órdenes; si no valida, muestra el recorrido sin
  instrucciones.
- **Diagnóstico valida contenido**, no solo `action`: exige el aviso de
  incertidumbre cuando no hay paradas y una instrucción clara cuando sí.
- **8 G/8 T consultables por código** (`findRouteByCode`/`searchRoutes` aceptan
  el formato número-letra), soporte mínimo sin resolver todo #32.

### Comandos (iteración)

- `pnpm exec tsc --noEmit` → OK. `pnpm test` → **62/62** (antes 47). `pnpm build`
  → OK. Verificación directa del servidor real (`source: live`, clave de prueba):
  8 G Terminal→Guatoque devuelve plan verificado con aviso de calendario; H72
  Calle 127→Portal Usme y Portal Usme→Molinos devuelven recorrido con
  incertidumbre sin instruir abordaje; `/api/transmilenio` entrega 8 G con
  sentido corregido, paradas y calendario.
- `pnpm verificar` con Chrome headless: sigue sin inicializar en este contenedor
  (crashpad/zygote). Por indicación del coordinador no se insiste con más flags
  ni se modifica CI; el coordinador lo correrá en su entorno con Chrome.
