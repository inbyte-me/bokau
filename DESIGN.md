# Design rules

The product is a dubbing booth. It should look like a piece of studio equipment, not a SaaS dashboard.

## What counts as "AI slop" here (and is banned)
| Tell | Rule |
|---|---|
| Emoji as icons or headings | Never. One line-icon set (`public/js/icons.js`, 16 px grid, 1.5 px stroke). Text labels stay next to icons. |
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
