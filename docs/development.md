# Development

## Toolchain
| Tool | Version | Notes |
|---|---|---|
| Node | 24.11+ (`.nvmrc`: 24) | runs TypeScript directly; provides `node:sqlite` and `process.loadEnvFile` |
| pnpm | 11 (pinned in `packageManager`) | `corepack enable pnpm` once, or run `corepack pnpm …` |
| TypeScript | 7 (native compiler) | type-checking only (`noEmit`) |
| Biome | 2.5 | lint + format, one tool, config in `biome.json` |
| Vite | 8 | web app dev server and build |
| esbuild | 0.28 | bundles the Electron main process and preload |
| Electron | 44 (Node 24.19 inside) | desktop shell |
| ffmpeg | 8 | on the PATH (`FFMPEG`/`FFPROBE` override) |

`pnpm doctor` checks all of it and prints fixes.

## Everyday loop
```
pnpm install
pnpm dev            # API on :5177 (restarts on change) + Vite on :5173 (hot reload) → open http://localhost:5173
pnpm typecheck && pnpm lint && pnpm test
```
`pnpm start` builds the web app and serves everything from the API server on :5177 (what users run).
`pnpm desktop` builds and opens the Electron app; data goes to the OS user-data folder
(`~/Library/Application Support/Doblaje Studio/data` on macOS).

## Conventions
* Packages export `src/*.ts` directly (`"exports": { ".": "./src/index.ts" }`). No build output in packages.
* Relative imports include `.ts`. Type-only imports use `import type`.
* Erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces or constructor parameter properties.
* Node packages extend `tsconfig.node.json`; browser packages extend `tsconfig.web.json`. Tests extend
  `tsconfig.test.json` too (implicit `any` allowed for fixture locals).
* Shared versions live in the `catalog:` of `pnpm-workspace.yaml`. Install scripts are blocked unless listed in
  `allowBuilds` there.
* Formatting is Biome's (160 columns). Run `pnpm format` before committing.

## Adding things
* **A package:** `packages/<name>/{package.json,tsconfig.json,src/index.ts}` mirroring an existing one; depend on it
  with `"@doblaje/<name>": "workspace:*"`; keep the dependency direction in [AGENTS.md](../AGENTS.md#layout).
* **A dependency:** `pnpm --filter @doblaje/<pkg> add <dep>`. Prefer the platform (Node, Web APIs) first.
  If it needs an install script, add it to `allowBuilds`.
* **An endpoint:** see `.claude/skills/add-api-route`.
* **A table or column:** see `.claude/skills/db-migration` and [data.md](data.md).

## Releasing the desktop app
`pnpm desktop:dist` builds the web app, bundles the shell (`apps/desktop/build.ts`) and runs electron-builder
(`apps/desktop/electron-builder.yml`): DMG on macOS, NSIS on Windows, AppImage on Linux. Code signing and
notarization are not configured; unsigned builds run after the usual OS confirmation. ffmpeg is not bundled:
it must be installed on the machine (the app reports it on the start screen and in `/api/health`).

## Environment variables
See `.env.example`. Real environment variables override `.env`.
