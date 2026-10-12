---
name: ui-area
description: Add or change a panel, area, screen or interactive element in the Doblaje Studio web app - decide and declare how it behaves when its size changes (fit, scroll inside, clip media, or page scroll) and what right-click offers on it. Use for any new panel, list, toolbar, dialog or clickable item.
---

# Add a UI area (sizing + right-click)

## 1. Sizing contract
Decide what the area does when the window or its share of it changes, and write the reason down:
- **fit**: sized by its content, must never hide it → wrap, or let a flexible part shrink/ellipsize (toolbars, rows).
- **scroll**: gets a bounded space and scrolls inside, vertically (lists, panels, long forms, dialogs).
- **clip**: media scaled into its box, letterboxed (video, canvas).
- **screen**: the single top-level area of a screen; fits on roomy windows, scrolls as a whole when cramped.
- **page**: a document-like screen that scrolls (lists of things, setup forms).
Rules of thumb: only one thing scrolls per direction in a region; nothing scrolls horizontally except virtual timelines
with their own scrollbar; decide what gives way first when space shrinks and say it in the `why`.

Steps: add `{ selector, contract, why }` (and `stacked` if it changes below 1000 px) to `REGIONS` in
`apps/web/src/layout.ts`; implement it in the "Sizing contracts" block of `apps/web/src/styles/app.css` (scroll areas need
`min-height: 0` and `overflow-y: auto`; clip areas `overflow: hidden`); add the screen to `SCREENS` in
`e2e/layout.test.ts` if it is new; run `pnpm build && node --test e2e/layout.test.ts`.

## 2. Right-click
- Has the element relevant actions of its own (it represents a thing: a cue, a clip, a take, a row)? Register a menu:
  ```ts
  const off = registerMenu('.my-row[data-id]', (el, at) => {
    const item = find((el as HTMLElement).dataset.id);
    if (!item) return null;                       // null = no menu
    return [
      { label: t('Play'), icon: 'play', shortcut: 'Space', run: () => play(item) },
      { label: t('Delete thing'), icon: 'trash', danger: true, run: () => remove(item.id) },
    ];
  });
  // call off() in the feature's destroy()
  ```
  Put the action itself in `apps/web/src/features/actions.ts` if a button or shortcut does the same thing.
- Text fields and links: do nothing; they keep the native menu.
- Decorative or structural elements: do nothing; they show no menu.
- Add the row to the "Context menus" table in `docs/design.md`, translate labels (see the `ui-text` skill), and extend
  `e2e/context-menu.test.ts` with the expected item list.
