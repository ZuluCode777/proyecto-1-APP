# TransMiVoz

> **Estado: MVP para la entrega del proyecto de clase, viernes 2026-09-25.**
> El alcance está en el issue fijado #6. Para comprobar que todo funciona,
> abre `/diagnostico` o corre `pnpm verificar`.

**App en línea:** <https://desktop-oa6r547.taila37867.ts.net>
([diagnóstico](https://desktop-oa6r547.taila37867.ts.net/diagnostico)).
Se sirve desde la máquina con Windows por Tailscale Funnel y pide una clave:
el usuario puede ser cualquiera, y la clave la tiene Nicolás. Usa Chrome:
Firefox no reconoce la voz.

Cliente accesible de TransMilenio, Bogotá, pensado para personas con
discapacidad visual. Usa los datos abiertos reales de TransMilenio, un mapa con
OpenStreetMap y un asistente que entiende preguntas en español y muestra los
pasos que sigue para responder.

Se generó originalmente con v0; ahora se desarrolla y se aloja desde este
repositorio. Ver [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) para correrlo en
Windows y [docs/DEMO.md](docs/DEMO.md) para la presentación.

## Los dos modos

Se eligen desde el menú y se guardan en el navegador.

- **Baja visión**: cinco opciones grandes y sin texto pequeño. El tema claro
  es el esquema "cabecera lima": pantalla blanca, cabecera lima, un neón
  distinto por botón, letra negra (al menos 7:1) y contornos negros gruesos.
  El único tema oscuro es "Alto contraste", negro con neón.
- **Ceguera total**: no hace falta ver la pantalla. Toda la pantalla es un
  botón que escucha, responde en voz alta y abre el resultado.

Todas las pantallas hablan en `es-CO`.

## Funciones

| Función | Qué hace | Dónde |
| --- | --- | --- |
| Asistente | Entiende "cómo llego de Ricaurte a Calle 72", "¿a qué hora pasa la H54?", "¿dónde estoy?". Planea viajes directos o con un transbordo y muestra cada paso | `lib/local-agent.ts`, `components/total-agent.tsx` |
| Rutas | Búsqueda por estación o código, detalle con recorrido, estaciones y horarios, y rutas frecuentes | `lib/routes.ts`, `components/route-detail.tsx` |
| Mapa | Recorrido de cada ruta, plan de viaje y estaciones cercanas, con Leaflet y OpenStreetMap | `components/transit-map.tsx` |
| GPS auditivo | Estación más cercana, indicaciones habladas según hacia dónde miras, aviso al llegar y enlace a Google Maps a pie | `components/auditory-gps.tsx` |
| Lupa | Cámara con zoom hasta 3x, cuatro filtros de contraste y congelar imagen | `components/vision-assist.tsx` |
| Emergencia | Llamadas al 123, 156 y 195 | `components/assistance.tsx` |
| Diagnóstico | Nueve pruebas en vivo de que todo lo anterior responde en este navegador | `app/diagnostico` |

## Datos reales de TransMilenio

La app consulta el servicio ArcGIS público de la Subgerencia de Planificación
de TransMilenio, que no pide clave de API:

- capa 2: 153 estaciones troncales
- capa 15: servicios; se usan los troncales en operación (124 rutas)

El servicio no publica qué estaciones atiende cada ruta. Se deducen por
geometría: las estaciones a menos de 60 m de la línea de la ruta, en orden de
recorrido. Son las estaciones por las que pasa el bus; un servicio expreso no
para en todas, y la app lo aclara.

La respuesta se guarda 6 horas en el servidor. Si el servicio no responde, la
app usa la copia de `data/transmilenio.json`, así que funciona aunque
TransMilenio esté caído. Para actualizar la copia:

```bash
pnpm sync:transmilenio
```

TransMilenio no publica la posición de los buses en tiempo real, así que la app
da horarios, no tiempos de llegada.

## Cómo funciona el asistente

Trabaja en dos pasos:

1. **Entender** la frase. Por reglas (`parseIntent`), o con un modelo local de
   Ollama si `OLLAMA_MODEL` está configurado (`lib/ollama.ts`).
2. **Resolver** con herramientas sobre los datos reales (`runIntent`): buscar
   estaciones, planear el viaje, leer el recorrido o el horario, usar la
   ubicación como origen.

El modelo solo clasifica la frase y extrae nombres. Las rutas, estaciones y
horarios salen siempre de los datos, y cualquier nombre que devuelva el modelo
se valida contra ellos. Si Ollama no responde o devuelve algo que no cuadra,
el asistente usa las reglas. Sin Ollama, funciona igual, solo con las reglas.

## Cómo correrlo

Requiere Node 24 y pnpm.

```bash
pnpm install
pnpm dev                 # http://localhost:3000
pnpm build
pnpm start
pnpm test                # pruebas unitarias con node --test
pnpm verificar           # prueba de extremo a extremo en Chrome, contra localhost:3000
pnpm sync:transmilenio   # actualiza la copia de los datos
```

Para usar Ollama, copia `.env.example` a `.env.local` y pon el modelo. En la
máquina con Windows la app usa su propia instancia de Ollama en el puerto
11435; ver [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

`http://localhost` es un contexto seguro, así que el micrófono, la cámara y la
ubicación funcionan en local. **No** funcionan por HTTP simple desde otro
dispositivo, por ejemplo `http://192.168.1.5:3000`. Para eso se usa Tailscale;
ver [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

Usa Chrome. Firefox no tiene `SpeechRecognition`, así que los modos de voz no
funcionan ahí.

## Cómo se comprueba

- `pnpm test`: pruebas unitarias del parser de ArcGIS, las búsquedas, la
  planificación de viajes, una tabla de frases del asistente, la validación de
  lo que devuelve Ollama y el límite de peticiones.
- `/diagnostico`: nueve pruebas en vivo en el navegador, con botón "Probar
  todo".
- `pnpm verificar`: corre `/diagnostico` en Chrome sin ventana, con cámara,
  micrófono y ubicación simulados.
- Integración continua en GitHub Actions: tipos, pruebas, compilación y
  `pnpm verificar` en cada cambio.

## Estructura

```
app/
  api/agent/route.ts         asistente: reglas u Ollama sobre los datos reales
  api/transmilenio/route.ts  estaciones y rutas, en vivo o desde la copia
  diagnostico/               pruebas en vivo de cada función
components/                  una pantalla por archivo, el mapa y los diálogos
data/transmilenio.json       copia de los datos para cuando el servicio falla
hooks/                       voz, datos compartidos y rutas favoritas
lib/
  transmilenio.ts            consulta y normalización del servicio ArcGIS
  routes.ts                  búsqueda, estaciones y planificación de viajes
  local-agent.ts             intenciones y herramientas del asistente
  ollama.ts                  interpretación con un modelo local
  geo.ts                     distancias, rumbos e indicaciones habladas
  text.ts                    normalización de texto hablado
scripts/                     sincronización de datos y verificación en Chrome
test/                        resolvedor de módulos para node --test
docs/                        alojamiento en Windows y guion de la presentación
.claude/skills/              skills de agente seleccionadas para este repositorio
```
