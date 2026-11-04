# EA-02 (#28): prototipo desechable del rediseño accesible del iPhone

**Prototipo desechable. No es la app TransMiVoz.** Compara dos estructuras de interfaz para el futuro cliente iPhone, con la misma información y los mismos estados, antes de construir las vistas SwiftUI de [#43](https://github.com/ZuluCode777/proyecto-1-APP/issues/43). Un único archivo HTML, sin dependencias, sin red y sin guardado. Datos de ejemplo; accesorio, ubicación, cámara, audio y permisos de iOS están simulados.

| Archivo | Contenido |
| --- | --- |
| [prototipo.html](prototipo.html) | El prototipo, con las variantes A y B y un panel para el facilitador. |
| [plan-de-trabajo.md](plan-de-trabajo.md) | Pasos, quién hace cada uno y qué no se puede hacer en el sandbox. |
| [especificacion-accesibilidad.md](especificacion-accesibilidad.md) | Lectura y foco, Dynamic Type, controles, contraste, audio, baja visión, cancelación, permisos y avisos. |
| [evaluacion-y-decision.md](evaluacion-y-decision.md) | Pregunta, versión, mediciones, comparación, cambios, recomendación provisional y decisión pendiente. |
| [guion-sesiones-usuarios.md](guion-sesiones-usuarios.md) | Consentimiento, tareas y registro para sesiones con participantes. |
| [comprobaciones/](comprobaciones/) | Guiones de Playwright usados para medir. |
| [capturas/](capturas/) | Siete capturas de Chromium a 390×844. No prueban VoiceOver. |

## Abrir

- **En un computador:** doble clic en `prototipo.html`. Se abre en el navegador sin servidor.
- **En el iPhone:** desde un Mac en la misma red Wi-Fi, en esta carpeta:

  ```bash
  python3 -m http.server 8000
  ```

  En Safari del iPhone, abrir `http://<IP-del-Mac>:8000/prototipo.html?variante=A&panel=0`. Detener el servidor con Ctrl+C al terminar. No publicarlo en Internet.

## Parámetros de la dirección

| Parámetro | Valores | Efecto |
| --- | --- | --- |
| `variante` | `A`, `B` | A: una acción principal. B: pestañas y lista de estados. Por omisión, A. |
| `escenario` | `T1` … `T10` | Prepara una tarea del [guion](guion-sesiones-usuarios.md). Siempre empieza en Inicio. |
| `panel` | `0` | Oculta el panel del facilitador para sesiones con participantes. |
| `texto` | `100`, `135`, `200`, `310` | Tamaño de texto simulado. |
| `bajavision` | `1` | Activa el modo de baja visión. |

## Panel del facilitador

Debajo del iPhone simulado, con estilo distinto para no confundirlo con el diseño. Permite cambiar de variante y de tarea, simular servidor caído, 401, 429 o catálogo viejo, evidencia vencida, hora fuera de horario, anuncio de ejemplo, calidad de la ubicación, permisos, mediciones y desconexión del accesorio, y la salida de audio. «Comprobar accesibilidad de la pantalla» mide la pantalla actual: tamaño de controles, nombres, contraste, desbordes, palabras partidas y estados sin palabra.

## Áreas

Inicio, Rutas y viaje, Metro (escenario futuro), Ubicación y orientación, Asistente, Avisos, Accesorio, Ajustes y ayuda, y Lupa. En B también existe «Más».

## Límites

- Las capturas y el árbol de Chromium no prueban VoiceOver. El prototipo tampoco es la app terminada.
- El orden de lectura de Safari para iOS puede diferir del de SwiftUI.
- Al decidir, la variante ganadora se reescribe en SwiftUI en #43; el HTML no pasa a producción.
