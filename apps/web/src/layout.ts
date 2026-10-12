/**
 * Sizing contract of every layout region: what each area does when the window (or its share of it) changes size.
 * Implemented in styles/app.css, explained in docs/design.md#sizing-and-overflow, enforced by e2e/layout.test.ts.
 * A new panel or area must be added here with its contract; the test fails on scroll containers that are not.
 *
 *  document  the page itself: exactly the viewport, never scrolls.
 *  screen    the one area under the top bar. Laid out to fit without scrolling when the window is roomy; scrolls
 *            as a whole (the only page-level scroll) when its regions cannot fit at their minimum sizes.
 *  page      a document-like screen (lists, forms): it is meant to scroll vertically, never horizontally.
 *  fit       sized by its content; never hides content: it wraps, or its flexible parts shrink/ellipsize.
 *  scroll    takes the space it is given and scrolls inside itself (vertically only); never pushes the layout.
 *  clip      media surface (video, canvas): scales its content to the space it gets, letterboxed; never scrolls.
 */
export type Contract = 'document' | 'screen' | 'page' | 'fit' | 'scroll' | 'clip';

export interface Region {
  selector: string;
  contract: Contract;
  /** contract on stacked (narrow) layouts, when it differs */
  stacked?: Contract;
  /** the reasoning, in one sentence */
  why: string;
}

/** A window at least this large must show every screen without any page-level scroll. */
export const ROOMY = { width: 1100, height: 680 };

export const REGIONS: Region[] = [
  // ---- global
  { selector: 'html', contract: 'document', why: 'An editing tool, not a web page: the window is the canvas, areas scroll individually.' },
  { selector: '.topbar', contract: 'fit', why: 'Always one row; the project title field and chips shrink first, so actions never fall off.' },
  { selector: '.modal', contract: 'scroll', why: 'Dialogs cap at 90% of the window height and scroll inside, so actions stay reachable on short screens.' },
  { selector: '.ctxmenu', contract: 'scroll', why: 'Right-click menus open where clicked but are clamped inside the window; a long menu scrolls.' },
  { selector: '#toasts', contract: 'fit', why: 'Short messages stacked in a corner; they never take layout space.' },

  // ---- library
  { selector: '.library', contract: 'page', why: 'A list of projects grows with use; reading it top to bottom is natural.' },

  // ---- pro studio
  {
    selector: '.studio',
    contract: 'screen',
    why: 'Picture, transport and timeline must be visible together while recording; stacks and scrolls only on narrow windows.',
  },
  { selector: '.stage-wrap', contract: 'clip', why: 'Takes the space left by the fixed rows; the video shrinks rather than pushing the timeline away.' },
  { selector: '.stage', contract: 'clip', why: 'The video is letterboxed into whatever space it gets (object-fit: contain).' },
  { selector: 'canvas.band', contract: 'clip', why: 'The rhythm band keeps a readable height between 72 and 108 px and redraws at any width.' },
  { selector: '.side', contract: 'fit', why: 'A fixed-width column: tabs on top, the active panel fills the rest.' },
  { selector: '.side .tabs', contract: 'fit', why: 'Five short labels that fit the column width.' },
  { selector: '.panel', contract: 'scroll', why: 'Panels hold long forms and cue lists; they scroll inside the column so the picture never moves.' },
  { selector: '.transport', contract: 'fit', why: 'Controls wrap onto a second row on narrow windows instead of being cut off.' },
  { selector: '.timeline', contract: 'clip', why: 'A band of 220–380 px (38% of the height); lanes scroll inside it, time scrolls with its own scrollbar.' },
  { selector: '.tl-toolbar', contract: 'fit', why: 'Tools wrap; the hint text is the first thing to go.' },
  { selector: '.tl-scroll', contract: 'scroll', why: 'Any number of voice tracks: lanes scroll vertically inside the timeline band.' },

  // ---- party / TV
  { selector: '.party', contract: 'screen', why: 'Holds one party screen at a time.' },
  { selector: '.party-body', contract: 'page', why: 'Setup screens are short forms, read top to bottom from the sofa; they may scroll on small windows.' },
  { selector: '.party-stage', contract: 'clip', why: 'While performing, picture and lyrics fill the screen; nothing should scroll mid-take.' },
  { selector: '.party-stage > .col:last-child', contract: 'scroll', why: 'Controls column beside the picture; scrolls inside if the window is short.' },
  { selector: '.stage-box', contract: 'clip', why: 'The picture frame in party and podcast screens: letterboxed video.' },

  // ---- podcast
  { selector: '.pod', contract: 'screen', why: 'Recording view and its controls side by side; stacks and scrolls on narrow windows.' },
  {
    selector: '.pod-stage',
    contract: 'clip',
    stacked: 'fit',
    why: 'Camera preview / playback and the waveform take the left column at any size (stacked: natural height, part of the page).',
  },
  {
    selector: '.pod-side',
    contract: 'scroll',
    stacked: 'fit',
    why: 'Settings, chapters and export options are long; they scroll in their own column (stacked: they become part of the page).',
  },
];

/** Narrower than this, two-column screens stack vertically and the screen scrolls (see the @media rules). */
export const STACK_BELOW = 1000;
