# Data

## Where
```
data/                         (DOBLAJE_DATA; desktop: OS user-data folder)
  doblaje.db                  SQLite, WAL mode
  projects/<id>/
    source.<ext>              original upload / recording (stream-copied on export)
    proxy.mp4  poster.jpg  thumbs.jpg
    audio_orig.wav  audio_16k.wav
    stem_dialogue.wav  stem_bg.wav
    takes/take_<id>.wav       recordings (immutable; clips reference them)
    renders/{mix,bg,dry,wet}.wav   browser-rendered export inputs
    exports/<stamp>/…         export results
models/                       cached speech models (Hugging Face proxy)
```

## Schema (`packages/db/src/schema.ts`)
| Table | Columns | Notes |
|---|---|---|
| `projects` | `id`, `name`, `mode`, `created_at`, `updated_at`, `document` (JSON), `media` (JSON), `stems` (JSON), `template`, `source_template_id` | index on `updated_at` (library order) and `template`; `template = 1` rows are library clips |
| `ai_calls` | `id`, `at`, `model`, `task`, `cost_usd`, `tokens` | the spend cap is `sum(cost_usd)` |
| `meta` | `key`, `value` | installation facts |

The **project document** (cues, tracks, clips, takes, mix settings, speakers, markers, podcast options) is one JSON
column: the editor always loads and saves it whole (autosave of the full editable state, undo snapshots), so
splitting it into tables would add joins without adding queries. Columns that are listed, sorted or owned by the
server (`media`, `stems`) live outside it. The document's shape is `Project` in `packages/core/src/project.ts`;
`migrate()` there fills defaults, so adding an optional field needs no SQL migration.

**Library clips** are projects with `template = 1`: prepared once (separation, subtitles, characters), never recorded
on. `derive()` creates a dubbing, party or podcast project from one: the media files are **hard-linked** (same bytes,
no extra disk; a copy only across volumes), the prepared work is copied (`deriveDocument()` in core: cues, characters
with voices back on, lip flaps, marks), recordings never come along, and `source_template_id` remembers the origin.
Deleting a clip leaves its projects playable (their links keep the bytes).

Jobs (ingest/stems/export progress) are in memory on purpose: they belong to a running ffmpeg/Demucs process.

## Migrations
Drizzle Kit generates SQL from the schema; the app applies pending migrations when it opens the database
(`openDatabase()` → `migrate()`), in the server, the desktop shell and every test.
```
# 1. edit packages/db/src/schema.ts
pnpm db:generate --name add_x      # writes packages/db/drizzle/<timestamp>_add_x/migration.sql
pnpm db:check                      # sanity-check the migration history
pnpm --filter @doblaje/db test     # migrations apply on a fresh database
```
Commit the generated folder. Never edit a migration that has been committed; add a new one.

## Driver choice
`node:sqlite` (built into Node 24 and into Electron 44's Node) with `drizzle-orm/node-sqlite`: no native module to
rebuild per Electron version. Drizzle's node-sqlite driver ships in the 1.0 release candidates, pinned to an exact
version in the workspace catalog. See [ADR 0003](adr/0003-sqlite-with-drizzle.md).
