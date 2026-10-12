# Architecture decision records

Short records of decisions that shape the codebase: context, decision, consequences. Add one when a choice would
surprise a newcomer or be expensive to reverse. Number sequentially; never rewrite an accepted record, supersede it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-with-pnpm-workspaces.md) | Monorepo with pnpm workspaces, three shells over shared packages | Accepted |
| [0002](0002-typescript-without-a-build-step.md) | Strict TypeScript, run directly by Node (type stripping) | Accepted |
| [0003](0003-sqlite-with-drizzle.md) | SQLite via `node:sqlite` + Drizzle migrations; project document as JSON | Accepted |
| [0004](0004-electron-desktop-shell.md) | Electron shell embedding the HTTP backend | Accepted |
| [0005](0005-no-ui-framework.md) | No UI framework: typed DOM helper + canvas | Accepted |
| [0006](0006-audio-and-ml-in-the-browser.md) | Audio mixing and ML inference in the browser, media files on the server | Accepted |
