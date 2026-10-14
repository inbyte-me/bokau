---
name: svelte-ui
description: Write or migrate a Doblaje Studio screen, panel or shared component in Svelte 5 (apps/web, apps/play, packages/ui/components) - runes, typed props, scoped styles, framework-free state, canvas wrappers, i18n and the checks. Use for any new UI and whenever an old h() screen is touched.
---

# Svelte UI in Doblaje Studio

Read `docs/frontend.md` first; this is the checklist.

1. **Place it**: screen/panel → `apps/<app>/src/features/<area>/Name.svelte`; used by more than one app →
   `packages/ui/src/components/Name.svelte`. Pure logic → a `.ts` module (or `packages/core` / `packages/party`).
2. **Script**: `<script lang="ts">`, `interface Props` + `let { … }: Props = $props()`, callbacks as `on<verb>` props.
   `$state` / `$derived` / `$effect` (return cleanups). Plain classes (engine, PartyClient, store) stay plain;
   subscribe in an `$effect`. Do not name variables `state`/`props`/`derived`/`effect`.
3. **Text**: every string through `t()` from `@doblaje/ui/i18n`; add the Spanish to `packages/ui/src/lang-es.ts`
   (Latin American: celular, audífonos, computadora). `apps/web/test/i18n.test.ts` fails otherwise.
4. **Layout**: scoped `<style>`; tokens from `@doblaje/ui/tokens.css`. New overflowing area → add its contract to
   `apps/web/src/layout.ts` (see the `ui-area` skill), implement it in the component's style.
5. **Right-click**: `registerMenu()` in the script, unregister in `onDestroy`; shared actions in
   `apps/web/src/features/actions.ts`.
6. **Migrating an h() screen**: keep every `id`/`data-*` the e2e tests use; move behaviour, not markup soup; delete
   the old module and its CSS from `styles/app.css` in the same change.
7. **Check**: `pnpm --filter @doblaje/web typecheck` (and `@doblaje/play`), `pnpm lint`, `node --test apps/web/test/i18n.test.ts`,
   then the e2e test that covers the screen (`pnpm build && node --test e2e/<x>.test.ts`).
