# Comprobaciones del prototipo EA-02

Guiones de Playwright usados para la [evaluación](../evaluacion-y-decision.md). Cada uno es una función `async (page) => {…}` con el marcador `__HTML__`, que `generar.mjs` sustituye por el prototipo.

| Guion | Qué mide | Resultado en la versión 0.1 |
| --- | --- | --- |
| `barrido.js` | 355 combinaciones de variante, estado, tamaño de texto y baja visión: controles ≥ 44×44, nombres accesibles, contraste ≥ 7:1, desbordes, estados sin palabra, título y foco. También palabras partidas, franjas fijas, red y errores. | 0 fallos; contraste mínimo 17,31:1; 0 peticiones de red. |
| `invariantes.js` | 43 pruebas de comportamiento: cancelaciones, respuestas tardías, foco, vencimiento de datos, ubicación, abordaje, Metro, paridad A/B, texto equivalente, permisos, Escape, teclado y franjas fijas. | 43/43. |
| `tareas.js` | Deslizamientos y activaciones de VoiceOver, aproximados, en diez tareas por variante. | A 155 / 24; B 292 / 26. |

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
