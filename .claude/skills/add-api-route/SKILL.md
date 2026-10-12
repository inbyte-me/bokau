---
name: add-api-route
description: Add or change an HTTP endpoint in Doblaje Studio (packages/api), end to end - route, media/AI service, shared contract type, web client call and API test. Use whenever a feature needs the server to do something new.
---

# Add an API route

1. **Put the work in the right package, not in the route.**
   - ffmpeg / files → `packages/media/src/*.ts`, signature `(cfg: MediaConfig, projects: ProjectRepository, id, opts, progress?)`.
   - AI → `packages/ai/src/*.ts`, always through `OpenRouter.complete()` (ledger + spend cap).
   - persistence → `packages/db/src/*.ts` (see the `db-migration` skill for schema changes).
   Throw `AppError(status, message)` from `@doblaje/core` for expected failures.
2. **Shared types.** Request/response shapes the browser also uses go in `packages/core/src/contracts.ts`
   (or `project.ts`). Browser packages must not import Node packages.
3. **Route.** Register in `packages/api/src/routes/projects.ts` (project-scoped) or `routes/system.ts`:
   ```ts
   r.post<'id'>('/api/projects/:id/thing', async ({ req, params }) => {
     const id = projectId(params.id);                       // validates the id
     const o = await readJson<ThingOptions>(req);
     return reply(202, { job: jobs.run('export', (progress) => doThing(cfg.media, projects, id, o, progress), { projectId: id }).id });
   });
   ```
   Return a value for 200 JSON, `reply(status, body)` otherwise, or write `res` yourself and return `undefined`.
   Work longer than ~1 s is a job (`jobs.run`); add its kind to `JobKind` in `packages/core/src/jobs.ts`.
4. **Client.** Add a typed helper to `apps/web/src/api.ts` if it is called from more than one place
   (`api.startJob(url, body)` + `api.waitJob<Result>(job, onProgress)` for jobs).
5. **Test.** Add to `packages/api/test/<area>.test.ts` using `startApp()` from `@doblaje/testkit`
   (`app.api(method, url, body)`, `app.waitJob(id)`, `app.ingestFixture('clip_en.mp4')`). Assert on real output files
   with `ffprobeJson()` / `meanDb()`, and on the error cases (bad id → 400, missing → 404).
6. **Docs.** Add the row to `docs/api.md`.
7. Verify: `pnpm typecheck && pnpm lint && node --test packages/api/test/<area>.test.ts`.

Security checklist: never echo the API key; sanitize file names (`projects.file(id, name)` validates); keep new
static paths behind `safeJoin()`; uploads use `streamToFile(req, file, limit)` with a limit.
