// What a phone is asked to do right now (write something, vote for something), worked out from the room's contests
// and, in the trailer game, the next performer's review. Games decide what to ask; the phone shows the same tools.
import { type Contest, optionsFor } from './contest.ts';
import type { PartyCharacter, Room } from './protocol.ts';

export type TaskKind = Contest['kind'] | 'review';

/** One thing a phone is asked to do right now: write a text, or vote for one. */
export interface TaskView {
  id: string;
  kind: TaskKind;
  stage: 'write' | 'vote';
  /** epoch ms */
  deadline: number;
  /** I have answered (wrote, or voted) */
  done: boolean;
  /** what I wrote (to edit it) */
  mine: string;
  /** vote: what I may vote for */
  options: { id: string; text: string }[];
  /** the voted entry */
  voted: string | null;
  /** the moment of the clip this is about (the pitch: the whole clip) */
  scene: { start: number; end: number } | null;
  /** the movie's pitch, once decided */
  logline: string | null;
  /** the direction given to the scene before (directions continue the story) */
  before: string | null;
  /** the character this is about (a card describes them; a direction is for a scene they speak in) */
  character: Pick<PartyCharacter, 'id' | 'name' | 'color' | 'card'> | null;
}

/** The tasks for one player in this room. */
export function tasksFor(r: Room, playerId: string): TaskView[] {
  const tr = r.trailer;
  const range = (cueId: string) => {
    const l = r.lines.find((x) => x.cueId === cueId);
    return l ? { start: l.start, end: l.end } : null;
  };
  const whole = r.clip?.duration ? { start: 0, end: r.clip.duration } : null;
  const who = (id: string | null | undefined): TaskView['character'] => {
    const c = r.characters.find((x) => x.id === id);
    return c ? { id: c.id, name: c.name, color: c.color, ...(c.card ? { card: c.card } : {}) } : null;
  };
  const base = { done: false, mine: '', options: [], voted: null, logline: tr?.logline ?? null, before: null, character: null };
  const tasks: TaskView[] = [];
  for (const c of r.contests) {
    if (c.stage === 'done' || !c.who.includes(playerId)) continue;
    const scene = c.scene !== null ? (tr?.scenes[c.scene] ? range(tr.scenes[c.scene].cueId) : null) : c.kind === 'pitch' ? whole : null;
    // a card is about a character, shown in one of their lines; a direction, about the character speaking in its scene
    const sceneOf = c.scene !== null ? tr?.scenes[c.scene] : undefined;
    const character = who(c.kind === 'card' ? c.subject : sceneOf?.character);
    const cardScene = c.kind === 'card' ? range(r.lines.find((l) => l.character === c.subject)?.cueId ?? '') : null;
    const before = c.scene !== null ? (tr?.scenes[c.scene - 1]?.direction ?? null) : null;
    if (c.stage === 'write') {
      const mine = c.entries.find((e) => e.playerId === playerId)?.text ?? '';
      tasks.push({ ...base, id: c.id, kind: c.kind, stage: 'write', deadline: c.deadline, done: !!mine, mine, scene: scene ?? cardScene, before, character });
    } else {
      const options = optionsFor(c, playerId).map(({ id, text }) => ({ id, text }));
      const voted = c.votes[playerId] ?? null;
      tasks.push({ ...base, id: c.id, kind: c.kind, stage: 'vote', deadline: c.deadline, done: voted !== null, options, voted, scene, before, character });
    }
  }
  // the next performer reviews the movie while the scene before theirs is recorded (all they know is the pitch)
  const next = tr?.scenes[tr.next];
  if (tr && r.phase === 'playing' && tr.next > 0 && next?.playerId === playerId && tr.scenes[tr.next - 1]?.playerId !== playerId) {
    const gap = tr.next - 1;
    const mine = tr.reviews.find((x) => x.gap === gap && x.playerId === playerId)?.text ?? '';
    tasks.push({ ...base, id: `review:${gap}`, kind: 'review', stage: 'write', deadline: 0, done: !!mine, mine, scene: null });
  }
  return tasks;
}
