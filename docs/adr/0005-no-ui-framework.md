# 0005: No UI framework

**Status: superseded by [0007](0007-svelte-frontend.md).**

**Context.** The UI is a dense studio tool: a canvas timeline and rhythm band redrawn every frame, a video stage,
and forms in side panels. State lives in one store with undo and autosave; the hot path is Web Audio and canvas.

**Decision.** Keep the framework-free approach: a typed `h(tag, props, ...children)` helper in `@doblaje/ui`
(`h('input')` is an `HTMLInputElement`, event handlers are typed), explicit re-render of a panel when the store emits
the change kinds it shows, canvas for the timeline and band. Feature screens live in `apps/web/src/features`.

**Alternatives.** React/Preact/Solid/Svelte. A rewrite would touch every screen, add a reconciler between the store
and the DOM, and not help the canvas parts, which are most of the complexity.

**Consequences.** Small bundle (≈ 90 kB main chunk), no framework upgrades. Panels must take care not to re-render
under the user's cursor (update in place). Revisit if screens multiply or forms grow complex.
