# TransMiVoz

Accessible client for TransMilenio, Bogotá, aimed at people with a visual
disability. Originally generated with v0; now developed and self-hosted from
this repository. See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for running it
on Windows.

The app has two modes, chosen from the menu and remembered in `localStorage`:

- **Baja visión** — large targets, high-contrast and fluorescent themes, a
  camera magnifier, and a search screen with a voice button.
- **Ceguera total** — no screen reading required. One full-screen tap target
  that listens, answers aloud, and navigates for you.

Every screen speaks. Route results, GPS instructions, errors and mode changes
all go through `SpeechSynthesis` in `es-CO`.

## Features

| Feature | Where | Browser APIs |
| --- | --- | --- |
| Voice assistant | `components/total-agent.tsx` | `SpeechRecognition`, `SpeechSynthesis`, `navigator.vibrate` |
| Voice search | `components/voice-overlay.tsx` | `SpeechRecognition` |
| Auditory GPS | `components/auditory-gps.tsx` | `Geolocation.watchPosition`, `DeviceOrientation` |
| Vision assistant | `components/vision-assist.tsx` | `getUserMedia` (rear camera) |
| Route search and favourites | `components/route-list.tsx`, `lib/routes.ts` | — |
| Emergency lines | `components/assistance.tsx` | `tel:` links |

## The route data is demo data

`lib/routes.ts` is not official TransMilenio data. The route codes and their
stops are invented, and the station coordinates are approximate. Because the
app reads this aloud to people who cannot check it on screen, every spoken
announcement of routes ends with `DEMO_DATA_NOTICE`, and the results screen
shows the same warning visually.

Replacing this with the published GTFS feed from Datos Abiertos Bogotá is
tracked separately. Until that lands, treat the app as a demonstration of the
interaction, not as a travel planner.

## How the assistant actually works

There are two implementations, and the one in use may not be the one you
expect.

**`lib/local-agent.ts` is what runs today.** It is a rule-based interpreter:
it strips accents, matches keyword lists for GPS and favourites, looks for a
known station name, and falls back to a route search. No network, no model,
no API key. It works offline, which matters on a bus.

**`app/api/agent/route.ts` is the aspirational version.** It asks
Gemini 3.5 Flash through the Vercel AI Gateway for a structured
`{ reply, action, query }`, so the assistant could understand phrasing the
keyword lists miss. It is not wired up: with no `AI_GATEWAY_API_KEY` the
gateway answers

```
GatewayError: Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.
```

and the route catches it and returns `interpretCommand(message)` instead, with
status 200. Production does this for every request today.

That fallback is deliberate and worth keeping: the rule-based agent is the
floor the product stands on, and the model is an upgrade on top of it, not a
dependency. If the model layer is dropped entirely, the app keeps working. See
`.env.example` for how to turn the model layer on.

## Running it

Requires Node 24 and pnpm.

```bash
pnpm install
pnpm dev     # http://localhost:3000
pnpm build
pnpm start
pnpm test    # node --test, no test framework installed
```

`http://localhost` counts as a secure context, so the microphone, camera and
geolocation all work in local development. They do **not** work over plain
HTTP from another device on the network, for example `http://192.168.1.5:3000`.
Serving to a phone needs HTTPS.

Copy `.env.example` to `.env.local` if you want the model layer.

## Layout

```
app/
  api/agent/route.ts   the model-backed assistant, with a local fallback
  layout.tsx           metadata, fonts, es-CO
  page.tsx             renders TransMiVozApp
components/            one file per screen, plus the shell and overlays
hooks/use-speech.ts    SpeechSynthesis and SpeechRecognition wrappers
lib/geo.ts             haversine distance, bearing, spoken directions
lib/routes.ts          demo stations and routes, nearest-station search
lib/local-agent.ts     rule-based command interpreter
lib/rate-limit.ts      per-IP limiter for the API route
.claude/skills/        agent skills selected for this repo, see its README
```
