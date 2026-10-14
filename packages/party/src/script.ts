import { type Project, speakerOfCue } from '@doblaje/core';
import type { ClipInfo, PartyCharacter, PartyLine } from './protocol.ts';

/**
 * What a library clip offers to a party room: its characters (the voices found while preparing it) and every
 * subtitle line that one of them speaks: the voice heard most during the line, else the name typed on it
 * (`speakerOfCue`). Lines nobody known speaks, or without text, are not played.
 */
export function scriptOf(clip: Project): { info: ClipInfo; characters: PartyCharacter[]; lines: PartyLine[] } {
  const lines: PartyLine[] = [];
  for (const c of [...clip.cues].sort((a, b) => a.start - b.start)) {
    const s = speakerOfCue(c, clip.speakers);
    if (!s || !c.text.trim() || c.end <= c.start) continue;
    lines.push({ cueId: c.id, character: s.id, start: c.start, end: c.end, text: c.text.trim() });
  }
  const characters = clip.speakers.list.map((s) => ({ id: s.id, name: s.name, color: s.color, lines: lines.filter((l) => l.character === s.id).length }));
  const info: ClipInfo = {
    id: clip.id,
    name: clip.name,
    poster: clip.media?.ready ? `/media/${clip.id}/poster.jpg` : null,
    duration: clip.media?.duration ?? 0,
  };
  return { info, characters, lines };
}
