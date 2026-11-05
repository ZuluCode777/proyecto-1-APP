# EA-10 (#36): acotar recursos y verificar autenticación antes de exponer

Rama `ea-10-recursos-autenticacion`, desde `origin/main` 809ee39 (con EA-05 a
EA-08 fusionados). Implementado con Kiro CLI en Linux, para revisión
independiente (especificación y estándares). No se modificaron la copia operativa
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

### Criterio 2 — lectura del cuerpo por stream con cota real de bytes

El manejador leía `await req.text()` (acumula TODO antes de medir) y comparaba
`.length` en unidades UTF-16, no bytes. Ahora `lib/cuerpo-peticion.ts`
(`leerCuerpoLimitado`) lee el `ReadableStream` nativo por trozos con `getReader`,
cuenta BYTES y, al superar `MAX_BODY_BYTES` (4000), corta y cancela el stream
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

### Criterio 3 — contador con cota de cardinalidad, no solo expiración

`lib/rate-limit.ts` antes solo limpiaba entradas VENCIDAS al pasar de un tamaño;
un aluvión de claves NUEVAS dentro de la ventana (p. ej. una cabecera de proxy
inventada por petición) hacía crecer el mapa sin tope, porque no había nada
vencido que limpiar. Ahora, al alcanzar `maxKeys` (5000 por defecto), una clave
NUEVA se rechaza con **429** y `Retry-After` (`motivo: "cardinalidad"`), tras
purgar primero las vencidas (recuperar espacio por expiración es legítimo). Nunca
se desaloja una entrada ACTIVA, de modo que un rechazo no se puede «reiniciar»
desalojando la entrada que lo cuenta; una clave recupera cuota solo cuando su
ventana vence. Sigue siendo contador local de una sola instancia: no se añadió
Redis ni se promete cuota global o persistente (alcance demo). La firma de
`rateLimit` se conserva; solo se enriquece el resultado con `motivo`.

### Criterio 4 — identidad del cliente conservadora (proxy pendiente de verificar)

`lib/identidad-cliente.ts` (`resolverIdentidad`) reemplaza la confianza ciega en
el PRIMER `x-forwarded-for`/`x-real-ip`. Esas cabeceras las puede escribir
cualquiera; solo son fiables detrás de un proxy que las reescriba de forma
conocida. Política (hasta verificar el proxy real, EA-14/#40):

- Por defecto (`saltosConfiables = 0`) NO se confía en ninguna cabecera
  reenviada: identidad `sin-verificar`, y TODAS esas peticiones comparten UNA
  clave acotada (`CLAVE_SIN_VERIFICAR`). Así, sin proxy comprobado, nadie obtiene
  cuota propia inventando cabeceras ni infla la cardinalidad, y la cota es
  conservadora. Comportamiento acotado cuando no hay identidad validada.
- Si algún día se declara un proxy de confianza (número de saltos que añade a
  `x-forwarded-for`), la IP del cliente se toma contando ESE número de saltos
  desde la DERECHA de la cadena, nunca el primer valor de la izquierda. Si la
  cadena no cubre la topología declarada, se degrada a `sin-verificar`.

**No se afirma que Render reescriba ninguna cabecera.** Su verificación real
queda PENDIENTE de EA-14/#40, antes de exponer. Las pruebas de este criterio son
sintéticas y no certifican el proxy.

**Matriz/cadena a medir en EA-14/#40** (antes de subir `saltosConfiables`):

| A medir en el despliegue real | Qué confirmar |
| --- | --- |
| ¿Render antepone su salto a `x-forwarded-for`? | Que exista y sea consistente |
| Nº de proxies de confianza en la ruta hasta la app | Fijar `saltosConfiables` = ese número |
| ¿Puede un cliente inyectar saltos extra? | Que no muevan el salto contado desde la derecha |
| `x-real-ip`: ¿lo escribe el proxy o el cliente? | No usarlo como identidad si lo puede escribir el cliente |

**Reversión que suspende la exposición:** mientras `saltosConfiables = 0`, toda
identidad es acotada (comportamiento seguro). Si una medición resultara dudosa,
se mantiene en 0 (o se vuelve a 0) y la cuota sigue siendo conservadora; combinado
con el criterio 1 (producción sin clave = 503), la reversión segura suspende la
exposición.

### Criterio 5 — alcance demo de una sola instancia y pruebas de helpers tocados

Se conserva la premisa de una sola instancia con contador local (sin Redis). Se
buscaron todos los llamadores de los helpers tocados: `estaAutorizado`
(`proxy.ts`, `lib/access.test.ts`), `clientKey`/`rateLimit`/lectura de cuerpo
(`app/api/agent/route.ts`), y los tests del endpoint real
(`lib/ea07-asistente-ubicacion.test.ts`, `lib/ea08-reglas-cancelacion.test.ts`).

`lib/ea08-reglas-cancelacion.test.ts` fabricaba un `x-forwarded-for` distinto por
petición para no compartir cuota entre pruebas. Con la política conservadora esa
cabecera ya no es identidad (todo colapsa a `sin-verificar`), así que esa técnica
simulaba identidades que el servidor no debe creer. Se adaptó SIN debilitar la
cobertura: el endpoint expone `__reiniciarLimitePeticiones()` (solo para pruebas,
documentado y sin uso en producción) y los tests reinician el contador entre
casos para aislarse, en vez de inventar cabeceras. Lo mismo en
`lib/ea07-asistente-ubicacion.test.ts`. El 429 real se cubre aparte
(`lib/ea10-endpoint.test.ts`) sin ocultar el límite.

## Evidencia

Pruebas con `node:test` y reloj/stream/`fetch` simulados, sin dependencias
nuevas:

- `lib/ea10-autenticacion.test.ts`: `claveUtilizable` (whitespace), fallar
  cerrado en producción, desarrollo abierto, 401/acceso con clave, y clave válida
  con espacios no alterada.
- `lib/ea10-cuerpo-peticion.test.ts`: trozos, UTF-8 multibyte partido, cota de
  bytes (no caracteres), `Content-Length` ignorado, error y cancelación → `error`.
- `lib/ea10-rate-limit-cardinalidad.test.ts`: tope de cardinalidad (429), clave
  conocida no bloqueada por el tope, desalojo solo por expiración, cuota no
  reiniciada por desalojo, aluvión acotado.
- `lib/ea10-identidad-cliente.test.ts`: sin confianza por defecto, cabeceras
  inventadas colapsan a una clave, salto correcto desde la derecha con proxy
  declarado, degradación conservadora. (Sintéticas; no certifican el proxy.)
- `lib/ea10-endpoint.test.ts`: endpoint real → 413 (cuerpo grande), 400 (error de
  lectura, sin 500), 200 válido y 429 + `Retry-After`, todos con contrato
  `AgentReply`.

**Mutaciones comprobadas** (revertir el arreglo → falla la prueba que lo cubre →
restaurar):

| Mutación | Resultado |
| --- | --- |
| Producción abierta sin clave (quitar `cerrado-sin-clave`) | falla «producción FALLA CERRADO» |
| Quitar el corte por bytes en `leerCuerpoLimitado` | la lectura del stream infinito no termina (cuelga): evidencia de que la cota evita el agotamiento de recursos |
| Quitar el rechazo por cardinalidad (siempre crear entrada) | fallan 3 de 5 pruebas de cardinalidad |

### Las cuatro puertas sobre el código final (sandbox Linux)

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: **309** pruebas correctas, 0 falladas, **17 canceladas**. Las 17
  cuelgan en cascada (`cancelledByParent`) de UN fallo PREEXISTENTE y ambiental,
  no introducido por este trabajo: `AC2 (endpoint real): frase desconocida con
  modelo colgado…` en `lib/ea08-reglas-cancelacion.test.ts`, que depende de un
  temporizador de aborto de ~2 s del Ollama simulado y en este sandbox termina
  como «Promise resolution is still pending but the event loop has already
  resolved». Se reprodujo en `origin/main` 809ee39 ANTES de cualquier cambio (17
  canceladas) y aislando el archivo (pass 2, cancelled 17). Los demás tests del
  endpoint real pasan al ejecutarlos sin ese caso flaky como primero.
- `pnpm build`: salida 0 (incluye `ƒ Proxy (Middleware)`).
- `pnpm verificar`: **no corre en el sandbox**. Comando: `pnpm verificar`. Error:
  «No encontré Chrome. Indica la ruta con CHROME_PATH.» (salida 2). No hay Chrome
  ni Chromium instalados ni `pwsh`/`powershell`. No se alteró el script ni la CI
  para forzar que pase. La verificación de extremo a extremo con navegador real
  queda pendiente de un entorno con Chrome.

## Límites

- **Proxy real sin verificar.** No se midió si Render (ni ningún proxy) reescribe
  `x-forwarded-for`. `saltosConfiables = 0` por defecto; la identidad es acotada.
  Subirlo requiere la medición de EA-14/#40. Las pruebas de identidad son
  sintéticas y no certifican el proxy.
- **Cuota local, no global.** El contador es de una sola instancia en memoria. No
  es cuota global ni persistente; un reinicio del proceso la pierde. Sin Redis.
- **Sin navegador ni PowerShell en el sandbox.** `pnpm verificar` no se ejecutó
  (sin Chrome); no hay `pwsh`. La prueba PowerShell del instalador permanece en
  CI, intacta.
- **Fallo preexistente de pruebas.** El caso AC2 «modelo colgado» cuelga en este
  sandbox por tiempos del event loop; no se tocó para no enmascararlo ni alterar
  la CI. Queda señalado arriba.
- **413/400 no probados contra Render.** El comportamiento del cuerpo por stream
  se probó con streams sintéticos y el endpoint en proceso, no contra el runtime
  de Render ni con cargas reales de red.
