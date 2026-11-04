# Comprobaciones del prototipo EA-02

Guiones de Playwright usados para la [evaluación](../evaluacion-y-decision.md). Cada uno es una función `async (page) => {…}` con el marcador `__HTML__`, que `generar.mjs` sustituye por el prototipo.

| Guion | Qué mide | Resultado en la versión 0.2 (HeadlessChrome 151.0.7922.10, Noto Sans) |
| --- | --- | --- |
| `barrido.js` | 395 combinaciones de variante, estado, tamaño de texto y baja visión: controles ≥ 44×44, nombres accesibles y sin repetir, contraste ≥ 7:1, desbordes, estados sin palabra, título y foco. También palabras partidas, franjas fijas, red, errores y el entorno (navegador y fuente). | 0 fallos; contraste mínimo 17,31:1; 0 peticiones de red. Palabras partidas al 310 %: 31 en 24 de 39 pantallas (A) y 29 en 24 de 40 (B); dependen de la fuente. |
| `invariantes.js` | 64 pruebas de comportamiento: cancelaciones, respuestas tardías, foco, desplazamiento y «details» tras eventos (con texto visible y temporizadores reales), secuencia de T9, vencimiento de datos, ubicación, abordaje, procedencia, «Actualizar datos», Metro, paridad A/B, texto equivalente, permisos, Escape, teclado y franjas fijas. Devuelve `pruebas`, `aprobadas` y, aparte, `datos` con mediciones. | 64/64; `datos`: 5 pulsaciones de Tab en A y 11 en B. |
| `tareas.js` | Deslizamientos y activaciones de VoiceOver, aproximados, en diez tareas por variante. | A 174 / 31; B 311 / 33. |

## Ejecutar

Con Node 22 o posterior:

```bash
node generar.mjs barrido /tmp/barrido.js
```

Ejecutar el resultado en Chromium con Playwright, con la ventana de 390×844 que fija el propio guion:

- con Playwright MCP, mediante `browser_run_code` y el archivo generado;
- con Playwright en Node: `await (eval(require('fs').readFileSync('/tmp/barrido.js', 'utf8')))(page)`.

El repositorio no instala Playwright: estas comprobaciones no forman parte de `pnpm test`.

Limitación: el recorrido de tareas cuenta el orden lineal de lectura que se deduce del DOM. VoiceOver real puede agrupar elementos de otra forma y ofrece atajos, como el rotor.
