# Architecture decision records

Short records of decisions that shape the codebase: context, decision, consequences. Add one when a choice would
surprise a newcomer or be expensive to reverse. Number sequentially; never rewrite an accepted record, supersede it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-with-pnpm-workspaces.md) | Monorepo with pnpm workspaces, three shells over shared packages | Accepted |
| [0002](0002-typescript-without-a-build-step.md) | Strict TypeScript, run directly by Node (type stripping) | Accepted |
| [0003](0003-sqlite-with-drizzle.md) | SQLite via `node:sqlite` + Drizzle migrations; project document as JSON | Accepted |
| [0004](0004-electron-desktop-shell.md) | Electron shell embedding the HTTP backend | Accepted |
| [0005](0005-no-ui-framework.md) | No UI framework: typed DOM helper + canvas | Superseded by 0007 |
| [0006](0006-audio-and-ml-in-the-browser.md) | Audio mixing and ML inference in the browser, media files on the server | Accepted |
| [0007](0007-svelte-frontend.md) | Svelte 5 for every screen (studio, TV, phone app); shared components in `@doblaje/ui` | Accepted |
| [0008](0008-party-rooms-over-the-lan.md) | Party rooms: one server, phones over HTTPS on the LAN, server-owned game state | Accepted |
| [0009](0009-party-server-and-clients-with-capabilities.md) | Party server: backend orchestrates, clients have capabilities, public board, rooms deleted when empty | Accepted |
