---
name: db-migration
description: Change the SQLite schema (tables, columns, indexes) with Drizzle in packages/db and ship a migration. Use when adding persistent state; not needed for new optional fields inside the project document.
---

# Change the database schema

First decide whether you need SQL at all:
- **New optional field in a project** (a setting, a list on the project): add it to `Project` in
  `packages/core/src/project.ts`, give it a default in `defaultProject()` and merge it in `migrate()`. It lives in the
  `document` JSON column; no migration.
- **New column / table / index** (something listed, sorted, queried or server-owned): continue below.

**Every migration is made by drizzle-kit, never by hand.** A migration is a folder `packages/db/drizzle/<timestamp>_<name>/`
with `migration.sql` and `snapshot.json` (the schema as it is after that migration). There is no central journal file any
more: the chain is the snapshots, and the newest snapshot is what the next `generate` diffs `schema.ts` against. A folder
made by hand has no snapshot, so the next `generate` would diff against a stale state and re-create or drop things.
- Schema change (table, column, index): edit `schema.ts`, then `pnpm db:generate --name <short_snake_name>`.
- Raw SQL that is not a schema diff (backfill, data fix, trigger, a rebuild Drizzle cannot express):
  `pnpm db:generate --custom --name <short_snake_name>`. It creates an empty `migration.sql` (write your SQL there) and a
  snapshot that continues the chain unchanged.
- Never create a migration folder or a `snapshot.json` yourself, never edit either in a committed migration, never reorder
  or rename them. Run `pnpm db:check` (it verifies the chain) before committing.

Steps:
1. Edit `packages/db/src/schema.ts` (Drizzle `sqliteTable`; columns are camelCase in TS, snake_case in SQL via
   `casing: 'snake_case'`). Prefer `text({ mode: 'json' }).$type<T>()` for structured blobs, `integer`/`real` for numbers,
   ISO strings in `text` for timestamps (as the existing tables do).
2. Generate: `pnpm db:generate --name <short_snake_name>` → `packages/db/drizzle/<timestamp>_<name>/migration.sql`.
   Read the SQL. SQLite cannot alter some things in place; Drizzle may generate a table rebuild: check data is copied.
3. Repository code in `packages/db/src/` (keep queries there, not in routes). Sync API: `.get()`, `.all()`, `.run()`.
4. Test in `packages/db/test/db.test.ts`: open `openDatabase({ file: ':memory:' })` (migrations apply), exercise
   the new code. Also run the API tests: every `startApp()` opens a fresh database with all migrations.
5. `pnpm db:check`, `pnpm typecheck`, `pnpm test`. Update `docs/data.md`.
6. Commit the generated migration folder (both files) with the schema change. Never edit a committed migration; add another.

The desktop bundle copies `packages/db/drizzle` (see `apps/desktop/build.ts`); nothing else to do there.
