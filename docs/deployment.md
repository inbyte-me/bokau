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

## The quick way: Docker Compose (behind your reverse proxy, or with Caddy)
1. Point a DNS record for your domain (this project's: `bokau.askn.us`) at the machine.
2. `cp .env.example .env` and set `DOMAIN=party.example.com` (and `OPENROUTER_API_KEY` for the AI; without it the
   offline generators are used). Compose reads these from its own environment (the shell, or that `.env`) with `${NAME}`
   interpolation, so the same variables work from a CI secret store; the key stays on the server.
3. Put your prepared clips in the data volume (see *Clips*).
4. `docker compose up -d`. The app listens on `127.0.0.1:5177` only: your reverse proxy is the way in. **Caddy** listens on 80/443,
   gets the certificate and proxies everything to the app, which serves the phone app, the API and the media (those stay behind room
   tokens, so Caddy does not serve files itself): `deploy/Caddyfile.host` for Caddy on the host, `deploy/Caddyfile` for the compose
   profile. (An nginx example,
   with WebSockets, large uploads and `X-Forwarded-*`, is `deploy/nginx.conf.example`; get the certificate with certbot or
   whatever your proxy uses). No proxy yet? `docker compose --profile caddy up -d` runs Caddy too, which gets and renews the
   Let's Encrypt certificate by itself (open ports 80 and 443).

Check: `https://bokau.askn.us/healthz` answers `{"ok":true,"mode":"party",…}`, and `https://bokau.askn.us/play/`
opens the phone app. (The image and the compose file were written alongside the code and are not run by the tests:
build once on your machine before relying on them.)

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
| `PARTY_JOIN_URL` | – | invite link template for a phone app served elsewhere, e.g. `https://play.example.com/?room={code}` |
| `TRUST_PROXY` | `0` | proxies in front; their `X-Forwarded-For` is believed this many hops (limits are per address) |
| `TLS_CERT`, `TLS_KEY` | – | serve HTTPS directly |
| `PARTY_ORIGINS` | – | other origins allowed to use the API and sockets (a phone app on a CDN), comma separated |
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
Preparing a clip (separating voices, subtitles, characters) uses the studio app, so do it on your own computer: run the
studio, build the library, then copy the data folder (`doblaje.db` and `projects/`) to the server's data volume. The
host picks from that library (clips that are ready and have characters that speak). Replace the folder (or add clips)
while the server is stopped.

## Serving the phone app elsewhere (a static host or CDN)
The server serves the phone app at `/play/` by default, which is the simplest. To host it elsewhere, build it with the
server's address: `VITE_PARTY_API=https://party.example.com VITE_PLAY_BASE=/ pnpm --filter @doblaje/play build`, upload
`apps/play/dist`, and on the server set `PARTY_ORIGINS=https://play.example.com` and
`PARTY_JOIN_URL=https://play.example.com/?room={code}`. Phones then load the page from the CDN and talk to the server
across origins (CORS and sockets are limited to the listed origins).

## Safety notes
* Only the phones' routes exist; every room route needs the player's token, and the host's need the host key (held by the
  phone that created the room). Tokens are random and never in a page's HTML.
* Rooms and uploads are limited (per address, per room, per file); names are cleaned; the AI key never leaves the server.
* Security headers on every response: `nosniff`, no referrers, the microphone for the page's own origin only, HSTS over
  HTTPS.
* Logs go to stdout; `/healthz` is for the platform's health check.
