# EA-13 · Catálogo educativo del Metro de Bogotá

Issue #39, parte de #26. Los datos se transcriben de
[`investigacion-metro.md`](investigacion-metro.md), con corte del **2 de noviembre
de 2026** (revisión de código `0abca8c`). No es una investigación nueva: la vigencia
la fija `METRO_CORTE` en `lib/metro.ts`.

## Qué hace

- `lib/metro.ts`: contrato independiente de TransMilenio con las 16 estaciones de la
  Línea 1 (`metro-bogota:l1:e01` … `e16`, identificador oficial E01–E16, nombre
  público, alias SIG, corredor, fuentes y conexión futura), la ficha de la Línea 2 (11
  estaciones proyectadas, sin lista) y las fuentes con enlace y fecha.
- `lib/local-agent.ts`: intención `metro`. Se decide antes que tarifas, rutas, lugares
  y GPS, y solo con contexto explícito (`metro`, `PLMB`, `línea 1/2`). Va después de
  cancelar y antes de la ayuda genérica: «cómo funciona la línea 2 del metro» y «ayuda
  para ir de Central a Calle 72 en metro» se responden como Metro; «ayuda» sola no cambia. La respuesta usa
  la acción `none` y los pasos existentes, así que el contrato HTTP del cliente iOS
  (`none/frequent/gps/search/route/trip`) no cambia.
- `components/metro-list.tsx`: listado accesible sin mapa (acordeones con teclado),
  estado visible, atribución CC BY 4.0 y enlaces a las fuentes. Se abre desde el inicio
  del modo baja visión («Metro de Bogotá»). En modo ceguera total se consulta por voz.
- `components/diagnostics.tsx`: dos comprobaciones de Metro dentro de la prueba
  «Asistente», que ejecuta `pnpm verificar`.

## Límites que se conservan

- El Metro no entra en `TransmilenioData`, `findPlaces`, `nearestStations`, `planTrip`
  ni en el GPS. «Calle 72» sin contexto de Metro sigue siendo la estación de TransMilenio.
- Una petición de viaje, tarifa, horario o tiempo real con contexto de Metro explica
  que no hay servicio comercial; no navega ni da órdenes de abordaje.
- Si una frase da un número y un nombre de estación que no coinciden («estación E3
  Calle 72 del metro»), o un número que no existe junto a un nombre, el asistente pide
  aclarar con la acción `none`; no elige una de las dos en silencio.
- Un nombre suelto que coincide con varias estaciones («metro kennedy»: E03 Ciudad
  Kennedy y E05 Hospital de Kennedy) también pide aclarar con la acción `none`,
  nombrando los candidatos.
- Un nombre suelto como «kennedy» pide aclarar aunque la frase traiga otro nombre («metro
  timiza kennedy») o un número ajeno («metro estación 7 kennedy»); un número que sea de
  uno de los candidatos («metro e5 kennedy») sí lo resuelve.
- Las fichas del asistente y del listado aclaran que, si una estación de TransMilenio tiene
  el mismo nombre, es otra estación (`TEXTO_HOMONIMO`). La voz del listado dice lo mismo que
  la nota de estado, incluida la fecha de corte.
- Al salir del listado se corta solo su propia locución; una voz posterior del padre sigue.
- Las fechas son previsiones: ningún estado cambia al llegar marzo de 2028.
- Las 8 conexiones directas, E06/E07 por verificar y la discrepancia de E13 (2019 contra
  2026) se describen con su evidencia; ninguna se habilita para transbordo y la
  contraparte de TransMilenio es `null`.
- Geometría, accesos, tarifas, frecuencias y tiempos permanecen ausentes. El mapa de
  estaciones sigue pendiente del contrato geoespacial (CRS sin confirmar).

## Contrato iOS

Las respuestas de Metro no cambian la forma del contrato HTTP: `action: "none"`,
`steps: [{ label, detail? }]`, `engine: "reglas"` y `reply`, sin campos nuevos. El
decodificador `ios/TransMiVoz/Dominio/RespuestaAgente.swift` rechaza un `reply` vacío o
de más de `maximoCaracteresTexto = 10_000` caracteres y más de `maximoPasos = 50` pasos.

Medido al cerrar #39 (10 de noviembre de 2026) con las frases de Metro de
`lib/ea13-metro.test.ts` (estaciones por nombre y número, líneas, rechazos de viaje,
tarifa y horario, aclaraciones), por el mismo camino que `POST /api/agent`
(`parseIntent` y `runIntent`): el máximo es **1058 caracteres** (ficha de E13 Central) y
**8 pasos**, muy por debajo de los límites. Son cifras de esa fecha; la fuente de verdad
es la prueba, que falla si una respuesta de Metro supera cualquiera de los dos límites o
añade un campo.

## Límites de la verificación

`pnpm verificar` usa Chrome sin pantalla con micrófono y voz simulados: comprueba que
el asistente responde, no la voz en un dispositivo real.
