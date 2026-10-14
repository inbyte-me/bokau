# HTTP API

Served by `@doblaje/api` (`createApp()`), same origin as the web app. JSON in and out unless noted; errors are
`{ "error": "message" }` with a meaningful status (400 bad input, 403 forbidden, 404 missing, 409 not possible
now, 413 too large, 415 wrong file type, 402/503 AI unavailable).
Request/response types shared with the browser live in `packages/core/src/contracts.ts` and `project.ts`.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, ffmpeg }` |
| GET | `/api/system` | neural separator installed, ffmpeg, AI spend status, Node/Electron versions |
| GET | `/api/jobs/:id` | progress of a background job (`status`, `progress` 0..1, `message`, `result`, `error`) |
| GET | `/api/ai/status` | spend vs cap, allowed models, genres |
| POST | `/api/ai/rewrite` | `{ task, cues, params }` → syllable-fitted lines (falls back offline for party tasks) |
| GET / POST | `/api/projects` | list (summaries, newest first; `?kind=clips` or `?kind=projects`) / create `{ name, mode, template? }` |
| POST | `/api/projects/:id/derive` | `{ mode, name? }` → a new project from a library clip (media hard-linked, prepared work copied) |
| POST | `/api/projects/from-path` | import a local file by path (loopback binds only; `template: true` for a library clip) → `202 { project, job }` |
| GET / PUT / DELETE | `/api/projects/:id` | read / save the editable document (server-owned `media`, `stems` ignored) / delete with files |
| POST | `/api/projects/:id/source` | raw body upload, `x-filename` header → `202 { job }` (ingest) |
| POST | `/api/projects/:id/stems` | `{ method: auto\|neural }` → `202 { job }` |
| POST | `/api/projects/:id/speech-segments` | silence-detection speech ranges |
| POST | `/api/projects/:id/takes/:name` | upload a take WAV |
| POST | `/api/projects/:id/takes/:name/clean` | server-side denoise → new take file |
| POST | `/api/projects/:id/renders/:name` | upload `mix\|bg\|dry\|wet` WAV rendered in the browser |
| POST | `/api/projects/:id/recording/:step` | live podcast recording: `start`, `append` (chunks), `finish` → `202 { job }` |
| POST | `/api/projects/:id/export` | export options → `202 { job }`; result lists files under `/media/:id/exports/…` |
| POST | `/api/projects/:id/export-plan` | what an export would do (stream copy or re-encode) |
| POST | `/api/projects/:id/podcast-export` | format, clean-up, loudness, trim, chapters → `202 { job }` |
| POST | `/api/projects/:id/import-subs` | SRT/VTT text body → `{ cues }` |
| GET / POST | `/api/sounds` | background audio library / add one (raw body, `x-filename`) → `202 { job }` (converted to AAC) |
| PUT / DELETE | `/api/sounds/:id` | rename `{ name }` / remove with its file |
| POST | `/api/party/rooms` | open a party room (local listener only) → `{ code, hostKey, joinUrl }` |
| GET | `/api/party/info` | where phones join (`joinBase`), LAN addresses |
| GET | `/api/party/rooms/:code/project` | the round's project, for a cast phone (`x-party-token`) |
| POST | `/api/party/rooms/:code/takes?turn&start` | a recorded line (WAV) for the current turn (`x-party-token`) → `201 { file, duration }` |

WebSocket: `/party/ws` on both listeners: the room's live state for the TV (`hello-host` with the host key) and the
phones (`hello-player` with name or token). Messages: `packages/party/src/protocol.ts`; flow: [party.md](party.md).

Non-API paths: `/media/:id/<file>` (allow-listed project files, HTTP Range for seeking, exports as downloads),
`/play/…` (the phone app), `/party/:code/media/<file>?t=token` (the round's media for phones), `/sounds/<id>.m4a`,
`/hf/…` (model cache proxy), `/vendor/{transformers,ort}/…` (speech libraries), everything else the web app.

## Jobs
Long work answers `202 { job }` immediately; poll `GET /api/jobs/:id` (the web client's `api.waitJob()`).
Media functions receive a `Progress` callback `(fraction, message)`; they never see HTTP.

## Security
* The **party listener** (HTTPS, all interfaces, self-signed) serves only the phone app, the player routes, the
  round's media and background sounds, each behind a room token. See [party.md](party.md#security).
* Binds to `127.0.0.1` by default. On a loopback bind, requests whose `Host` is not localhost are rejected
  (DNS-rebinding guard) and state-changing requests with a foreign `Origin` are rejected (CSRF guard).
* The OpenRouter key is read from the environment and never sent to the browser (a test asserts it).
* File names from requests are sanitized; project files are served only from an allow-list; static paths are
  resolved with `safeJoin()` and cannot escape their folder; encoded slashes cannot create path segments.
* Uploads stream to disk with size limits (8 GB source, 1 GB take, 2 GB render).
