# Design rules

The product is a dubbing booth. It should look like a piece of studio equipment, not a SaaS dashboard.

## What counts as "AI slop" here (and is banned)
| Tell | Rule |
|---|---|
| Emoji as icons or headings | Never. One line-icon set (`packages/ui/src/icons.ts`, 16 px grid, 1.5 px stroke). Text labels stay next to icons. |
| Gradients, glows, halos, blur, soft shadows | Never in chrome. The only gradient allowed is the level-meter ramp, because it encodes level. |
| Identical rounded cards with an icon, a title and a grey sentence | Use lists, tables and hairlines. Radius is 3 px (4 px for dialogs). |
| A rainbow of accent colours | Surfaces are graphite. **Signal red** means *now* (playhead, sync line, record). **Amber** means *cue text*. Track/character colours exist only on content, never on controls. One colour, one meaning. |
| Marketing-cute copy ("Summoning melodrama…", "✨ Generate", exclamation marks) | Plain, specific, verb-first labels. Progress text says what is happening. No jokes in the interface; the games supply their own. |
| Decorative structure (01/02/03 on non-sequences, eyebrows, dividers that say nothing) | Letters A–D exist because the spec names the games A–D. Nothing else is numbered unless it is a sequence. |
| Centered hero + big number + gradient accent | No hero. Left-aligned, information first. |

## Tokens (dark only — a deliberate choice for a video tool, so the picture is the brightest thing)
`--bg #121211 · --panel #181817 · --panel2 #1f1f1d · --line #34332f · --text #ebe9e4 · --dim #a8a59c · --faint #8a877e · --signal #d4392c · --cue #e3b04b`
Contrast on `--panel`: text 14.6:1, dim 7.2:1, faint 4.9:1, cue 8.9:1; white on signal 4.75:1. All text ≥ 4.5:1.

## Type
System UI at 13 px (macOS default size), 11 px uppercase tracked labels for section headings, tabular monospace for timecode and numbers. A condensed display face (Avenir Next Condensed → Arial Narrow) only for the TV screens and lyrics, where it reads at distance.

## Signature
The red sync line of the rhythm band: text travels toward a single red line, exactly like a studio detection band. Everything else stays quiet so that line is the one thing you remember.

## 10-foot (TV) rules
* `F` toggles TV mode: UI scale ×1.55 (13 → 20 px base), lyrics 2.3 rem+ on a black lower-third (amber current word 10.6:1 on black).
* Left-aligned, 5 % title-safe margins, no hover-only affordances.
* Everything is reachable with Up/Down/Enter/Esc (a presenter clicker works); focus is a thick left bar plus an amber outline.
* One primary decision per screen; no more than four items in a menu.
* Motion: none except the record blink; `prefers-reduced-motion` disables it.

## Workflow and where things live
The studio is organised around what a dub actually needs, most-used first (inspired by transcribe-and-detect-speakers
on import in Descript, the green-room device check in Riverside, and the marker list in DaVinci Resolve):

0. **Clip library** (start page): add a clip once, prepare it (below), then start any number of dubbing, party or
   podcast projects from it. A clip opens in the studio without recording; *Start a project ▾* derives one.
   **Party: pick a clip** is the karaoke entry: anyone picks a clip and the character(s) they play; those voices go
   silent, only their lines light up, they record, the reveal plays, *Next player* goes back to the list.
1. **Prepare** (Voices tab, or automatically right after import): separate dialogue from music → subtitles → speakers,
   one checklist with a *Prepare all* button. Each step can be re-run on its own; mono clips fall back to the neural
   separator when it is installed.
2. **Characters as tracks** (fix who says what: split a passage with right-click or `S`, give each piece to the right
   character): every identified voice gets its own timeline lane (its passages, with the dialogue
   waveform), its own On/Off and Solo, and its colour is used by its cues everywhere (cue lane, rhythm band).
3. **Script** tab: the subtitles/cues, import/export .srt, transcription options.
4. **Marks** tab: the nine marks with time and an optional name; click to jump, `[` / `]` for previous/next.
5. **Record** tab: what happens while recording (count-in, mute original), the selected track's voice effect, and takes.
6. **Mix** and **AI** tabs: levels, ducking, ghost guide, lip flaps, display; translation and rewriting.

**Devices** (microphone, headphones or TV speakers, camera, latency) are not a tab: they are a dialog opened from the
chip in the top bar, which shows on every screen whether the mic is open and moving. The dialog starts listening at
once so the meter answers when you speak, and asks the headphones question that decides echo cancellation and
whether the original plays while recording.

## Sizing and overflow
Every area of the UI has a declared contract for what it does when its space changes. The table lives in code,
`apps/web/src/layout.ts` (selector, contract, one-sentence reason), the CSS implements it (`styles/app.css`,
"Sizing contracts"), and `e2e/layout.test.ts` checks every screen and dialog at 2560×1440, 1920×1080, 1440×900,
1366×768, 1280×720, 1024×640, 900×600 and 820×1180.

| Contract | Behaviour | Used by |
|---|---|---|
| document | the page is exactly the window and never scrolls | `html` |
| screen | the one area under the top bar; laid out to fit (no scroll on windows ≥ 1100×680); scrolls as a whole only when its regions cannot fit at their minimum sizes — the only page-level scroll | studio, podcast, party |
| page | a document-like screen: scrolls vertically, never horizontally | library, party setup screens |
| fit | sized by its content and never hides it: wraps, or its flexible parts shrink/ellipsize | top bar, transport, side column, tabs, timeline toolbar, toasts |
| scroll | takes the space it is given and scrolls inside itself (vertically); never pushes the layout | side panels, timeline lanes, dialogs, podcast settings, context menus |
| clip | media surface: scales its content into its box (letterboxed); never scrolls | video stage, rhythm band, timeline band, party stage |

What gives way first, in the studio: the picture shrinks (down to ~100 px of video), then the timeline band
(380 → 220 px, 38% of the height), the rhythm band keeps 72–108 px, and below that the screen scrolls. Narrower than
1000 px, two-column screens stack and the screen scrolls; regions may declare a different contract when stacked
(the podcast settings column becomes part of the page). Toolbar hints are the first text to go (one line, ellipsis,
full text on hover).

Adding an area: give it a class, add a row to `REGIONS` with its contract and reason, implement it in the
"Sizing contracts" CSS block, run `node --test e2e/layout.test.ts`. The test fails on any scroll container that is
not declared, so a new panel cannot invent its own scrolling silently.

## Context menus
Right-click (and the context-menu key or Shift+F10 on a focused element) follows one policy, implemented in
`packages/ui/src/menu.ts` and tested in `e2e/context-menu.test.ts`:
* **Text fields and links keep the browser's menu** (copy, paste, spelling, save link).
* **Elements with relevant actions get the app menu**, listing only what applies to that exact thing; destructive
  actions come last, after a separator, in red; shortcuts are shown next to the action they trigger.
* **Everything else shows nothing**: no app menu and no browser menu (Back/Reload/Inspect are noise in a tool).

| Where | Menu |
|---|---|
| Timeline ruler, on a mark | Jump to mark n · Delete mark n |
| Timeline ruler / thumbnails, elsewhere | Play from here · Set mark (next free number) here · range actions* |
| Original-audio lane | Play from here · range actions* |
| Character lane, on a passage | Split passage here · Listen to this passage · Silence / turn back on that character · This passage is ‹other character› (reassign; touching passages of one character merge) |
| Cue lane, on a cue | Split cue here (text cut at the nearest word) · Play · Record (punch) · Loop-record · Edit text · Delete cue |
| Cue lane, empty | Add a cue here · range actions* |
| Lip-flap lane | on a marker: Delete it; empty: Add a mouth-open marker here |
| Voice track, on a clip | Play from its start · Split clip here · Split at the playhead (when inside) · Denoise · Reset clip gain (when changed) · range actions* · Delete clip |
| Voice track, empty | Record on this track from here · Play from here · range actions* |
| Track header | Record on this track · Rename · Mute/Unmute · Solo/Unsolo · Remove track (not the last one) |
| Mark chip (toolbar) | Jump · Move to the playhead · Delete |
| Cue row (Cues panel) | Go to cue · then the cue actions above |
| Take (Takes panel) | Audition · Use this take · Use only the part inside the range (with a range) · Remove from list |
| Voice row (Mix panel) | Listen · Silence / turn back on · Hear only this one / Hear everyone |
| Video (studio) | Play/Pause · Show or hide subtitles · TV mode |
| Project row (library) | Open · Delete project |
| Chapter row (podcast) | Go to chapter · Move to the playhead · Delete chapter |

\* range actions, when a Shift-drag range exists: Loop this range · Re-record this range (punch in) · Clear range.

Menus open where clicked but are clamped inside the window, take keyboard focus (arrows, Home/End, Enter, Escape),
and close on any outside click, scroll, resize or window switch. Adding one: `registerMenu(selector, (el, at) =>
items | null)` next to the feature, unregister it in the feature's `destroy`, put shared logic in
`features/actions.ts` so buttons, shortcuts and menus run the same code, and add the row above.
