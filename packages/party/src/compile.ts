import { type Clip, newCue, newId, newTrack, type Project, type Take, type TimeRange, type Track } from '@doblaje/core';
import type { TrailerResult } from './montage.ts';
import type { Room } from './protocol.ts';
import { recorded } from './room.ts';

/**
 * Put a finished round into its project: one track per cast part ("Ana · Pau", or the player for blind dubbing),
 * the written lines as subtitles for written games, each take at its turn and trimmed to it (turns tile the slice,
 * so takes never overlap), and the original voice silenced over each recorded turn (skipped turns keep it).
 * The TV then plays the project like any other, through the shared mix graph.
 * `cut`: the slice the project's media was cut down to (the server does that first); everything is moved into the
 * slice's time and what lies outside it is dropped, so the result is the dubbed slice and nothing else.
 */
export function compileRound(project: Project, room: Room, cut: TimeRange | null = null): Project {
  const p = structuredClone(project);
  const done = recorded(room);
  const lineOf = (cueId: string) => room.lines.find((l) => l.cueId === cueId);
  const tracks: Track[] = room.cast.map((role, i) => {
    const char = room.characters.find((c) => c.id === role.characterId);
    const player = room.players.find((x) => x.id === role.playerId);
    const takes: Take[] = [];
    const clips: Clip[] = [];
    for (const r of done) {
      const line = lineOf(r.cueId);
      if (!line || line.character !== role.characterId || r.playerId !== role.playerId) continue;
      const takeId = r.file.replace(/^take_/, '').replace(/\.wav$/, '');
      takes.push({ id: takeId, file: r.file, start: r.start, duration: r.duration, label: line.text.slice(0, 60), createdAt: new Date().toISOString() });
      // the take plays only inside its turn (the lead-in and the tail stay out of the neighbours' turns)
      const from = Math.max(r.start, line.start);
      const to = Math.min(r.start + r.duration, line.end);
      if (to > from) clips.push({ id: newId('c'), file: r.file, takeId, start: from, offset: from - r.start, duration: to - from, gain: 1 });
    }
    return newTrack({
      index: i,
      name: room.settings.mode === 'blind' ? (player?.name ?? '?') : `${char?.name ?? '?'} · ${player?.name ?? '?'}`,
      ...(char ? { color: char.color } : {}),
      player: player?.name,
      takes,
      clips: clips.sort((a, b) => a.start - b.start),
    });
  });
  if (tracks.length) p.tracks = tracks;
  // the original voices go silent where a line was re-recorded; blind dubbing silences the whole slice
  // (ranges already silenced in the clip, where a removed character spoke, stay silent)
  p.dubbed = [
    ...p.dubbed,
    ...(room.settings.mode === 'blind'
      ? room.lines.map((l) => ({ start: l.start, end: l.end }))
      : done
          .map((r) => lineOf(r.cueId))
          .filter((l) => l !== undefined)
          .map((l) => ({ start: l.start, end: l.end }))),
  ];
  // written games: the lines the players read become the subtitles of the result
  if (['badlip', 'telenovela', 'genre'].includes(room.settings.mode)) {
    const written = new Map(room.lines.flatMap((l) => (l.parts ?? [l]).map((x) => [x.cueId, x.text] as const)));
    for (const c of p.cues) if (written.has(c.id)) c.text = written.get(c.id) ?? c.text;
  }
  p.party = { ...p.party, room: room.code, round: room.round, mode: room.settings.mode, ...(cut ? { slice: { start: cut.start, end: cut.end } } : {}) };
  if (cut) shiftInto(p, cut);
  p.original = { ...p.original, mute: false, solo: false, source: 'full' };
  return p;
}

/** Move a project into a stretch of its old timeline: times start at the stretch, whatever lies outside is dropped. */
export function shiftInto(p: Project, cut: TimeRange): void {
  const len = cut.end - cut.start;
  const move = <T extends TimeRange>(list: T[]): T[] =>
    list
      .filter((x) => x.end > cut.start + 0.01 && x.start < cut.end - 0.01)
      .map((x) => ({ ...x, start: Math.max(0, x.start - cut.start), end: Math.min(len, x.end - cut.start) }));
  p.cues = move(p.cues);
  p.lipFlaps = move(p.lipFlaps);
  p.dubbed = move(p.dubbed);
  p.speakers = { ...p.speakers, segments: move(p.speakers.segments) };
  p.markers = p.markers.filter((m) => m.t >= cut.start && m.t <= cut.end).map((m) => ({ ...m, t: m.t - cut.start }));
  for (const t of p.tracks) {
    t.takes = t.takes.map((k) => ({ ...k, start: k.start - cut.start }));
    // a take recorded with a lead-in may begin before the slice: trim its head instead
    t.clips = t.clips.map((c) => {
      const start = c.start - cut.start;
      const head = Math.max(0, -start);
      return { ...c, start: start + head, offset: c.offset + head, duration: Math.max(0, c.duration - head) };
    });
  }
  p.loop = null;
}

/**
 * Put a finished trailer round into its project. The media was assembled by `plan.parts` (the scenes in order with
 * black gaps between them, see `planTrailer`), so everything moves onto that timeline: each take goes where its scene
 * now is, trimmed to the scene, one track per performer; the original voice is silenced over every recorded scene;
 * the cards become the project's subtitles (so the studio and exports show them) and are kept in `party.trailer`.
 */
export function compileTrailer(project: Project, room: Room, result: TrailerResult): Project {
  const p = structuredClone(project);
  const done = recorded(room);
  const placed = new Map(result.scenes.map((s) => [s.cueId, s]));
  p.tracks = room.cast.map((role, i) => {
    const player = room.players.find((x) => x.id === role.playerId);
    const char = room.characters.find((c) => c.id === role.characterId);
    const takes: Take[] = [];
    const clips: Clip[] = [];
    for (const r of done) {
      const scene = placed.get(r.cueId);
      if (!scene || scene.character !== role.characterId) continue;
      const takeId = r.file.replace(/^take_/, '').replace(/\.wav$/, '');
      const shift = scene.at - scene.start; // clip time → trailer time
      takes.push({ id: takeId, file: r.file, start: r.start + shift, duration: r.duration, label: char?.name ?? '?', createdAt: new Date().toISOString() });
      // the take plays only inside its scene
      const from = Math.max(r.start, scene.start);
      const to = Math.min(r.start + r.duration, scene.end);
      if (to > from) clips.push({ id: newId('c'), file: r.file, takeId, start: from + shift, offset: from - r.start, duration: to - from, gain: 1 });
    }
    return newTrack({
      index: i,
      name: `${char?.name ?? '?'} · ${player?.name ?? '?'}`,
      ...(char ? { color: char.color } : {}),
      player: player?.name,
      takes,
      clips: clips.sort((a, b) => a.start - b.start),
    });
  });
  p.dubbed = done
    .map((r) => placed.get(r.cueId))
    .filter((s) => s !== undefined)
    .map((s) => ({ start: s.at, end: s.at + (s.end - s.start) }));
  // the clip's own subtitles and voices belong to the old timeline: the cards replace them
  p.cues = result.cards.map((c) =>
    newCue({ start: c.at, end: c.at + c.seconds, text: [c.text, c.by && c.sub ? `— ${c.by}, ${c.sub}` : (c.sub ?? '')].filter(Boolean).join('\n') }),
  );
  p.speakers = { ...p.speakers, segments: [] };
  p.lipFlaps = [];
  p.markers = [];
  p.loop = null;
  p.party = { ...p.party, room: room.code, round: room.round, mode: 'trailer', trailer: result };
  p.original = { ...p.original, mute: false, solo: false, source: 'full' };
  return p;
}
