# AGENTS.md

Guide for coding agents (and humans) working in this repository. Read it before changing code.
Product overview: [README.md](README.md). Deeper docs: [docs/](docs/README.md).

## What this is
Doblaje Studio: a local dubbing / podcast / party-game studio. A Node backend does media work with ffmpeg
(ingest, stem separation, export), keeps projects in SQLite and runs party rooms; browser frontends (Svelte 5) do
all audio playback, recording and mixing with Web Audio: the studio + TV app, and a phone app guests use at a party.
An optional Electron shell wraps the server and the studio.

## Setup and commands
Node **24.11+** (`nvm use`, reads `.nvmrc`), pnpm via corepack (`corepack enable pnpm`, or prefix commands with
`corepack`), ffmpeg on the PATH, Google Chrome for e2e tests.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev (API + Vite hot reload, open :5173) | `pnpm dev` |
| Production build + server (:5177) | `pnpm start` |
| Desktop app | `pnpm desktop` (package: `pnpm desktop:dist`) |
| Type-check everything | `pnpm typecheck` |
| Lint + format check / fix | `pnpm lint` / `pnpm format` |
| Unit + API tests | `pnpm test` |
| Browser e2e (builds first) | `pnpm test:e2e` |
| One test file | `node --test packages/db/test/db.test.ts` |
| All gates | `pnpm test:all` |
| Environment check | `pnpm doctor` |
| New DB migration | edit `packages/db/src/schema.ts`, then `pnpm db:generate --name <what>` |

There is no compile step for Node code: Node runs `.ts` directly (type stripping). Vite bundles the web app,
esbuild bundles the Electron main process.

## Layout
```
apps/
  server/    HTTP shell: createApp() + listen. Nothing else lives here.
  web/       Frontend shell: router, store, app singleton, feature screens (studio, podcast, party room/TV, library).
  play/      Phone app for party rooms (Svelte): join, get cast, record your lines. Served at /play/.
  desktop/   Electron shell: same createApp() in the main process, hidden-window smoke mode.
packages/
  core/      Isomorphic domain: project model + types, HTTP contracts, SRT, syllables, transcription, diarization, events.
  db/        SQLite (node:sqlite) + Drizzle schema, migrations, repositories (projects, AI ledger).
  media/     ffmpeg pipeline: probe, ingest, stems (incl. Demucs), export, podcast export, subtitle PNGs.
  ai/        OpenRouter client with spend cap, prompts, syllable-fitted rewrite, party line suggestions, offline generators.
  party/     Party rooms, isomorphic: room state machine, casting/slicing, contests, the public board, wire protocol, browser client. No I/O.
  party-ui/  Party screens every client shares (game list, languages, the host's buttons): plain props, no host context, no API.
  api/       HTTP app: config, router, routes, jobs, static/media serving, security guard, party hub + LAN HTTPS listener.
  audio/     Browser media engine: transport, the mix graph, FX, worklets, mic, recording session, offline render.
  speech/    Browser speech: Whisper transcription and voice identification in one worker.
  ui/        Frontend primitives: Svelte components (icon, modal, menus, toasts…), design tokens, i18n (+ Spanish), menu registry.
  testkit/   Fixtures, throw-away backend, silent headless Chrome with a synthetic microphone.
e2e/         End-to-end tests (real backend + built web app in Chrome).
scripts/     dev runner, doctor, hardware watcher, Demucs installer.
```
Dependency direction (enforced by package.json, keep it): `core` ← everything; `party` ← `api`, `party-ui`, `web`, `play`; `party-ui` ← `web`, `play`;
`db`, `media`, `ai` ← `api` ← `server`, `desktop`; `audio`, `speech`, `ui` ← `web`, `play`.
Browser packages never import Node packages (types shared through `core` and `party`).

## Rules
- **UI is Svelte 5** (runes, typed props, scoped styles): see `docs/frontend.md`. No hand-built DOM; canvas engines
  (timeline, band, waveforms) are plain classes handed their elements by a component. Svelte apps type-check with
  `svelte-check --fail-on-warnings`.
- **TypeScript only, strict.** No `any` in application code (tests may leave fixture locals untyped, see `tsconfig.test.json`).
  Only erasable syntax (no `enum`, `namespace`, parameter properties): Node strips types, it does not compile them.
- Relative imports carry the `.ts` extension. Workspace packages export their `src/*.ts` directly.
- One mix graph: `packages/audio/src/mixgraph.ts` is used for live preview **and** offline export. Never fork it.
- Server-owned fields (`media`, `stems`) are only written by the media pipeline; `PUT /api/projects/:id` ignores them.
- New user-facing text goes through `t('English text')` and needs a Spanish entry in `packages/ui/src/lang-es.ts`
  (a test fails otherwise). Plain, verb-first copy; see `docs/design.md` (no emoji, no marketing tone).
- Every layout area has a sizing contract (fit / scroll / clip / screen / page) declared in `apps/web/src/layout.ts`;
  new areas must be added there (`e2e/layout.test.ts` fails on undeclared scroll containers). See `docs/design.md`.
- Right-click: app menu only where there are relevant actions (`registerMenu` from `@doblaje/ui`), native menu on text
  fields and links, nothing elsewhere. Shared actions live in `apps/web/src/features/actions.ts`.
- Long work (ffmpeg, Demucs) runs as a job: return `202 { job }`, report progress through the `Progress` callback.
- Schema changes go through Drizzle migrations made by drizzle-kit only: `pnpm db:generate --name <x>`, or `--custom` for raw SQL
  (never a folder or `snapshot.json` written by hand: the snapshots are the chain). Never edit a committed migration; run
  `pnpm db:check`.
- The API binds to localhost and rejects foreign Host/Origin headers. Keep it that way; the OpenRouter key never reaches the browser.
  The party listener (HTTPS on the LAN, or the whole server with `DOBLAJE_MODE=party`) serves only the phone app and
  token-guarded player routes: never add studio routes to it (`docs/party.md#security`, `docs/deployment.md`).
- Party game rules live in the pure reducer `packages/party/src/room.ts`; the hub only does I/O around it. The backend
  runs the room whatever the clients are (TV, phone host, phone guest): clients have capabilities, never run the game,
  and draw the public board the server sends (`boardOf`).
- AI calls must go through `OpenRouter.complete()` (ledger + cap). Keep `MODELS` an allow-list of cheap models.

## Testing without hardware (night mode)
Tests are silent by default: Chrome runs headless with `--mute-audio` and a synthetic microphone fed from a WAV
(`injectFakeMic`). Nothing needs a mic, speakers or an interface. Real-hardware tests skip unless asked:
`pnpm test:live` (mic, `LIVE_DEVICE="name"`), `pnpm test:live-output` (plays audible clicks, `LIVE_OUTPUT="name"`),
`pnpm watch:hardware` (runs them when a device is plugged in). Do not run the audible ones unattended.

## Before you finish
`pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm test:e2e` when you touched the web app, audio, speech or API.
Update the matching doc in `docs/` when behaviour or structure changes. Commit messages: imperative, say why.

## Skills
Task recipes for agents live in `.claude/skills/` (add an API route, change the DB schema, change the audio graph,
write Svelte UI, add UI text, add a UI area or context menu, verify without hardware). Claude Code loads them automatically; other agents can read them as docs.

Third-party skills were reviewed on skills.sh (2026-10-12): Drizzle (`giuseppe-trisciuoglio/developer-kit@drizzle-orm-patterns`,
`lobehub/lobehub@drizzle`) and monorepo (`wshobson/agents@monorepo-management`) skills exist but assume Drizzle 0.x with
other drivers, Turborepo, ESLint/Prettier and packages built to `dist/`, which this repo deliberately does not use
(ADRs 0001–0003). No Electron, Web Audio or Biome skill fit. The project skills above encode this repo's actual conventions;
re-check with `npx skills find <topic>` before adding one.
