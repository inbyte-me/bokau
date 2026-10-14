import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Action,
  advanceContest,
  type Contest,
  castVote,
  createRoom,
  type Env,
  needsTick,
  openContest,
  type PartyCharacter,
  type PartyLine,
  planTrailer,
  playerView,
  type Room,
  reduce,
  seededRng,
  submitEntry,
  trailerMoments,
} from '../src/index.ts';

const characters: PartyCharacter[] = ['A', 'B', 'C'].map((id, i) => ({ id, name: `Char ${id}`, color: '#888', lines: 8 + i }));
const line = (i: number, character: string): PartyLine => ({ cueId: `c${i + 1}`, character, start: i * 4 + 0.5, end: i * 4 + 2.7, text: `Line ${i + 1}` });
// a 90 s clip: a line every ~4 s, characters taking turns in pairs
const lines: PartyLine[] = Array.from({ length: 22 }, (_, i) => line(i, ['A', 'A', 'B', 'C', 'B'][i % 5]));
// six lines, three characters in turn: a trailer of six scenes plays every one of them
const six: PartyLine[] = ['A', 'B', 'C', 'A', 'B', 'C'].map((c, i) => line(i, c));
// two characters in turn
const duo: PartyLine[] = ['A', 'B', 'A', 'B', 'A', 'B'].map((c, i) => line(i, c));
const clip = { id: 'clip1', name: 'The Heist', poster: null, duration: 90 };
const present = (...ids: string[]) => new Set(ids);

function game(players = 3, seed = 11, script: PartyLine[] = lines) {
  let now = 1_000_000;
  const rng = seededRng(seed);
  let room: Room = createRoom('ABCD', seed);
  const env = (): Env => ({ now, rng });
  const act = (a: Action) => {
    room = reduce(room, a, env());
    return room;
  };
  act({ type: 'set-clip', clip, characters, lines: script });
  for (let i = 0; i < players; i++) act({ type: 'join', playerId: `p${i}`, name: `Player ${i}` });
  return {
    act,
    get room() {
      return room;
    },
    advance(ms: number) {
      now += ms;
      return act({ type: 'tick' });
    },
    get now() {
      return now;
    },
  };
}
type G = ReturnType<typeof game>;

/** Every character described by whoever was asked (the cards phase), so the cast is revealed. */
function described(g: G) {
  for (const c of structuredClone(g.room.contests).filter((x) => x.kind === 'card'))
    g.act({ type: 'submit', playerId: c.who[0], task: c.id, text: `card of ${c.subject}` });
  assert.equal(g.room.phase, 'casting');
  return g;
}

/** Cast, describe the characters, begin, and let everyone pitch (the winner is the first player's idea when voters pick it). */
function pitched(g: G, idea = 'a bank heist by hamsters') {
  g.act({ type: 'settings', settings: { mode: 'trailer', scenes: 6 } });
  g.act({ type: 'cast', projectId: 'proj' });
  assert.equal(g.room.phase, 'cards');
  described(g);
  g.act({ type: 'begin' });
  assert.equal(g.room.phase, 'pitch');
  const ids = g.room.players.map((p) => p.id);
  for (const id of ids) g.act({ type: 'submit', playerId: id, task: 'pitch', text: id === 'p0' ? idea : `idea of ${id}` });
  const pitch = g.room.contests.find((c) => c.id === 'pitch');
  if (pitch?.stage === 'vote') {
    // nobody votes for themselves: everybody picks p0's idea (p0 picks p1's)
    for (const id of ids) {
      const wanted = pitch.entries.find((e) => e.playerId === (id === 'p0' ? 'p1' : 'p0'));
      assert.ok(wanted);
      g.act({ type: 'vote', playerId: id, task: 'pitch', entry: wanted.id });
    }
  }
  return g;
}

// ------------------------------------------------------------------ contests
test('a contest: write, vote for the best (never your own), the winner is the result', () => {
  const rng = seededRng(1);
  const c: Contest = openContest('direction:1', 'direction', ['a', 'b', 'c'], 1000, 1);
  assert.ok(submitEntry(c, 'a', '  They find the\u0007 vault  '));
  assert.ok(!submitEntry(c, 'z', 'not invited'), 'only the people it was opened for');
  assert.ok(submitEntry(c, 'b', 'It is empty'));
  assert.ok(submitEntry(c, 'c', 'A dog appears'));
  assert.equal(c.entries[0].text, 'They find the vault', 'control characters and spaces cleaned');
  advanceContest(c, 500, present('a', 'b', 'c'), rng);
  assert.equal(c.stage, 'vote', 'everyone wrote: voting starts at once');
  assert.ok(!castVote(c, 'a', c.entries[0].id), 'not for your own entry');
  assert.ok(castVote(c, 'a', c.entries[2].id));
  assert.ok(castVote(c, 'b', c.entries[2].id));
  assert.ok(castVote(c, 'c', c.entries[0].id));
  advanceContest(c, 600, present('a', 'b', 'c'), rng);
  assert.equal(c.stage, 'done');
  assert.equal(c.text, 'A dog appears');
});

test('a contest with one entry, or too few writers to vote, needs no vote; with none it waits for a text, then falls back', () => {
  const rng = seededRng(2);
  const one = openContest('title', 'title', ['a', 'b', 'c'], 1000);
  submitEntry(one, 'a', 'Hamsters');
  advanceContest(one, 1000, present('a', 'b', 'c'), rng); // time is up
  assert.equal(one.text, 'Hamsters');

  const two = openContest('direction:1', 'direction', ['a', 'b'], 1000, 1);
  submitEntry(two, 'a', 'one');
  submitEntry(two, 'b', 'two');
  advanceContest(two, 10, present('a', 'b'), rng);
  assert.equal(two.stage, 'done', 'two writers: a vote would be each for the other, so one is picked');
  assert.ok(['one', 'two'].includes(two.text ?? ''));

  const none = openContest('direction:2', 'direction', [], 1000, 2);
  advanceContest(none, 10, present(), rng);
  assert.equal(none.stage, 'done');
  assert.equal(none.text, null);
  assert.ok(none.fill, 'nobody to write it: the server may supply a text');
});

// ------------------------------------------------------------------ the moments
test('trailer moments are spread over the clip, in order, and never touch each other', () => {
  const m = trailerMoments(lines, 6, seededRng(3));
  assert.equal(m.length, 6);
  for (let i = 1; i < m.length; i++) assert.ok(m[i].start >= m[i - 1].end, `moment ${i} starts after the one before`);
  assert.ok(m[0].start < 20, 'starts near the beginning');
  assert.ok(m.at(-1)?.end ?? 0 > 70, 'ends near the end');
  for (const x of m) {
    // every moment holds whole lines of one character: it covers the lines it overlaps
    const inside = lines.filter((l) => l.start < x.end && l.end > x.start);
    assert.equal(new Set(inside.map((l) => l.character)).size, 1, 'one character per moment');
  }
  // asked for variety, the picks cover the characters even when the spread alone would repeat one
  for (let seed = 1; seed < 20; seed++) {
    const m = trailerMoments(lines, 3, seededRng(seed), { variety: 3 });
    assert.equal(new Set(m.map((x) => x.character)).size, 3, `seed ${seed}`);
    for (let i = 1; i < m.length; i++) assert.ok(m[i].start >= m[i - 1].end);
  }
  assert.equal(trailerMoments(lines.slice(0, 2), 6, seededRng(3)).length, 1, 'fewer moments than asked when the clip has fewer');
});

// ------------------------------------------------------------------ cards
test('a card step: each character is described by one player, blind to who plays them; the card follows the character', () => {
  const g = game(3, 11, six);
  g.act({ type: 'settings', settings: { mode: 'trailer', scenes: 6 } });
  g.act({ type: 'cast', projectId: 'proj' });
  assert.equal(g.room.phase, 'cards');
  const cards = g.room.contests.filter((c) => c.kind === 'card');
  assert.deepEqual(cards.map((c) => c.subject).sort(), ['A', 'B', 'C']);
  assert.equal(new Set(cards.map((c) => c.who[0])).size, 3, 'three characters, three writers');
  // blind: nobody learns who plays whom yet, though everyone knows they are in the round
  for (const p of g.room.players) {
    const v = playerView(g.room, p.id);
    assert.deepEqual(v.mine, []);
    assert.deepEqual(v.cast, []);
    assert.equal(v.inRound, true);
    const task = v.tasks[0];
    assert.equal(task.kind, 'card');
    assert.ok(task.character && ['A', 'B', 'C'].includes(task.character.id), 'the writer is shown the character');
    assert.ok(task.scene, 'with a moment where they speak');
  }
  const [first, ...rest] = cards;
  g.act({ type: 'submit', playerId: first.who[0], task: first.id, text: 'Gruff, slow, suspicious of cheese' });
  assert.equal(g.room.phase, 'cards', 'the others are still writing');
  for (const c of rest) g.act({ type: 'submit', playerId: c.who[0], task: c.id, text: `card ${c.subject}` });
  assert.equal(g.room.phase, 'casting');
  assert.equal(g.room.characters.find((c) => c.id === first.subject)?.card, 'Gruff, slow, suspicious of cheese');
  // the cast is revealed with the card, whoever wrote it
  for (const role of g.room.cast) {
    const mine = playerView(g.room, role.playerId).mine.find((c) => c.id === role.characterId);
    assert.ok(mine?.card, 'the player sees their character’s card');
  }
});

test('a card nobody writes falls back after the wait, so the round still starts', () => {
  const g = game(3, 11, six);
  g.act({ type: 'settings', settings: { mode: 'trailer' } });
  g.act({ type: 'cast', projectId: 'proj' });
  g.advance(61_000);
  assert.ok(
    g.room.contests.every((c) => c.fill),
    'asked for a text',
  );
  g.advance(13_000);
  assert.equal(g.room.phase, 'casting');
  assert.ok(
    g.room.characters.every((c) => !c.card),
    'no card is better than a made-up one',
  );
});

test('the other games can describe their characters first too (a setting); blind dubbing has none', () => {
  const g = game(2, 5);
  g.act({ type: 'settings', settings: { mode: 'dub', cards: true } });
  g.act({ type: 'cast', projectId: 'proj' });
  assert.equal(g.room.phase, 'cards');
  assert.equal(g.room.contests.filter((c) => c.kind === 'card').length, g.room.characters.length);
  described(g);
  g.act({ type: 'begin' });
  assert.equal(g.room.phase, 'playing');
  assert.ok(playerView(g.room, g.room.turn?.playerId ?? '').line?.card, 'the line shows the character’s card');

  const off = game(2, 5);
  off.act({ type: 'cast', projectId: 'proj' });
  assert.equal(off.room.phase, 'casting', 'off by default: nothing changes');
  const blind = game(2, 5);
  blind.act({ type: 'settings', settings: { mode: 'blind', cards: true } });
  blind.act({ type: 'cast', projectId: 'proj' });
  assert.equal(blind.room.phase, 'casting');
});

// ------------------------------------------------------------------ the round
test('casting a trailer: the scenes keep their real characters, and a character is always played by the same player', () => {
  const g = game(3, 11, six);
  g.act({ type: 'settings', settings: { mode: 'trailer', scenes: 6 } });
  g.act({ type: 'cast', projectId: 'proj' });
  const tr = g.room.trailer;
  assert.ok(tr);
  assert.equal(tr.scenes.length, 6);
  assert.deepEqual(
    tr.scenes.map((s) => s.character),
    ['A', 'B', 'C', 'A', 'B', 'C'],
  );
  for (const s of tr.scenes) assert.equal(s.playerId, g.room.cast.find((c) => c.characterId === s.character)?.playerId);
  assert.equal(new Set(tr.scenes.map((s) => s.playerId)).size, 3, 'three characters, three performers');
  assert.deepEqual(g.room.characters.map((c) => c.name).sort(), ['Char A', 'Char B', 'Char C'], 'the clip’s own characters');
  assert.equal(g.room.slice, null, 'no single stretch');
});

test('a trailer needs two players', () => {
  const g = game(1);
  g.act({ type: 'settings', settings: { mode: 'trailer' } });
  assert.throws(() => g.act({ type: 'cast', projectId: 'p' }), /at least two players/);
});

test('pitch, then every scene is directed while the one before it is recorded', () => {
  const g = pitched(game(3, 11, six));
  const tr = () => g.room.trailer;
  assert.equal(g.room.phase, 'playing', 'the pitch is decided: the first scene goes to the stage');
  assert.equal(tr()?.logline, 'a bank heist by hamsters');
  assert.equal(tr()?.scenes[0].direction, 'a bank heist by hamsters', 'the first scene is given the pitch');
  const turn = g.room.turn;
  assert.ok(turn);
  const [first, second, third] = [0, 1, 2].map((i) => tr()?.scenes[i].playerId ?? '');

  // while scene 1 is recorded: the third player directs scene 2, the second reviews, the first has nothing to do
  const direction = g.room.contests.find((c) => c.id === 'direction:1');
  assert.deepEqual(direction?.who, [third], 'everyone but the performer and the next performer');
  const kinds = (id: string) => playerView(g.room, id).tasks.map((t) => `${t.kind}:${t.stage}`);
  assert.deepEqual(kinds(first), []);
  assert.deepEqual(kinds(second), ['review:write']);
  assert.deepEqual(kinds(third), ['direction:write']);
  const task = playerView(g.room, third).tasks[0];
  assert.ok(task.scene, 'the director sees the next scene');
  assert.equal(task.character?.id, 'B', 'and who speaks in it');
  assert.equal(task.character?.card, 'card of B', 'with their card');
  assert.equal(task.before, 'a bank heist by hamsters', 'and the direction of the scene before');
  assert.equal(playerView(g.room, second).tasks[0].scene, null, 'the critic sees none of the picture');

  g.act({ type: 'submit', playerId: second, task: 'review:0', text: 'A triumph of the human spirit' });
  g.act({ type: 'submit', playerId: third, task: 'direction:1', text: 'The vault is full of cheese' });
  assert.equal(tr()?.scenes[1].direction, 'The vault is full of cheese');
  assert.equal(tr()?.reviews[0].text, 'A triumph of the human spirit');
  assert.throws(() => g.act({ type: 'submit', playerId: first, task: 'review:0', text: 'sneaky' }), /Too late/);

  // the first performer sends the take: the second scene is called with its direction and their card
  const mine = playerView(g.room, first).line;
  assert.equal(mine?.direction, 'a bank heist by hamsters');
  assert.equal(mine?.card, 'card of A');
  g.act({ type: 'submitted', playerId: first, turn: turn.n, file: 'take_a.wav', start: 0, duration: 2 });
  assert.equal(g.room.turn?.playerId, second);
  assert.equal(playerView(g.room, second).line?.direction, 'The vault is full of cheese');
  assert.equal(playerView(g.room, first).line, null);
});

test('a player who performs twice in a row has no critic for that gap, and the one performing is the only one left out of the direction', () => {
  // three characters, two players: one player has two characters, and some scene follows another of theirs
  const g = game(2, 11, six);
  g.act({ type: 'settings', settings: { mode: 'trailer', scenes: 6 } });
  g.act({ type: 'cast', projectId: 'proj' });
  described(g);
  g.act({ type: 'begin' });
  for (const p of g.room.players) g.act({ type: 'submit', playerId: p.id, task: 'pitch', text: `idea ${p.id}` });
  const scenes = g.room.trailer?.scenes ?? [];
  const gap = scenes.findIndex((x, i) => i + 1 < scenes.length && x.playerId === scenes[i + 1].playerId);
  assert.ok(gap >= 0);
  const running = () => (g.room.trailer?.next ?? 0) - 1;
  for (let guard = 0; guard < 10 && running() < gap; guard++) {
    const turn = g.room.turn;
    assert.ok(turn);
    for (const c of structuredClone(g.room.contests)) {
      if (c.kind === 'direction' && c.fill) g.act({ type: 'fill', task: c.id, text: 'filled' });
      if (c.kind === 'direction' && c.stage === 'write') for (const w of c.who) g.act({ type: 'submit', playerId: w, task: c.id, text: 'x' });
    }
    g.act({ type: 'submitted', playerId: turn.playerId, turn: turn.n, file: `take_${guard}.wav`, start: 0, duration: 2 });
  }
  assert.equal(running(), gap);
  const performer = scenes[gap].playerId;
  assert.ok(
    !g.room.players.some((p) => playerView(g.room, p.id).tasks.some((t) => t.kind === 'review')),
    'nobody reviews: the next performer is busy recording',
  );
  const direction = g.room.contests.find((c) => c.id === `direction:${gap + 1}`);
  assert.ok(direction && !direction.who.includes(performer));
});

test('with two players nobody is left to direct: the scene waits for a text, and the fallback keeps the show moving', () => {
  const g = pitched(game(2, 11, duo));
  const turn = g.room.turn;
  assert.ok(turn);
  const next = g.room.contests.find((c) => c.id === 'direction:1');
  assert.deepEqual(next?.who, []);
  assert.equal(next?.fill, true, 'the server is asked for a text');
  g.act({ type: 'submitted', playerId: turn.playerId, turn: turn.n, file: 'take_a.wav', start: 0, duration: 2 });
  const turnNow = () => g.room.turn; // (a call, so the checks below are not narrowed by the one above)
  assert.equal(turnNow(), null, 'the next scene is held until its direction exists');
  assert.ok(needsTick(g.room, g.now + 13_000), 'the clock will give up waiting');

  // the AI answers
  g.act({ type: 'fill', task: 'direction:1', text: 'Plot twist: it was a dream' });
  assert.equal(turnNow()?.cueId, g.room.trailer?.scenes[1].cueId);
  assert.equal(playerView(g.room, turnNow()?.playerId ?? '').line?.direction, 'Plot twist: it was a dream');

  // the AI stays silent for the next one: after the wait the pitch is used
  g.act({ type: 'submitted', playerId: turnNow()?.playerId ?? '', turn: turnNow()?.n ?? 0, file: 'take_b.wav', start: 0, duration: 2 });
  assert.equal(turnNow(), null);
  g.advance(13_000);
  assert.equal(turnNow()?.cueId, g.room.trailer?.scenes[2].cueId);
  assert.equal(g.room.trailer?.scenes[2].direction, g.room.trailer?.logline, 'the pitch');
});

test('the last scene: the others title the movie, and the trailer is put together once the title is in', () => {
  const g = pitched(game(3, 11, six));
  const tr = () => g.room.trailer;
  // play every scene, sending takes at once; the directions are answered by whoever is asked (or the AI)
  const answer = () => {
    for (const c of structuredClone(g.room.contests)) {
      if (c.kind !== 'direction') continue; // the title is left for the end
      if (c.fill) g.act({ type: 'fill', task: c.id, text: `direction ${c.id}` });
      if (c.stage === 'write') for (const id of c.who) g.act({ type: 'submit', playerId: id, task: c.id, text: `idea of ${id}` });
    }
  };
  for (let guard = 0; guard < 12 && g.room.phase === 'playing'; guard++) {
    answer();
    const t = g.room.turn;
    if (!t) break;
    g.act({ type: 'submitted', playerId: t.playerId, turn: t.n, file: `take_${t.n}.wav`, start: 0, duration: 2 });
  }
  assert.equal(g.room.phase, 'playing', 'every scene recorded, still waiting for the title');
  assert.equal(g.room.turn, null);
  const title = g.room.contests.find((c) => c.id === 'title');
  const last = tr()?.scenes.at(-1)?.playerId;
  assert.ok(title && !title.who.includes(last ?? ''), 'the performer of the last scene does not write the title');
  const [a, b] = title.who;
  g.act({ type: 'submit', playerId: a, task: 'title', text: 'Hamster Heist' });
  g.act({ type: 'submit', playerId: b, task: 'title', text: 'Cheddar Hard' });
  assert.equal(g.room.phase, 'compiling', 'two writers: one title is picked and the trailer goes together');
  assert.ok(['Hamster Heist', 'Cheddar Hard'].includes(tr()?.title ?? ''));
});

test('a player who leaves hands their characters, and the scenes still to come, to the others', () => {
  const g = pitched(game(3, 11, six));
  g.act({ type: 'kick', playerId: 'p2' });
  const tr = g.room.trailer;
  assert.ok(tr);
  assert.ok(!g.room.cast.some((c) => c.playerId === 'p2'));
  for (const s of tr.scenes.slice(tr.next))
    assert.equal(s.playerId, g.room.cast.find((c) => c.characterId === s.character)?.playerId, 'the scene follows its character');
  assert.ok(tr.scenes.slice(tr.next).every((s) => s.playerId !== 'p2'));
});

// ------------------------------------------------------------------ the result
test('the plan: opening card, the scenes with a critic or a narrator line or a dip between, then the title', () => {
  const g = pitched(game(3, 11, six));
  const room = structuredClone(g.room);
  const tr = room.trailer;
  assert.ok(tr);
  tr.title = 'Hamster Heist';
  tr.reviews.push({ playerId: 'p1', gap: 0, text: 'A triumph' });
  const plan = planTrailer(room, { opening: 'IN A WORLD OF CHEESE', narrator: ['', 'One man', ''], publications: ['The Daily Reel'], tagline: 'Gouda luck' });
  const cards = plan.result.cards;
  assert.equal(cards[0].kind, 'opening');
  assert.equal(cards[0].at, 0);
  assert.equal(cards[1].kind, 'critic', 'the first gap has a review');
  assert.equal(cards[1].sub, 'The Daily Reel');
  assert.equal(cards[1].by, 'Player 1');
  assert.equal(cards[2].kind, 'narrator', 'the second gap has a narrator line');
  assert.equal(cards.at(-1)?.kind, 'title');
  assert.equal(cards.at(-1)?.sub, 'Gouda luck');
  const sum = plan.parts.reduce((a, p) => a + ('gap' in p ? p.gap : p.end - p.start), 0);
  assert.ok(Math.abs(sum - plan.result.duration) < 1e-6, 'the parts add up to the trailer');
  assert.equal(plan.result.scenes.length, 6);
  assert.deepEqual(
    plan.result.scenes.map((s) => s.character),
    ['A', 'B', 'C', 'A', 'B', 'C'],
  );
  // each scene sits at the sum of everything before it
  let at = 0;
  let k = 0;
  for (const part of plan.parts) {
    if (!('gap' in part)) assert.ok(Math.abs(plan.result.scenes[k++].at - at) < 1e-6);
    at += 'gap' in part ? part.gap : part.end - part.start;
  }
});
