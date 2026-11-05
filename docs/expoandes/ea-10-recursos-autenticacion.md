# EA-10 (#36): acotar recursos y verificar autenticación antes de exponer

Rama `ea-10-recursos-autenticacion`, desde `origin/main` 809ee39 (con EA-05 a
EA-08 fusionados). No se modificaron la copia operativa
(`data/transmilenio.json`), los workflows, las configuraciones de producción, el
script de verificación (`scripts/verificar.mjs`) ni la prueba PowerShell del
instalador (`test/verificar-servicios.ps1`). No se accedió a Windows, SSH, Ollama
real, Render ni hardware. No se añadieron dependencias.

Responde a los cinco criterios de aceptación de EA-10. Conserva los contratos
públicos: el JSON de `/api/agent` (`AgentReply`) y una sola acción validada por
pregunta; el nombre de plataforma del middleware de Next 16 (`proxy`); la firma
de `createRateLimiter`/`rateLimit`; y el contrato histórico de `estaAutorizado`
(sin clave deja pasar). No toca los controles de EA-05 a EA-08 (paradas
verificadas, sentido, calendario, revalidación antes de texto/voz, catálogo
recuperable, reglas primero, cancelación).

Incorpora las correcciones de dos revisiones independientes: el límite de
ingreso real (excluir `/api/agent` del clon del `proxy` y compartir la guardia
Basic en su manejador), el 413/400 que no queda pendiente por la cancelación del
stream, la retirada del export de reinicio solo-pruebas y de la rama especulativa
de proxy confiable, la protección que el `proxy` ya daba a los recursos estáticos
de Next (se conserva), un verificador HTTP cuyo ciclo de vida no puede dar un
falso verde, la opción nueva del contador en español (`maximoClaves`) y
argumentos de objeto en los helpers nuevos.

## Comportamiento

### Criterio 1 — HTTP Basic que no deja la app abierta (fallar cerrado)

`lib/access.ts` sigue resolviendo solo la pregunta criptográfica «¿la credencial
coincide con la clave?» (comparación en tiempo constante) y, por contrato, deja
pasar cuando NO hay clave; eso es lo que corren el desarrollo local y la
integración continua. Ese contrato queda intacto.

La DECISIÓN de servicio se separa en `lib/autenticacion.ts`
(`decidirAcceso`, unión discriminada `permitido` | `clave-requerida` |
`cerrado-sin-clave`):

- Con secreto utilizable: 401 sin credencial o con credencial incorrecta; acceso
  con la correcta. En ambos entornos.
- En **producción** sin secreto utilizable (ausente, vacío o solo espacios):
  `cerrado-sin-clave` → el `proxy` responde **503** y NO sirve. La app no queda
  abierta por una variable vacía. Reversión segura: suspende la exposición hasta
  configurar el secreto.
- En **desarrollo** sin secreto utilizable: `permitido`, como hasta ahora.

`claveUtilizable` trata como «sin clave» una variable vacía o compuesta solo de
espacios, pero NO recorta una clave con contenido real: una clave válida que
incluya espacios al principio o al final se compara TAL CUAL en `estaAutorizado`,
sin alterarla. El secreto solo vive en el entorno: no se registra, no aparece en
las respuestas (el 503 no revela si había clave) ni se compara fuera de
`estaAutorizado`. `instrumentation.ts` avisa en el arranque de producción cuando
no hay clave utilizable, sin imprimir el valor.

La decisión y su representación se comparten: `decidirAccesoDeEntorno` lee
`NODE_ENV`/`APP_PASSWORD` una vez y `respuestaDeDecision` traduce un acceso
denegado a 401 (con reto `WWW-Authenticate`) o 503. El `proxy` (que devuelve
`NextResponse`) y el manejador de `/api/agent` (que devuelve `Response`)
construyen la MISMA respuesta desde esa representación, sin divergir en mensaje ni
cabeceras. Un 401/503 no es una respuesta del agente: su cuerpo es texto plano,
igual que el del `proxy`, no `AgentReply`.

### Criterio 2 — lectura del cuerpo por stream con cota real de bytes

El manejador leía `await req.text()` (acumula TODO antes de medir) y comparaba
`.length` en unidades UTF-16, no bytes. Ahora `lib/cuerpo-peticion.ts`
(`leerCuerpoLimitado`) lee el `ReadableStream` nativo por trozos con `getReader`,
cuenta BYTES y, al superar `MAXIMO_BYTES_CUERPO` (4000), corta y cancela el stream
antes de seguir acumulando. Devuelve una unión discriminada:

- `ok` → el texto decodificado en UTF-8 (un carácter multibyte partido entre
  trozos se arma al concatenar los bytes antes de decodificar).
- `excedido` → el endpoint responde **413**.
- `error` (fallo o cancelación de la lectura) → el endpoint responde **400**, sin
  lanzar (no 500) y tras cancelar el stream (no se deja el recurso abierto).

No se confía en `Content-Length`: la cota se aplica a los bytes REALES leídos,
así una cabecera ausente o mentirosa no la evade. El límite de la FRASE
(`MAX_MESSAGE_CHARS = 300`) sigue siendo independiente y se aplica después. Las
respuestas públicas conservan el contrato `AgentReply` (413/400 usan `plainReply`).

**413/400 no pendientes por la cancelación (hallazgo P1 #1).** Al desbordar o
fallar, NO se espera `lector.cancel()`: sobre un cuerpo clonado/`tee()` (como el
clon del `proxy`), `cancel()` de una rama espera a que la otra también se cancele;
si esa rama no se consume, esperar bloquearía el 413/400 para siempre. Se dispara
la cancelación con manejo de rechazo (sin `await`) y se suelta el candado del
lector, así la respuesta sale de inmediato.

**La cota actúa sobre el cuerpo real, no sobre un clon (hallazgo P1 #2).** En
Next 16, cuando una ruta pasa por el `proxy`, el servidor CLONA y almacena su
cuerpo en memoria (hasta `proxyClientMaxBodySize`, 10 MiB por defecto) y espera a
terminar la carga (`finalize`) ANTES del manejador; la cota de 4000 bytes llegaría
tarde. Para resolverlo en el ingreso real —sin servidor propio ni dependencias—
se EXCLUYE `/api/agent` del `proxy` (su `config.matcher`), de modo que Next no
clona su cuerpo y `leerCuerpoLimitado` lo lee en streaming, cortando en 413 antes
de recibirlo entero. Para no abrir un hueco de autenticación, el manejador de
`/api/agent` aplica en GET y POST la MISMA guardia Basic compartida
(`decidirAccesoDeEntorno`): la protección de toda la app sigue equivalente. La
exclusión se ancla a la ruta EXACTA (con o sin barra final): variantes como
`/api/agentx` o `/api/agent/sub` siguen pasando por el `proxy`. El `matcher` NO
excluye `_next/static`, `_next/image` ni el favicon: antes de EA-10 toda petición
pedía clave, y eso se conserva (un JS compilado existente sin credencial da 401).

### Criterio 3 — contador con cota de cardinalidad, no solo expiración

`lib/rate-limit.ts` antes solo limpiaba entradas VENCIDAS al pasar de un tamaño;
un aluvión de claves NUEVAS dentro de la ventana (p. ej. una cabecera de proxy
inventada por petición) hacía crecer el mapa sin tope, porque no había nada
vencido que limpiar. Ahora, al alcanzar `maximoClaves` (5000 por defecto), una clave
NUEVA se rechaza con **429** y `Retry-After` (`motivo: "cardinalidad"`), tras
purgar primero las vencidas (recuperar espacio por expiración es legítimo). Nunca
se desaloja una entrada ACTIVA, de modo que un rechazo no se puede «reiniciar»
desalojando la entrada que lo cuenta; una clave recupera cuota solo cuando su
ventana vence. Sigue siendo contador local de una sola instancia: no se añadió
Redis ni se promete cuota global o persistente (alcance demo). La firma de
`rateLimit` se conserva; solo se enriquece el resultado con `motivo`.

### Criterio 4 — identidad del cliente conservadora (proxy pendiente de verificar)

`lib/identidad-cliente.ts` (`claveCliente`) reemplaza la confianza ciega en el
PRIMER `x-forwarded-for`/`x-real-ip`. Esas cabeceras las puede escribir
cualquiera; solo son fiables detrás de un proxy que las reescriba de forma
conocida y verificada. Mientras no se haya VERIFICADO el proxy real (EA-14/#40),
`claveCliente()` devuelve SIEMPRE la clave acotada común (`CLAVE_SIN_VERIFICAR`):
no se deriva identidad de ninguna cabecera, así nadie obtiene cuota propia
inventando valores ni infla la cardinalidad, y la cota es conservadora. Es el
comportamiento acotado cuando no hay identidad validada.

Siguiendo la revisión, **no se incluye una rama de «proxy confiable»
configurable** (que antes solo usaban los tests): etiquetar una cadena sin medir
como IP de confianza sería afirmar algo no verificado. La lectura de la cadena se
añadirá en EA-14/#40 una vez medida la topología; `lib/identidad-cliente.ts`
documenta ese punto de extensión.

**No se afirma que Render reescriba ninguna cabecera.** Su verificación real
queda PENDIENTE de EA-14/#40, antes de exponer.

**Matriz/cadena a medir en EA-14/#40** (antes de confiar en cualquier cabecera):

| A medir en el despliegue real | Qué confirmar |
| --- | --- |
| ¿Render antepone su salto a `x-forwarded-for`? | Que exista y sea consistente |
| Nº de proxies de confianza en la ruta hasta la app | Cuántos saltos añaden |
| ¿Puede un cliente inyectar saltos extra? | Que no muevan el salto de confianza |
| `x-real-ip`: ¿lo escribe el proxy o el cliente? | No usarlo como identidad si lo puede escribir el cliente |

**Reversión que suspende la exposición:** mientras `claveCliente()` devuelva la
clave acotada, toda identidad es conservadora (comportamiento seguro). Combinado
con el criterio 1 (producción sin clave = 503), la reversión segura suspende la
exposición.

### Criterio 5 — alcance demo de una sola instancia y pruebas de helpers tocados

Se conserva la premisa de una sola instancia con contador local (sin Redis). El
contador vuelve a ser `const rateLimit` (no hay export de reinicio en producción).
Se buscaron todos los llamadores de los helpers tocados: la guardia de acceso
compartida (`proxy.ts`, `app/api/agent/route.ts`, `lib/access.test.ts`),
`claveCliente`/`rateLimit`/lectura de cuerpo (`app/api/agent/route.ts`), y los
tests del endpoint real (`lib/ea07-asistente-ubicacion.test.ts`,
`lib/ea08-reglas-cancelacion.test.ts`).

`lib/ea08-reglas-cancelacion.test.ts` fabricaba un `x-forwarded-for` distinto por
petición para no compartir cuota entre pruebas. Con la política conservadora esa
cabecera ya no es identidad (todo colapsa a la clave acotada), así que esa técnica
simulaba identidades que el servidor no debe creer. Se adaptó SIN debilitar la
cobertura y SIN un export solo-pruebas: cada caso carga una instancia FRESCA del
endpoint por import con query distinta (`?caso=…`), el mismo patrón que ya usa
`lib/transmilenio-data.test.ts`, de modo que cada caso tiene su propio contador.
El 429 real se cubre aparte (`lib/ea10-endpoint.test.ts`) sin ocultar el límite.

## Evidencia

Pruebas con `node:test` y reloj/stream/`fetch` simulados, sin dependencias
nuevas:

- `lib/ea10-autenticacion.test.ts`: `claveUtilizable` (whitespace), fallar
  cerrado en producción, desarrollo abierto, 401/acceso con clave, clave válida
  con espacios no alterada, `respuestaDeDecision` (401 con reto/503 sin revelar
  secreto) y `decidirAccesoDeEntorno` leyendo `NODE_ENV`/`APP_PASSWORD` reales.
- `lib/ea10-cuerpo-peticion.test.ts`: trozos, UTF-8 multibyte partido, cota de
  bytes (no caracteres), `Content-Length` ignorado, error y cancelación → `error`,
  y **desborde en una rama de `tee()` con la otra pendiente → 413 no queda colgado**
  (regresión del P1 #1, con plazo).
- `lib/ea10-rate-limit-cardinalidad.test.ts`: tope de cardinalidad (429), clave
  conocida no bloqueada por el tope, desalojo solo por expiración, cuota no
  reiniciada por desalojo, aluvión acotado.
- `lib/ea10-identidad-cliente.test.ts`: la clave del cliente es siempre la acotada
  común (no se confía en cabeceras). (Sintética; no certifica el proxy.)
- `lib/ea10-endpoint.test.ts`: endpoint real → 413 (cuerpo grande), 400 (error de
  lectura, sin 500), 200 válido, 429 + `Retry-After`, y la **guardia Basic en GET
  y POST** (producción sin clave/vacía/whitespace → 503; con clave: 401 sin
  credencial o incorrecta, acceso con la correcta; desarrollo sin clave permite),
  todos con contrato `AgentReply` en las respuestas de agente. Cada caso carga una
  instancia fresca por import con query (aislamiento del contador sin reset); el
  tipo de los manejadores sale del módulo real, sin interfaz duplicada ni cast.
- `lib/ea10-entorno-pruebas.ts` (`conEntorno`): fija `NODE_ENV`/`APP_PASSWORD` y los
  restaura aunque el cuerpo falle; lo usan las pruebas de autenticación y de
  endpoint (cubierto en `ea10-autenticacion.test.ts`).
- `lib/ea10-proxy-matcher.test.ts`: solo `/api/agent` exacto queda fuera del
  `proxy`; UI, otras APIs, `/api/agentx`, `/api/agent/sub`, `_next/static`,
  `_next/image` y favicon siguen protegidos.
- `lib/ea10-verificador-http.test.ts`: ciclo de vida del verificador HTTP con un
  servidor Node falso (no Next): servidor correcto → 0; sin clave utilizable, puerto
  ocupado (sin lanzar nada ni tocar al ocupante), hijo que falla tras la sonda
  mientras otro servidor responde 401/413, hijo que muere durante la prueba, hijo
  que no responde (GET o POST) y recurso estático ausente → falla; y que el PID
  lanzado queda muerto siempre, incluso si ignora SIGTERM (SIGKILL).

**Verificación HTTP local (P1 #2)** con `scripts/verificar-ea10-http.mjs` (fuera
de `pnpm test`, necesita `pnpm build` previo). Uso, con la clave OBLIGATORIA
porque el script fuerza producción: `APP_PASSWORD=… node
scripts/verificar-ea10-http.mjs` (puerto con `PUERTO_EA10`, 3218 por defecto).
Escucha solo en 127.0.0.1, no arranca si el puerto está ocupado, da por válido el
servidor únicamente si el proceso que lanzó imprime su señal de listo y sigue
vivo durante toda la prueba, acota cada petición con plazo y al terminar detiene
solo ese PID (SIGTERM y, si no sale a tiempo, SIGKILL; espera la salida real).
Comprueba: `POST /api/agent` con cuerpo `chunked` que supera la cota sin terminar
de enviarse → **HTTP 413 tras ~4012 bytes** (cota 4000); sin credencial,
`/api/agent` GET y POST, `/api/transmilenio`, `/` y un JS existente de
`/_next/static/chunks/` → **401**; el mismo JS con la clave → 200.

**Mutaciones comprobadas** (revertir el arreglo → falla la prueba/verificación →
restaurar):

| Mutación | Resultado |
| --- | --- |
| Producción abierta sin clave (quitar `cerrado-sin-clave`) | falla «producción FALLA CERRADO» |
| Quitar el corte por bytes en `leerCuerpoLimitado` | la lectura del stream infinito no termina (cuelga): la cota evita el agotamiento de recursos |
| Quitar el rechazo por cardinalidad (siempre crear entrada) | fallan 3 de 5 pruebas de cardinalidad |
| Volver a `await lector.cancel()` (P1 #1) | falla la regresión de `tee()` (el 413 queda pendiente; el plazo lo detecta) |
| Quitar `api/agent` del `matcher` del `proxy` (P1 #2) | la verificación HTTP chunked NO recibe 413 antes de terminar (status 0 tras ~20 KiB): el clon del proxy almacena el cuerpo |
| Volver a excluir `_next/static` del `matcher` | falla `ea10-proxy-matcher.test.ts` y el verificador HTTP real: `GET /_next/static/chunks/….js sin credencial: se esperaba 401; fue 200` |
| Verificador con el puerto ocupado por otro servidor que responde 401/413 | sale con 1 antes de lanzar nada (el script anterior salía con 0 si su hijo fallaba por `EADDRINUSE`) |

### Puertas sobre el código final (portátil Linux)

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: 340/340 correctas, 0 falladas, 0 canceladas.
- `pnpm build`: salida 0 (incluye `ƒ Proxy (Middleware)`); verificador HTTP real
  sobre ese build: salida 0 con 413 y 401 en todas las rutas, y sin proceso ni
  puerto residual.
- `pnpm verificar http://127.0.0.1:32136`, con autenticación: 9/9 pruebas
  correctas en Chrome. Cámara, micrófono y ubicación usan los dispositivos y
  permisos simulados del verificador; no acredita VoiceOver ni sensores físicos.
- Comprobación HTTP adicional: en producción con clave vacía o solo espacios,
  API GET/POST, UI, catálogo y recurso estático existente devuelven 503.
- La prueba PowerShell del instalador se conserva en la integración continua;
  el portátil no tiene `pwsh` y no se accedió a Windows.

## Límites

- **Proxy real sin verificar.** No se midió si Render (ni ningún proxy) reescribe
  `x-forwarded-for`. `claveCliente()` no deriva identidad de cabeceras; la cuota
  es conservadora. Confiar en una cabecera requiere la medición de EA-14/#40. La
  prueba de identidad es sintética y no certifica el proxy.
- **Cuota local, no global.** El contador es de una sola instancia en memoria. No
  es cuota global ni persistente; un reinicio del proceso la pierde. Sin Redis.
- **Verificación HTTP contra `next start` local, no contra Render.** El 413 por
  cuerpo chunked se probó con el servidor de producción de Next en loopback
  (`scripts/verificar-ea10-http.mjs`), no contra el runtime de Render ni con la
  topología de proxy real; esa parte sigue pendiente de EA-14/#40.
- **El verificador reconoce a su servidor por la línea «Ready in»/«Local:» de
  Next.** Si una versión futura de Next cambia ese texto, el script fallará por
  plazo (falla cerrado, no da un falso verde) y habrá que ajustar `senalListo`.
