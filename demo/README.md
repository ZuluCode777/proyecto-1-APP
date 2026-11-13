# Videos de demostración

Videos de la app web y de la app del iPhone **tal como están en esta rama**,
con subtítulos. Los graba el workflow
[`grabar-demos.yml`](../.github/workflows/grabar-demos.yml) en GitHub Actions,
con cada push a la rama `demo/videos` o a mano desde la pestaña Actions. Los
videos quedan como artefacto `videos-transmivoz` de la ejecución durante 7 días.

No se graba nada en un teléfono real. La app web corre en Chrome sin ventana
y la del iPhone, en el iOS Simulator del runner de macOS.

## Qué hay en cada video

Cada MP4 es horizontal, de 1920 × 1080. La pantalla del teléfono va a la
izquierda, sin nada encima, y los subtítulos van en un panel a la derecha:

- **Título** (blanco): plataforma, función y fecha de grabación.
- **Lo que se hace** (amarillo), como «Toca «Rutas»» o «Escribe: «…»».
- **Aclaraciones** (gris, en cursiva), por ejemplo qué es simulado.
- **Lo que dice o muestra la app** (blanco):
  - en la web, «La app dice:» con la frase que la app lee en voz alta;
  - en el iPhone, «En pantalla:» con la respuesta o el estado que muestra;
  - en Ceguera total, «La persona dice (voz simulada en la grabación):», en
    azul claro, con la frase de la persona.

En la web, un círculo rosa marca dónde se toca la pantalla.

| Video | Qué muestra |
| --- | --- |
| `web-01-diagnostico` | `/diagnostico`: «Probar todo» y el resultado de las nueve pruebas |
| `web-02-asistente-rutas` | Asistente: «¿qué puedes hacer?», «información de la B23» (abre el detalle) y «¿a qué hora pasa la H54?» |
| `web-03-asistente-viajes` | Asistente: «cómo llego de Ricaurte a Calle 72» (abstención sin paradas verificadas) y «cómo llego a Calle 72» con la ubicación como origen |
| `web-04-rutas` | Rutas: buscar A52, detalle con mapa, horario y estaciones, «Guardar» y Rutas frecuentes |
| `web-05-mapa-y-gps` | Mapa y GPS: activar la ubicación, estaciones cercanas, «Oriéntame por voz» y «Repetir indicación» |
| `web-06-lupa` | Lupa: aumento, los cuatro filtros, congelar y reanudar |
| `web-07-ceguera-total` | Modo Ceguera total: tocar la pantalla y hablar («información de la B23», «¿dónde estoy?») |
| `web-08-alto-contraste` | Tema Alto contraste en el inicio, las rutas frecuentes y un detalle |
| `web-09-metro` | Metro de Bogotá como escenario futuro: estado, estaciones de la Línea 1 y fuentes |
| `web-10-emergencia-y-avisos` | Emergencia (123, 156, 195) y los avisos del operador |
| `iphone-01-consulta` | Ajustes del servidor y Consulta con el backend real: «recorrido de la B23», «horario de la H54», «quiero ir de Ricaurte a Calle 72» |
| `iphone-02-metro` | Consulta con el selector «Metro (futuro)»: «estaciones» y «Puente Aranda» |
| `iphone-03-sesion-accesorio` | Pestaña Sesión: buscar, permiso, elegir, iniciar, bloqueo por enlace no verificado, detener y reconectar |
| `iphone-04-lupa` | Lupa: explicación del permiso, aumento, filtros y congelar |
| `iphone-05-ajustes` | Ajustes: servidor, Preferencias, Favoritas y Ayuda |

## Qué es real y qué no

Real:

- Las dos apps son el código de esta rama, compilado en el runner. La web es
  `pnpm build` + `pnpm start`, con clave, como en producción.
- Los datos de TransMilenio salen del servicio en vivo, o de la copia guardada
  si no responde. Las respuestas del asistente son las del código actual. En la
  Consulta del iPhone (`iphone-01`, `iphone-02`, `iphone-05`) la app no usa
  ningún modo de prueba: habla con ese mismo backend por HTTPS.
- El mapa usa OpenStreetMap en vivo.

Simulado, y los subtítulos lo dicen:

- **Sin sonido.** La grabación del navegador y la del Simulator no captan
  audio. En la web, lo que la app diría en voz alta sale como subtítulo, con
  una duración estimada de 14 caracteres por segundo.
- **Sin micrófono.** En la web las preguntas se escriben. En Ceguera total, la
  frase de la persona la pone el script con un `SpeechRecognition` falso
  (`demo/web/navegador/reconocimiento-simulado.js`); todo lo demás es la app.
- **Ubicación fija** en la estación Ricaurte (4.6124, -74.0935), la misma de
  `pnpm verificar`. Chrome sin ventana no tiene brújula.
- **Cámara.** En la web, Chrome muestra un letrero de estación inventado
  (`demo/web/camara-letrero.sh`). En el iPhone, el Simulator no tiene cámara:
  la Lupa usa su imagen sintética rotulada y los filtros no la cambian.
- **Accesorio.** El Simulator no tiene Bluetooth. La pantalla de Sesión es la
  de producción con el transporte sintético rotulado de las pruebas de
  interfaz; por eso el enlace queda «no verificado» y la app bloquea los avisos.
- **Sin Ollama.** El asistente responde con las reglas («Motor: reglas»).
- **HTTPS de grabación.** El backend del iPhone va detrás de
  `demo/servidor-https.mjs`, con un certificado propio que solo se instala en
  el Simulator del runner.

## Cómo se graba

- **Web** (`demo/web/grabar.mjs`): Playwright con Google Chrome sin ventana,
  390 × 844 a doble densidad, `es-CO`, hora de Bogotá. Inyecta tres scripts
  antes de cargar la app (`demo/web/navegador/`): la voz como subtítulo, el
  indicador de toques y, solo en Ceguera total, el reconocimiento simulado.
- **iPhone** (`demo/ios/grabar.sh` y `demo/ios/DemoVideosUITests.swift`): el
  Simulator «iPhone 17» de Xcode 26.6. La clase de demostración se copia a
  `ios/TransMiVozUITests/` solo en el runner, antes de compilar, y no cambia la
  suite de pruebas del proyecto. Cada recorrido se graba con
  `xcrun simctl io … recordVideo`.
- **Composición** (`demo/componer.py`): recorta cada grabación al recorrido, la
  pone en el lienzo de 1920 × 1080 con el panel de subtítulos (ASS con libass)
  y escribe una hoja de miniaturas por video y `indice.md`.

Para volver a grabar solo una plataforma, el mensaje del commit puede llevar
`[solo web]` o `[solo iphone]` (en cualquier parte del mensaje, así que no se
mencionan los dos a la vez). Cada plataforma cancela solo su propia grabación
anterior en curso.

Para grabar en local hacen falta Chrome o Xcode, ffmpeg y la app compilada.
Los comandos son los mismos del workflow.
