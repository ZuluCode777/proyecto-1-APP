# Running TransMiVoz on Windows

The app is a plain Next.js server. Nothing in it is specific to Vercel, so a
Windows machine can host it with no code changes. This is the setup we use.

## What you need

- **Node 24** — from nodejs.org. Check with `node --version`.
- **pnpm** — ships with Node via corepack: `corepack enable`
- **Git**
- **Tailscale**, if you want the app reachable from another device.

## First run

```powershell
git clone https://github.com/zulucode-design/visionaria
cd visionaria
corepack enable
pnpm install
pnpm build
pnpm start
```

Open `http://localhost:3000`.

`http://localhost` is a secure context, so the microphone, camera, geolocation
and compass all work in desktop Chrome. That is the whole app, so local
development needs nothing else.

## Reaching it from another device

`next start` binds `0.0.0.0` by default, so `http://<your-lan-ip>:3000` will
serve the page to a phone on the same network. **It will not work as an app.**
Plain HTTP on a LAN IP is not a secure context, so the browser refuses the
microphone, the camera and geolocation. You get a page with every feature
disabled.

Use Tailscale instead. It terminates TLS with a real certificate on a
`ts.net` hostname, which *is* a secure context:

```powershell
# bind the app to loopback only, so nothing is exposed on the LAN
pnpm exec next start -H 127.0.0.1 -p 3000

# in another terminal, publish it to the tailnet over HTTPS
tailscale serve --bg 3000
tailscale serve status
```

The app is then at `https://<machine>.<tailnet>.ts.net`, reachable from any
device signed in to the same tailnet, with working device permissions.

This needs **MagicDNS** and **HTTPS Certificates** enabled in the Tailscale
admin console under DNS. Without them there is no certificate to serve.

To expose it to the public internet instead of just the tailnet, swap `serve`
for `funnel`:

```powershell
tailscale funnel --bg 3000
```

Only do that for a demo, and turn it off afterwards with `tailscale funnel --https=443 off`.
There is no authentication in front of this app.

## Keeping it running

`pnpm start` dies when the terminal closes. To survive logout and reboot, use
Task Scheduler — no extra dependency:

1. Task Scheduler → **Create Task** (not "Basic Task").
2. General → **Run whether user is logged on or not**.
3. Triggers → New → **At startup**.
4. Actions → New → Start a program:
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000`
   - Start in: the repo folder, for example `C:\Users\you\visionaria`
5. Settings → untick **Stop the task if it runs longer than**.

Point the task at `node.exe` directly rather than at pnpm, so there is no shell
wrapper between the scheduler and the server.

`tailscale serve --bg` already persists across reboots, so it does not need its
own task.

## After pulling changes

```powershell
git pull
pnpm install
pnpm build
```

Then restart the task (Task Scheduler → right-click → End, then Run). The
running server holds the old build until it restarts.

## Connecting the local model

`app/api/agent/route.ts` currently asks for `google/gemini-3.5-flash`, which the
AI SDK routes through the Vercel AI Gateway. Without `AI_GATEWAY_API_KEY` that
call fails and the route falls back to the rule-based interpreter in
`lib/local-agent.ts`, which is what runs today.

Ollama on this machine can replace that. It serves an OpenAI-compatible API at
`http://localhost:11434/v1` and supports the structured output that
`generateObject` needs. Since the app and Ollama are on the same machine, no
network exposure is involved. See issue #3 for the wiring and the caveats.

## Things that no longer do anything

- `@vercel/analytics` in `app/layout.tsx` only reports to Vercel. Off Vercel it
  is inert. It is gated to production, so it does nothing in development either.
- `pnpm-workspace.yaml` carries v0 sandbox settings.

Both are noted in issue #1 rather than removed here.
