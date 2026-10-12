# 0001: Monorepo with pnpm workspaces

**Context.** The app has a Node backend, a browser frontend and now a desktop shell. Domain logic (project model,
subtitles, syllables, diarization) is shared by server and browser. Version 0.1 was one package with relative
imports across `server/`, `shared/` and `public/`, and the browser fetched `/shared/*.js` at runtime.

**Decision.** One repository, pnpm workspaces. `apps/` holds thin shells (server, web, desktop); `packages/` holds
the shared backend (`db`, `media`, `ai`, `api`), shared frontend (`audio`, `speech`, `ui`) and isomorphic `core`.
Dependencies are explicit `workspace:*` entries; pnpm's strict linking makes undeclared imports fail. Shared
versions sit in the workspace `catalog`; install scripts are opt-in (`allowBuilds`). No task runner (Turborepo/Nx):
with ~10 packages, no build outputs to cache and sub-second type-checks, `pnpm -r` is enough.

**Consequences.** Boundaries are visible in `package.json` files and reviewable. Adding a shell means composing
packages, not copying code. A task runner can be added later if CI time demands it.
