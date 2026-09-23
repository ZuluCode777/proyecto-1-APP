# TransMiVoz

> **Estado: MVP para la entrega del proyecto de clase, viernes 2026-09-25.**
> El objetivo es mostrar funcionalidad mínima pero real, no un producto
> terminado. El alcance está en el issue fijado #6.

Cliente accesible de TransMilenio, Bogotá, pensado para personas con
discapacidad visual. Se generó originalmente con v0; ahora se desarrolla y se
aloja desde este repositorio. Ver [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)
para correrlo en Windows y [docs/DEMO.md](docs/DEMO.md) para la presentación.

La app tiene dos modos. Se eligen desde el menú y se guardan en `localStorage`:

- **Baja visión**: botones grandes, temas de alto contraste y fluorescente, una
  lupa con la cámara y una pantalla de búsqueda con botón de voz.
- **Ceguera total**: no hace falta ver la pantalla. Un solo botón que ocupa toda
  la pantalla, escucha, responde en voz alta y navega por la persona.

Todas las pantallas hablan. Resultados de rutas, indicaciones del GPS, errores y
cambios de modo pasan por `SpeechSynthesis` en `es-CO`.

## Funciones

| Función | Dónde | APIs del navegador |
| --- | --- | --- |
| Asistente de voz | `components/total-agent.tsx` | `SpeechRecognition`, `SpeechSynthesis`, `navigator.vibrate` |
| Búsqueda por voz | `components/voice-overlay.tsx` | `SpeechRecognition` |
| GPS auditivo | `components/auditory-gps.tsx` | `Geolocation.watchPosition`, `DeviceOrientation` |
| Asistente visual | `components/vision-assist.tsx` | `getUserMedia` (cámara trasera) |
| Búsqueda de rutas y frecuentes | `components/route-list.tsx`, `lib/routes.ts` | — |
| Líneas de emergencia | `components/assistance.tsx` | enlaces `tel:` |

## Los datos de rutas son de demostración

`lib/routes.ts` no contiene datos oficiales de TransMilenio. Los códigos de ruta
y sus paradas son inventados, y las coordenadas de las estaciones son
aproximadas. Como la app lee esto en voz alta a personas que no pueden
comprobarlo en pantalla, cada anuncio hablado de rutas termina con
`DEMO_DATA_NOTICE`, y la pantalla de resultados muestra el mismo aviso.

Hay datos reales disponibles: el servicio ArcGIS de TransMilenio publica las 153
estaciones troncales, sin clave de API. Reemplazar los datos de demostración es
opcional para el MVP.

## Cómo funciona el asistente

Hay dos implementaciones, y la que se usa puede no ser la que uno espera.

**`lib/local-agent.ts` es la que corre hoy.** Es un intérprete por reglas: quita
las tildes, busca palabras clave para el GPS y las rutas frecuentes, reconoce el
nombre de una estación conocida y, si no, hace una búsqueda de rutas. Sin red,
sin modelo, sin clave de API. Funciona sin internet, lo que importa dentro de un
bus.

**`app/api/agent/route.ts` es la versión aspiracional.** Le pide a Gemini 3.5
Flash, a través del Vercel AI Gateway, una respuesta estructurada
`{ reply, action, query }`, para que el asistente entienda frases que las listas
de palabras clave no cubren. No está conectada: sin `AI_GATEWAY_API_KEY` el
gateway responde

```
GatewayError: Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.
```

y la ruta lo captura y devuelve `interpretCommand(message)` con estado 200.

Ese respaldo es intencional y vale la pena conservarlo: el agente por reglas es
el piso sobre el que se apoya el producto, y el modelo es una mejora encima, no
una dependencia. Si se quita la capa del modelo, la app sigue funcionando. Sirve
para mostrar lo que el producto podría hacer si llegara al mercado. Conectar un
modelo local con Ollama está en el issue #3 y queda fuera del MVP.

## Cómo correrlo

Requiere Node 24 y pnpm.

```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm build
pnpm start
pnpm test    # node --test, sin framework de pruebas
```

`http://localhost` es un contexto seguro, así que el micrófono, la cámara y la
geolocalización funcionan en desarrollo local. **No** funcionan por HTTP simple
desde otro dispositivo de la red, por ejemplo `http://192.168.1.5:3000`. Para
eso se usa Tailscale; ver [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

Usar Chrome. Firefox no tiene `SpeechRecognition`, así que los modos de voz no
funcionan ahí.

## Estructura

```
app/
  api/agent/route.ts   asistente con modelo, con respaldo local
  layout.tsx           metadatos, fuentes, es-CO
  page.tsx             renderiza TransMiVozApp
components/            un archivo por pantalla, más el marco y las superposiciones
hooks/use-speech.ts    envoltorios de SpeechSynthesis y SpeechRecognition
lib/geo.ts             distancia haversine, rumbo, indicaciones habladas
lib/routes.ts          estaciones y rutas de demostración, estación más cercana
lib/local-agent.ts     intérprete de comandos por reglas
lib/rate-limit.ts      límite de peticiones por IP para la API
docs/                  alojamiento en Windows y guion de la presentación
.claude/skills/        skills de agente seleccionadas para este repositorio
```
