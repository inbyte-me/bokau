# Frontend (Svelte 5)

Three browser apps share packages: the **studio + TV** (`apps/web`), the **phone app** (`apps/play`), and the
desktop window (which loads `apps/web`). Why Svelte: [ADR 0007](adr/0007-svelte-frontend.md).
Every screen is Svelte; there is no hand-built DOM left.

## Where things go
| What | Where |
|---|---|
| A screen or panel | `apps/<app>/src/features/<area>/Thing.svelte` (one component per file, PascalCase) |
| Shared component (studio, TV and phone) | `packages/ui/src/components/*.svelte`, imported as `@doblaje/ui/components/X.svelte` |
| Design tokens | `packages/ui/src/tokens.css` (`@import '@doblaje/ui/tokens.css'`) |
| Text | `t('English')` from `@doblaje/ui/i18n` + Spanish in `packages/ui/src/lang-es.ts` |
| Pure logic (no DOM, no Svelte) | `packages/core`, `packages/party`, or a `.ts` next to the component |
| Audio, recording, speech | `@doblaje/audio`, `@doblaje/speech` (framework-free classes) |

## Component rules
* `<script lang="ts">` with a typed `interface Props` and `let { … }: Props = $props();`. Callbacks are props named
  `on<verb>` (`onpick`, `onjoin`); no `createEventDispatcher`.
* State with `$state`, computed values with `$derived`, side effects with `$effect` (return the cleanup). Reading a
  prop only once on purpose: `untrack(() => prop)`, so svelte-check does not warn.
* Framework-free objects (the engine, `PartyClient`, the store) stay plain classes. Components subscribe:
  `const live = new Live(client)` (`@doblaje/ui/live.svelte`, built on `createSubscriber`), then read `live.current`;
  engine/mic/session state through the adapters in `apps/web/src/transport.svelte.ts` and `shell/mic.svelte.ts`.
  Avoid `$effect` that copies state; effects are for syncing to the outside (a canvas redraw, an engine call).
* The project store (`store.svelte.ts`): `store.read(kinds, (p) => copy)` inside `$derived` re-runs when those change
  kinds are committed; edits always go through `store.commit(label, fn, kinds)` (undo + autosave).
* Never name a variable `state`, `props`, `derived` or `effect` (they shadow the runes).
* Styles are scoped `<style>` in the component; global CSS only for tokens and the page shell. Every area that can
  overflow declares its sizing contract in `apps/web/src/layout.ts` (fit, scroll, clip, screen, page) and implements
  it in its own `<style>` with a `/* scroll */` style comment, as in `docs/design.md`.
* Right-click: `registerMenu(selector, provider)` from `@doblaje/ui` in the component's script, unregistered in
  `onDestroy`. Native menu on text fields and links, nothing elsewhere.
* Icons: `<Icon name="play" />` (`@doblaje/ui/components/Icon.svelte`), same line set as the rest of the app.
* No `{@html}`: build markup in the template (the QR code is SVG rects), never inject strings.
* Accessibility: buttons are `<button>` with text or a `title`; svelte-check's a11y warnings fail the build
  (`--fail-on-warnings`), silence one only with a `<!-- svelte-ignore … -->` and a reason next to it.
* Keep e2e selectors (`id`s, `data-*`) stable: the browser tests are the contract that survives refactors.

## Canvas parts and other imperative objects
The timeline, rhythm band and waveforms are drawing code, not markup. A component hands the element to the class with
an attachment (`<canvas {@attach band}>`) and returns its `destroy` as the cleanup.

**Construct imperative objects inside `untrack()`.** An attachment is an effect: every reactive value read while it
runs becomes a dependency, and a change re-runs it (destroy + rebuild). Constructors that read the selection or the
project while setting up would be torn down on the next click. Read only what should rebuild it, then
`untrack(() => new Timeline(el))` (see `features/studio/Studio.svelte`).

## Checks
* `pnpm --filter @doblaje/web typecheck` / `@doblaje/play`: `svelte-check --fail-on-warnings` (TypeScript 6 under
  the hood; the rest of the repo uses TypeScript 7).
* `pnpm lint`: Biome formats and lints the script part of `.svelte` files (template-blind rules are relaxed for them,
  svelte-check covers those).
* Browser tests drive the built apps: `pnpm test:e2e` (see [testing.md](testing.md)).
