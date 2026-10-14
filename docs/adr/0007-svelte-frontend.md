# 0007: Svelte 5 for every screen

Supersedes [0005](0005-no-ui-framework.md).

**Context.** The product grew past one studio window: a TV host screen, a phone client that people use at a party,
a library with several kinds of items. Several screens now render live, shared state (a party room changes every
second, from several devices). Hand-written `h()` screens re-render whole panels and track their own listeners; that
was fine for one studio, it does not scale to three apps maintained by one person and coding agents.

**Decision.** Svelte 5 (runes) with plain Vite, no SvelteKit (the server is our own `createApp()`).
* Components are `.svelte` with `<script lang="ts">`, typed `$props()`, scoped `<style>`.
* Shared state lives in framework-free TypeScript where it already did (the audio engine, the party client, the
  store's undo/autosave) and is read by components through small adapters (the Svelte store contract, `$state`
  holders in `.svelte.ts` modules). Pure logic never imports Svelte.
* Canvas surfaces (timeline, rhythm band, waveforms) stay imperative drawing code, owned by a component that gives it
  an element, sizes it and redraws on change.
* Shared components live in `@doblaje/ui/components/*` (used by the studio, the TV and the phone app); design tokens
  in `@doblaje/ui/tokens.css`.
* Type checking: `svelte-check --fail-on-warnings` (TypeScript 6 underneath, because svelte-check needs the TS JS API
  that TypeScript 7 does not ship; same strict flags). Biome formats and lints the script part.

**Migration.** Screen by screen, keeping the e2e selectors so the browser tests prove behaviour across the move:
the party room (TV) and the phone app were written in Svelte first; the library, studio, podcast and dialogs follow,
and the `h()` helper is deleted when the last screen moves.

**Alternatives.** React 19: bigger ecosystem, heavier on cheap phones, more re-render bookkeeping for live state.
SolidJS: similar model to Svelte, smaller ecosystem. Staying framework-free: see Context.

**Consequences.** Small bundles (the phone app is ~34 kB gzipped), compile-time checked templates, less code per
screen. One more toolchain piece (svelte-check with TS 6) and Biome's partial Svelte support (template-level rules
such as unused imports are relaxed for `.svelte`; svelte-check covers them).
