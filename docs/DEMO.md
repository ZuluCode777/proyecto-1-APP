# Demo runbook — Friday 2026-09-25

How to show TransMiVoz from the laptop, with the app served from the Windows
machine. Readiness is tracked in the demo readiness issue; general setup lives
in [SELF-HOSTING.md](SELF-HOSTING.md).

## The machines

| Role | Tailscale name | Tailscale IP |
| --- | --- | --- |
| Server (Windows) | `desktop-oa6r547` | `100.66.19.15` |
| Client (Fedora laptop) | `fedora` | `100.124.210.13` |

Tailnet: `taila37867.ts.net`

**Demo URL:** `https://desktop-oa6r547.taila37867.ts.net`

## Before leaving home

1. HTTPS certificates are enabled on the tailnet (issue #4). Without them there
   is no HTTPS, and without HTTPS the microphone, camera and GPS are refused.
2. The Windows machine will not sleep. Settings → System → Power → set sleep to
   **Never** while plugged in. A sleeping server ends the demo.
3. The laptop fallback is built and tested (see below).

## On the day

On the Windows machine, first terminal:

```powershell
cd visionaria
git pull
pnpm install
pnpm build
pnpm exec next start -H 127.0.0.1 -p 3000
```

Second terminal:

```powershell
tailscale serve --bg 3000
tailscale serve status
```

On the laptop:

1. Check the path: `tailscale ping desktop-oa6r547` should answer `pong`.
2. Open **Chrome** — not Firefox — at `https://desktop-oa6r547.taila37867.ts.net`.
3. Grant microphone, camera and location when asked.

Firefox has no `SpeechRecognition`, so both voice modes would load and do
nothing.

## Quick check before presenting

- Menu → **Ceguera total** → tap → say "quiero ir a Ricaurte" → it answers aloud with three routes.
- Menu → **Baja visión** → **Asistente visual** → camera feed appears.
- **GPS auditivo** → **Activar mi ubicación** → nearest stations listed.

## If the campus network blocks Tailscale

On the Windows machine:

```powershell
tailscale funnel --bg 3000
```

That publishes the app on a public HTTPS URL that any browser can open,
without a Tailscale client. It needs the same HTTPS certificates. There is no
authentication in front of the app, so turn it off right after:

```powershell
tailscale funnel --https=443 off
```

## If nothing reaches the Windows machine

Run the app on the laptop itself. No network involved.

```bash
cd visionaria
pnpm install
pnpm build
pnpm start
```

Chrome → `http://localhost:3000`. `localhost` is a secure context, so every
device API works.

This only helps if it was built beforehand. Do it once before Friday, so the
fallback is a single `pnpm start` on the day.

## Expected behaviour worth knowing

- **The assistant is rule-based.** Answers come from `lib/local-agent.ts`, not
  a model. See the README.
- **Route data is demo data.** Every spoken route answer ends with a notice
  saying so. That is intentional.
- **Some station names flood the answer.** `searchRoutes` keeps a route if any
  word matches, so shared words drag in unrelated routes. Known defect, issue #3.
  Measured with `interpretCommand`:

  | Say | Routes returned |
  | --- | --- |
  | "quiero ir a Héroes" | 1 — B12 |
  | "quiero ir a Marly" | 1 — B12 |
  | "quiero ir a Banderas" | 1 — D21 |
  | "quiero ir a Ricaurte" | 3 — K43, D21, C15, all correct |
  | "quiero ir a Calle 72" | 5 — "calle" matches Calle 100, Calle 45 and others |
  | "quiero ir a Portal Norte" | 8 — "portal" matches every route |

  Demo with the first four. Avoid anything containing "Portal" or "Calle".
- **Latency is about 120 ms** when Tailscale relays through DERP. On the same
  network it usually connects directly and gets faster.
