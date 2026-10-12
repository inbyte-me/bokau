// Editing actions shared by buttons, keyboard shortcuts and context menus, so each exists once.
import { assignSegment, type Clip, type Cue, errorMessage, newCue, newId, segmentAt, splitSegment, splitTextAt, type TimeRange } from '@doblaje/core';
import { t, toast } from '@doblaje/ui';
import { api } from '../api.ts';
import { app } from '../app.ts';

/** Server-side clean-up of one clip's take (rumble, denoise, leveling); the clip then points to the cleaned file. */
export async function denoiseClip(clip: Clip): Promise<void> {
  try {
    await app.session.flushUploads();
    toast(t('Cleaning…'));
    const r = await api.post<{ name: string; gainDb: number }>(`/api/projects/${app.project.id}/takes/${clip.file}/clean`);
    const res = await fetch(`/media/${app.project.id}/takes/${r.name}`);
    app.engine.assets?.addTake(r.name, await app.engine.ctx.decodeAudioData(await res.arrayBuffer()));
    app.store.commit('Denoise clip', () => {
      clip.file = r.name;
    }, ['tracks']);
    void app.engine.refresh();
    toast(t('Clip cleaned (+{g} dB makeup)', { g: r.gainDb.toFixed(1) }), 'ok');
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

export function deleteClip(id: string): void {
  app.store.commit(
    'Delete clip',
    (p) => {
      for (const tr of p.tracks) tr.clips = tr.clips.filter((c) => c.id !== id);
    },
    ['tracks'],
  );
  if (app.sel.clipId === id) app.select({ clipId: null });
  void app.engine.refresh();
}

export function deleteCue(id: string): void {
  app.store.commit(
    'Delete cue',
    (p) => {
      p.cues = p.cues.filter((c) => c.id !== id);
    },
    ['cues'],
  );
  if (app.sel.cueId === id) app.select({ cueId: null });
}

/** Play a cue with a little air around it. */
export const playCue = (c: Pick<Cue, 'start' | 'end'>): Promise<void> => app.engine.playRange(Math.max(0, c.start - 0.5), c.end + 0.3);

export function playFrom(time: number): void {
  app.engine.seek(time);
  if (!app.engine.playing) void app.engine.play(time);
}

export function setLoop(range: TimeRange | null): void {
  app.store.commit(
    'Loop',
    (p) => {
      p.loop = range ? { start: range.start, end: range.end } : null;
    },
    ['loop'],
  );
}

export function clearRange(): void {
  app.sel.region = null;
  app.emit('selection', app.sel);
}

// ---- splitting: so each piece can be given to the right character
/** Split a character passage at `time`. Returns false when the point is too close to an edge. */
export function splitPassageAt(idx: number, time: number): boolean {
  const next = splitSegment(app.project.speakers.segments, idx, time);
  if (!next) return false;
  app.store.commit(
    'Split passage',
    (p) => {
      p.speakers.segments = next;
    },
    ['speakers'],
  );
  app.select({ segIdx: idx + 1 });
  return true;
}

/** Give a passage to a character (touching passages of that character merge). */
export function assignPassage(idx: number, speaker: string): void {
  const g = app.project.speakers.segments[idx];
  if (!g) return;
  const next = assignSegment(app.project.speakers.segments, idx, speaker);
  app.store.commit(
    'Reassign passage',
    (p) => {
      p.speakers.segments = next;
    },
    ['speakers'],
  );
  app.select({ segIdx: segmentAt(next, (g.start + g.end) / 2) });
  void app.engine.refresh();
}

/** Split a cue at `time`; its text is cut at the nearest word boundary. Both halves keep the character for now. */
export function splitCueAt(cueId: string, time: number): boolean {
  const cue = app.project.cues.find((c) => c.id === cueId);
  if (!cue || time - cue.start < 0.1 || cue.end - time < 0.1) return false;
  const [left, right] = splitTextAt(cue, time);
  const second = newCue({ start: time, end: cue.end, text: right, character: cue.character, direction: cue.direction });
  app.store.commit(
    'Split cue',
    (p) => {
      const c = p.cues.find((x) => x.id === cueId);
      if (!c) return;
      c.end = time;
      c.text = left;
      p.cues.push(second);
      p.cues.sort((a, b) => a.start - b.start);
    },
    ['cues'],
  );
  app.select({ cueId: second.id });
  return true;
}

/** Split a voice clip at `time` (the take on disk is untouched; both halves reference it). */
export function splitClipAt(trackId: string, clipId: string, time: number): boolean {
  const tr = app.project.tracks.find((x) => x.id === trackId);
  const clip = tr?.clips.find((c) => c.id === clipId);
  if (!tr || !clip || time <= clip.start + 0.02 || time >= clip.start + clip.duration - 0.02) return false;
  app.store.commit('Split clip', () => {
    const cut = time - clip.start;
    tr.clips.push({ ...clip, id: newId('c'), start: time, offset: clip.offset + cut, duration: clip.duration - cut });
    clip.duration = cut;
    tr.clips.sort((a, b) => a.start - b.start);
  }, ['tracks']);
  void app.engine.refresh();
  return true;
}

/**
 * S: split what is selected (a passage, a cue or a clip) at the playhead; with nothing that fits selected, the
 * character passage under the playhead, then the clip under it on the current track.
 */
export function splitAtPlayhead(): boolean {
  const time = app.engine.time;
  const p = app.project;
  const { segIdx, cueId, clipId } = app.sel;
  if (segIdx != null) {
    const g = p.speakers.segments[segIdx];
    if (g && time > g.start && time < g.end) return splitPassageAt(segIdx, time);
  }
  if (cueId) {
    const c = p.cues.find((x) => x.id === cueId);
    if (c && time > c.start && time < c.end) return splitCueAt(cueId, time);
  }
  const tr = app.track;
  const selected = tr.clips.find((c) => c.id === clipId && time > c.start && time < c.start + c.duration);
  if (selected) return splitClipAt(tr.id, selected.id, time);
  const under = segmentAt(p.speakers.segments, time);
  if (under >= 0) return splitPassageAt(under, time);
  const clip = tr.clips.find((c) => time > c.start && time < c.start + c.duration);
  return clip ? splitClipAt(tr.id, clip.id, time) : false;
}
