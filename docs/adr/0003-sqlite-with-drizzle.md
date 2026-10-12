# 0003: SQLite via node:sqlite + Drizzle

**Context.** Projects were JSON files and the AI spend ledger was a JSON file rewritten on every call. We want
transactional, queryable storage that works identically in the server and inside Electron, with migrations.

**Decision.** SQLite through Node's built-in `node:sqlite` (also in Electron 44's Node), wrapped by Drizzle ORM
(`drizzle-orm/node-sqlite`) with Drizzle Kit migrations applied automatically on open. The node-sqlite driver is in
the Drizzle 1.0 release candidates, so the version is pinned exactly in the catalog. Tables: `projects` (columns for
what is listed, sorted or server-owned, plus the editable document as JSON), `ai_calls` (one row per paid call; the
cap is a `SUM`), `meta`. Media stays on disk. Jobs stay in memory. No migration of 0.1 data (no users yet).

**Alternatives.** `better-sqlite3` (native module, must be rebuilt for each Electron ABI); `libsql` (another native
binary); normalising cues/tracks into tables (the editor always reads and writes the document whole, so it would
add joins and partial-update bugs without new queries).

**Consequences.** No native database binary to ship. Optional fields in the document need no SQL migration
(`migrate()` fills defaults); new columns/tables need `pnpm db:generate`. Revisit the pinned RC when Drizzle 1.0 is final.
