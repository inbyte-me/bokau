// The trailer game's own state, next to the room's: the scenes (which character speaks, who performs it, the
// direction it was given) and the critics' reviews. The contests it runs (pitch, directions, title) live in the room's
// list of contests, like any game's. Pure helpers; room.ts decides when to call them.
import { type Contest, openContest, VOTE_SECONDS } from './contest.ts';

export interface TrailerScene {
  /** the scene's line in `room.lines` (its range is where the picture comes from) */
  cueId: string;
  /** the character who speaks in it (the performer plays them, as their card says) */
  character: string;
  /** who performs it: whoever plays that character */
  playerId: string;
  /** what the room decided this scene is about; null until decided (the scene waits for it) */
  direction: string | null;
}

/** A critic's quote: written by the next performer while the scene before theirs was recorded. */
export interface Review {
  playerId: string;
  /** the scene it follows in the trailer (the quote plays in the gap after it) */
  gap: number;
  text: string;
}

export interface TrailerState {
  scenes: TrailerScene[];
  /** index of the next scene to call */
  next: number;
  /** the next call waits for what it needs (a direction, or the title after the last scene) */
  holding: boolean;
  /** the winning pitch: what the movie is about */
  logline: string | null;
  title: string | null;
  reviews: Review[];
}

/** Seconds the room has to pitch the movie while the scene plays silently. */
export const PITCH_SECONDS = 60;
/** The shortest time a direction gets to be written. */
export const DIRECTION_MIN_SECONDS = 20;

export const newTrailer = (scenes: TrailerScene[]): TrailerState => ({ scenes, next: 0, holding: false, logline: null, title: null, reviews: [] });

/** Everyone present pitches the movie. */
export function openPitch(contests: Contest[], present: readonly string[], now: number): void {
  contests.push(openContest('pitch', 'pitch', present, now + PITCH_SECONDS * 1000));
}

/**
 * Scene `idx` has just been called to the stage (its turn ends at `turnDeadline`). The room starts on what the next
 * scene needs: its direction, written by everyone but the two who perform around it (the one recording, and the next,
 * who writes a review instead; the same person twice has no review); after the last scene, the title, written by
 * everyone but the one recording.
 */
export function startScene(t: TrailerState, contests: Contest[], idx: number, present: readonly string[], now: number, turnDeadline: number): void {
  const here = t.scenes[idx]?.playerId;
  const upcoming = t.scenes[idx + 1];
  const writeUntil = Math.max(now + DIRECTION_MIN_SECONDS * 1000, turnDeadline - VOTE_SECONDS * 1000);
  if (upcoming) {
    const who = present.filter((id) => id !== here && id !== upcoming.playerId);
    contests.push(openContest(`direction:${idx + 1}`, 'direction', who, writeUntil, idx + 1));
  } else {
    contests.push(
      openContest(
        'title',
        'title',
        present.filter((id) => id !== here),
        writeUntil,
      ),
    );
  }
}
