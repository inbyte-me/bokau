# Deploying a party server

A **party server** runs rooms only: the phone app, the party API and the rooms' media, behind your own domain with real
HTTPS. It never serves the studio (`DOBLAJE_MODE=party`: the studio's routes are not mounted at all). Friends open the
invite link on their phones; one of them creates the room and hosts it from their phone, no TV needed. Decisions:
[ADR 0009](adr/0009-party-server-and-clients-with-capabilities.md).

## What runs where
| | Local studio (`pnpm start`, desktop) | Party server (`DOBLAJE_MODE=party`) |
|---|---|---|
| Studio, library, TV page | yes (localhost only) | no |
| Phones | HTTPS listener on the Wi-Fi, self-signed certificate (`PARTY_PORT`) | the one listener, real HTTPS from your domain |
| Who creates a room | the TV, or a phone | a phone (rate limited per address) |
| Media of a room | kept as projects in the library | deleted when everyone has left |
| Clips | the library | the library in the data folder (see *Clips*) |

## The way it is deployed: Dokploy → Caddy → the app
```
client ──HTTPS──▶ Traefik (Dokploy: ports 80/443, the Let's Encrypt certificate) ──HTTP──▶ caddy:80 ──▶ app:5177
```
* **Dokploy's Traefik** owns the domain and the certificate. **Caddy**, in the compose stack, gets plain HTTP from it
  (`auto_https off`: it must not request certificates of its own), compresses, caps uploads at 700 MB and proxies to the app.
* **The app** serves the phone app, the API, the room's WebSocket (`/party/ws`) and the media. The media stays in the app on
  purpose: it is behind room tokens, and a sealed clip's working copy is decrypted there. Caddy does not serve files.
* **Two hops, so `TRUST_PROXY=2`** (the compose default): Caddy trusts the `X-Forwarded-*` headers Traefik sends
  (`trusted_proxies` in `deploy/Caddyfile`) and appends to them, and the app reads the visitor's address two entries from the
  end. The per-address limits depend on this: a wrong number makes everyone share one address (too strict) or lets visitors
  choose theirs (no limit).

Set up:
1. DNS: `bokau.askn.us` points at the Dokploy server.
2. Dokploy → Create service → **Compose** → this repository (`docker-compose.yml`).
3. Environment (Dokploy's Environment tab): `DOMAIN=bokau.askn.us` (required), `OPENROUTER_API_KEY`, and for accounts
   `AUTH_PROVIDER=workos`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, plus `LIBRARY_KEY` (docs/accounts.md).
   Use the **production** WorkOS keys here. Everything else has a default; the full list is below.
4. Dokploy → the service's **Domains** tab → add `bokau.askn.us`, service **`caddy`**, port **80**, HTTPS on (Let's Encrypt).
   Nothing in the compose file publishes a host port, so nothing collides with Traefik.
5. Put your prepared clips in the `party-data` volume (see *Clips*), then deploy.

Check: `https://bokau.askn.us/healthz` answers `{"ok":true,"mode":"party",…}`, and `https://bokau.askn.us/play/` opens the phone app.
To try the stack on your own machine: `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build`, then
`http://localhost:8080/play/` (that file adds the one local port; do not use it in Dokploy). The image and the compose file are
not run by the tests: build once before relying on them. Other proxies: `deploy/nginx.conf.example`, `deploy/Caddyfile.host`
(Caddy straight on a host, getting its own certificate).

## Without Docker
```
pnpm install --frozen-lockfile
pnpm --filter @doblaje/play build          # the phone app (the studio app is not needed)
DOBLAJE_MODE=party PARTY_URL=https://bokau.askn.us TRUST_PROXY=1 node apps/server/src/main.ts
```
Needs Node 24.11+ and `ffmpeg`. Put any reverse proxy with HTTPS in front (nginx, Caddy, a platform's router): it must
pass WebSockets (`/party/ws`), allow large request bodies (takes, the mix: 700 MB) and not buffer or time out them
(Caddyfile: `deploy/Caddyfile`). To serve HTTPS from the app itself instead, set `TLS_CERT` and `TLS_KEY` (paths to a
certificate and key you obtained, e.g. from Let's Encrypt).

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `DOBLAJE_MODE` | `studio` | `party` for a server of rooms only |
| `PORT`, `HOST` | `5177`, `0.0.0.0` (party) | where it listens |
| `PARTY_URL` | – | the public address; invite links use it |
| `TRUST_PROXY` | `0` (compose: `2`) | proxies in front; their `X-Forwarded-For` is believed this many hops (limits are per address) |
| `TLS_CERT`, `TLS_KEY` | – | serve HTTPS directly |
| `PARTY_MAX_ROOMS` | `20` | rooms open at once |
| `PARTY_CREATES_PER_HOUR` | `12` | rooms one address may open per hour |
| `PARTY_EMPTY_ROOM_MINUTES` | `5` | after the last person leaves, the room and its media are deleted |
| `PARTY_RETENTION_HOURS` | `24` | backstop: any round project older than this is deleted |
| `PARTY_TRANSCRIBE` | off | the server listens to takes itself (speech-to-text in Node; the model downloads on first use) |
| `OPENROUTER_API_KEY`, `SPEND_CAP_USD` | – , `3.5` | the AI (server only) and its cap for the whole server |
| `PARTY_AI_MODEL`, `PARTY_AI_FALLBACK` | `nvidia/nemotron-3-ultra-550b-a55b:free`, `deepseek/deepseek-v4.1-flash` | the models the party games use: a free one first, a cheap one when the free one is out of requests or fails (see *The AI models*) |
| `DOBLAJE_DATA`, `DOBLAJE_MODELS` | `./data`, `./models` | data and speech models (a volume in Docker) |

## The AI models
Party games ask the AI for short, silly texts, about what guests said, and guests are crude on purpose. So the party has
its own pair of models (`PARTY_AI_MODEL`, `PARTY_AI_FALLBACK`; the studio's translation keeps its own defaults), on the
same key, ledger and spend cap:
* **Main, free:** `nvidia/nemotron-3-ultra-550b-a55b:free`. Free models cost nothing (the cap is not touched), but
  OpenRouter allows 50 requests a day to an account that has never bought credits and 1000 to one that has bought $10 or
  more, shared by every room on the key. With a free-tier privacy setting off, some free endpoints are not routed to at all.
* **Fallback, cheap:** `deepseek/deepseek-v4.1-flash` (about $0.012 in / $0.60 out per million tokens, so a call costs a
  hundredth of a cent), which OpenRouter does not moderate and the roleplay traffic favours. It answers whenever the
  free model is out of requests, rejects the call or is unavailable, and the room never notices.
* **Why not the studio defaults:** the fallback there, Claude Haiku 5.5, is moderated by its provider and may lecture or
  refuse a rude take; the game treats a refusal as "no suggestion", which is safe but dull.

These picks come from OpenRouter's catalogue (free list, prices, moderation flags) and roleplay-traffic rankings, **not**
from measuring them: run `pnpm probe:models` with a working key to try them (or any other model ids) on the real
prompts with crude English and Spanish input; it reports refusals, unusable answers and JSON, time and cost per model.
Swap `PARTY_AI_MODEL` / `PARTY_AI_FALLBACK` for whatever wins. Any failure of both models means the offline generators.

## Media policy
A room's files are made for the round and are **deleted for good** once everyone has left the room (after
`PARTY_EMPTY_ROOM_MINUTES`, so a phone that drops off the network can come back). That covers the takes, the cut or
assembled picture and the rendered result; the library's clips are never touched (a round's media is hard-linked from
the clip and removed on its own). The show screen says so and offers **Download** for the result (`result.mp4`), so
people save what they want while they are still in the room. `PARTY_RETENTION_HOURS` removes anything left behind (a
crash). Disk use is roughly the clip plus the takes per open round; budget for `PARTY_MAX_ROOMS` rooms.

## Clips
Preparing a clip (separating voices, subtitles, characters) uses the studio app, so do it on your own computer. A clip then
travels as one file:
```
pnpm library list                                  # on your computer (the studio's data folder), the clips' ids
pnpm library export <clipId> heist.tar             # packs the clip: its lines, characters and media (no recordings)
```
Copy `heist.tar` to the server and import it into the running container (Dokploy: the service's terminal, or `docker exec`):
```
docker cp heist.tar <app container>:/tmp/heist.tar
docker exec <app container> node packages/api/src/library-cli.ts import /tmp/heist.tar <hostUserId>
docker exec <app container> rm /tmp/heist.tar
```
The clip arrives owned by that host (their WorkOS user id: `user_…`, in the WorkOS dashboard, or in `pnpm library` output
once they have signed in) and **sealed** when the server has a `LIBRARY_KEY`. Leave out the user id and it joins the
**starter pack** every host may pick from (a sealed one too). `list` shows each clip's owner and whether it is sealed;
`assign`, `release`, `seal` and `unseal` change those later. The host picks from the clips that are ready and have
characters that speak. (Your computer's `pnpm library` finds the studio data folder through `DOBLAJE_DATA`, default
`./data`; the desktop app keeps its own, `~/Library/Application Support/Doblaje Studio/data` on a Mac.)

## One address for everything
The server is the only place the phone app, the API, the sockets and the media come from (one origin). There is no CDN or
second host to configure, and no CORS: a page of any other site is refused. That keeps the session cookie, the room tokens
and the media guard in one place.

## Safety notes
* Only the phones' routes exist; every room route needs the player's token, and the host's need the host key (held by the
  phone that created the room). Tokens are random and never in a page's HTML.
* Rooms and uploads are limited (per address, per room, per file); names are cleaned; the AI key never leaves the server.
* Requests from another site's pages are refused (same-origin only). Security headers on every response: `nosniff`, no referrers, the microphone for the page's own origin only, HSTS over
  HTTPS.
* Logs go to stdout; `/healthz` is for the platform's health check.
