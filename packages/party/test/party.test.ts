import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Action,
  castRoles,
  createRoom,
  type Env,
  isRoomCode,
  type PartyCharacter,
  type PartyLine,
  planLines,
  playerView,
  type Room,
  RoomError,
  recorded,
  reduce,
  seededRng,
} from '../src/index.ts';

const characters: PartyCharacter[] = [
  { id: 'A', name: 'Ana', color: '#f00', lines: 3 },
  { id: 'B', name: 'Beto', color: '#0f0', lines: 2 },
  { id: 'C', name: 'Carla', color: '#00f', lines: 2 },
  { id: 'D', name: 'Extra', color: '#999', lines: 0 },
];
const lines: PartyLine[] = [
  { cueId: 'c1', character: 'A', start: 0, end: 1.5, text: 'Hola' },
  { cueId: 'c2', character: 'B', start: 2, end: 3, text: 'Qué tal' },
  { cueId: 'c3', character: 'A', start: 3.5, end: 5, text: 'Bien' },
  { cueId: 'c4', character: 'C', start: 5.5, end: 7, text: 'Y yo' },
  { cueId: 'c5', character: 'B', start: 7.5, end: 9, text: 'Adiós' },
  { cueId: 'c6', character: 'A', start: 9.5, end: 10, text: 'Ya' },
  { cueId: 'c7', character: 'C', start: 10.5, end: 12, text: 'Fin' },
];
const clip = { id: 'clip1', name: 'Escena', poster: null, duration: 12 };

function game(seed = 7) {
  let now = 1_000_000;
  const env = (): Env => ({ now, rng });
  const rng = seededRng(seed);
  let room: Room = createRoom('ABCD', seed);
  const act = (a: Action) => {
    room = reduce(room, a, env());
    return room;
  };
  return {
    act,
    get room(): Room {
      return room;
    },
    phase: (): Room['phase'] => room.phase,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

function lobby(g: ReturnType<typeof game>, names = ['Pau', 'Leo', 'Mar', 'Iris']) {
  g.act({ type: 'set-clip', clip, characters, lines });
  for (const [i, name] of names.entries()) g.act({ type: 'join', playerId: `p${i}`, name });
}

test('a whole round: cast, every line called once, compile, show, again', () => {
  const g = game();
  lobby(g);
  g.act({ type: 'cast', projectId: 'proj1' });
  assert.equal(g.room.phase, 'casting');
  assert.equal(g.room.cast.length, 3, 'three speaking characters, four players: three cast');
  assert.ok(!g.room.cast.some((c) => c.characterId === 'D'), 'characters without lines are never cast');
  assert.equal(new Set(g.room.cast.map((c) => c.playerId)).size, 3, 'one character per person');
  assert.deepEqual(g.room.queue, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 'scene order, all lines fit under maxLines');

  g.act({ type: 'begin' });
  const seen: string[] = [];
  while (g.phase() === 'playing') {
    const turn = g.room.turn;
    assert.ok(turn);
    const owner = g.room.cast.find((c) => c.characterId === g.room.lines.find((l) => l.cueId === turn.cueId)?.character);
    assert.equal(turn.playerId, owner?.playerId, 'the turn goes to whoever plays that line');
    seen.push(turn.cueId);
    g.act({ type: 'status', playerId: turn.playerId, turn: turn.n, status: 'recording' });
    g.act({ type: 'uploading', playerId: turn.playerId, turn: turn.n });
    g.act({ type: 'submitted', playerId: turn.playerId, turn: turn.n, file: `take_${turn.cueId}.wav`, start: 1, duration: 1 });
  }
  assert.deepEqual(seen, g.room.queue);
  assert.equal(g.phase(), 'compiling');
  assert.equal(recorded(g.room).length, 7);
  g.act({ type: 'compiled' });
  assert.equal(g.room.phase, 'show');
  g.act({ type: 'again' });
  assert.equal(g.room.phase, 'lobby');
  assert.equal(g.room.clip?.id, 'clip1', 'the clip stays for the next round');
  assert.equal(g.room.results.length, 0);
});

test('casting prefers people who have played less', () => {
  const g = game(3);
  lobby(g, ['A', 'B', 'C', 'D', 'E', 'F']);
  g.act({ type: 'settings', settings: { maxCast: 3 } });
  g.act({ type: 'cast', projectId: 'p1' });
  const first = new Set(g.room.cast.map((c) => c.playerId));
  g.act({ type: 'finish' });
  g.act({ type: 'compiled' });
  g.act({ type: 'cast', projectId: 'p2' });
  const second = new Set(g.room.cast.map((c) => c.playerId));
  assert.equal([...second].filter((p) => first.has(p)).length, 0, 'the second round casts the three who waited');
});

test('a line times out: it is skipped (original voice) and the next one is called', () => {
  const g = game();
  lobby(g);
  g.act({ type: 'cast', projectId: 'p' });
  g.act({ type: 'begin' });
  const t1 = g.room.turn;
  assert.ok(t1);
  g.advance(10_000);
  g.act({ type: 'tick' });
  assert.equal(g.room.turn?.n, t1.n, 'not yet');
  g.advance(t1.deadline - g.now + 1);
  g.act({ type: 'tick' });
  assert.equal(g.room.turn?.n, t1.n + 1);
  assert.deepEqual(g.room.results[0], { cueId: t1.cueId, playerId: t1.playerId, file: null, start: 0, duration: 0 });
  // a late submit for the old turn is refused
  assert.throws(() => g.act({ type: 'submitted', playerId: t1.playerId, turn: t1.n, file: 'x.wav', start: 0, duration: 1 }), RoomError);
});

test('uploading buys time; only the called player may act on the turn', () => {
  const g = game();
  lobby(g);
  g.act({ type: 'cast', projectId: 'p' });
  g.act({ type: 'begin' });
  const t = g.room.turn;
  assert.ok(t);
  const other = g.room.players.find((p) => p.id !== t.playerId);
  assert.ok(other);
  assert.throws(() => g.act({ type: 'status', playerId: other.id, turn: t.n, status: 'recording' }), /not your turn/);
  g.advance(t.deadline - g.now - 100);
  g.act({ type: 'uploading', playerId: t.playerId, turn: t.n });
  g.advance(5_000);
  g.act({ type: 'tick' });
  assert.equal(g.room.turn?.n, t.n, 'the upload grace keeps the turn alive');
  g.act({ type: 'pass', playerId: t.playerId, turn: t.n });
  assert.equal(g.room.turn?.n, t.n + 1);
});

test('a player who is kicked mid-round loses their lines; the game goes on', () => {
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'cast', projectId: 'p' });
  assert.equal(g.room.cast.length, 2);
  g.act({ type: 'begin' });
  const t = g.room.turn;
  assert.ok(t);
  g.act({ type: 'kick', playerId: t.playerId });
  assert.equal(g.room.cast.length, 1);
  const left = g.room.cast[0].characterId;
  for (const c of g.room.queue) assert.equal(g.room.lines.find((l) => l.cueId === c)?.character, left);
  assert.notEqual(g.room.turn?.playerId, t.playerId);
});

test('phases guard the actions; reduce never mutates its input', () => {
  const g = game();
  assert.throws(() => g.act({ type: 'cast', projectId: 'p' }), /Pick a clip/);
  g.act({ type: 'set-clip', clip, characters, lines });
  assert.throws(() => g.act({ type: 'cast', projectId: 'p' }), /Nobody has joined/);
  assert.throws(() => g.act({ type: 'begin' }), RoomError);
  assert.throws(() => g.act({ type: 'join', playerId: 'x', name: '  <> ' }), /Type your name/);
  g.act({ type: 'join', playerId: 'x', name: 'Ana' });
  const before = structuredClone(g.room);
  const frozen = g.room;
  reduce(frozen, { type: 'cast', projectId: 'p' }, { now: 0, rng: seededRng(1) });
  assert.deepEqual(frozen, before);
});

test('player views hide other players’ scripts', () => {
  const g = game();
  lobby(g);
  g.act({ type: 'cast', projectId: 'p' });
  g.act({ type: 'begin' });
  const t = g.room.turn;
  assert.ok(t);
  const mine = playerView(g.room, t.playerId);
  assert.equal(mine.turn?.mine, true);
  assert.equal(mine.line?.cueId, t.cueId);
  assert.equal(mine.line?.text, 'Hola');
  assert.equal(mine.context.after?.cueId, 'c2');
  const watcher = g.room.players.find((p) => p.id !== t.playerId);
  assert.ok(watcher);
  const theirs = playerView(g.room, watcher.id);
  assert.equal(theirs.turn?.mine, false);
  assert.equal(theirs.line, null);
  assert.equal(theirs.context.before, null);
  assert.equal(theirs.context.after, null);
  assert.ok(!JSON.stringify(theirs).includes('Hola'), 'no script text leaks to watchers');
});

test('director: round-robin under the cap, shuffle keeps the same set', () => {
  const cast = [
    { playerId: 'x', characterId: 'A' },
    { playerId: 'y', characterId: 'B' },
  ];
  const capped = planLines(lines, cast, { maxLines: 3, order: 'scene' }, seededRng(1));
  assert.deepEqual(capped, ['c1', 'c2', 'c3'], 'A, B, then A again; in scene order');
  const shuffled = planLines(lines, cast, { maxLines: 5, order: 'shuffle' }, seededRng(1));
  assert.deepEqual([...shuffled].sort(), ['c1', 'c2', 'c3', 'c5', 'c6']);
  assert.deepEqual(castRoles(characters, [], 3, seededRng(1)), []);
});

test('room codes', () => {
  assert.ok(isRoomCode('ABCD'));
  assert.ok(!isRoomCode('AB0D'), 'no zero');
  assert.ok(!isRoomCode('abcd'));
});

test('a clip becomes a script; a finished round becomes tracks and dubbed ranges', async () => {
  const { defaultProject } = await import('@doblaje/core');
  const { compileRound, scriptOf } = await import('../src/index.ts');
  const clipProject = defaultProject({ id: 'clip1', name: 'Escena', mode: 'pro' });
  clipProject.speakers.list = [
    { id: 'A', name: 'Ana', color: '#f00', muted: false, solo: false },
    { id: 'B', name: 'Beto', color: '#0f0', muted: false, solo: false },
  ];
  clipProject.cues = [
    { id: 'c2', start: 2, end: 3, text: 'Qué tal', character: 'Beto', note: '' },
    { id: 'c1', start: 0, end: 1.5, text: 'Hola', character: 'Ana', note: '' },
    { id: 'cx', start: 4, end: 5, text: 'nadie', character: '', note: '' },
    { id: 'cy', start: 6, end: 7, text: '  ', character: 'Ana', note: '' },
  ];
  const s = scriptOf(clipProject);
  assert.deepEqual(
    s.lines.map((l) => [l.cueId, l.character]),
    [
      ['c1', 'A'],
      ['c2', 'B'],
    ],
  );
  assert.deepEqual(
    s.characters.map((c) => c.lines),
    [1, 1],
  );
  // a line with no character set is spoken by whoever the passages say (subtitles made after the voices)
  const untagged = structuredClone(clipProject);
  untagged.speakers.segments = [{ start: 9, end: 11, speaker: 'B' }];
  untagged.cues.push({ id: 'cz', start: 9.2, end: 10.8, text: 'Otra vez', character: '', note: '' });
  assert.deepEqual(scriptOf(untagged).lines.find((l) => l.cueId === 'cz')?.character, 'B');

  const g = game();
  g.act({ type: 'set-clip', clip: s.info, characters: s.characters, lines: s.lines });
  g.act({ type: 'join', playerId: 'p0', name: 'Pau' });
  g.act({ type: 'join', playerId: 'p1', name: 'Leo' });
  g.act({ type: 'cast', projectId: 'party1' });
  g.act({ type: 'begin' });
  const t1 = g.room.turn;
  assert.ok(t1);
  g.act({ type: 'submitted', playerId: t1.playerId, turn: t1.n, file: 'take_k1.wav', start: 0.05, duration: 1.4 });
  const t2 = g.room.turn;
  assert.ok(t2);
  g.act({ type: 'pass', playerId: t2.playerId, turn: t2.n });
  assert.equal(g.phase(), 'compiling');

  const out = compileRound(clipProject, g.room);
  assert.equal(out.tracks.length, 2, 'one track per cast part');
  const ana = out.tracks.find((t) => t.name.startsWith('Ana'));
  assert.equal(ana?.clips.length, 1);
  assert.equal(ana?.clips[0].file, 'take_k1.wav');
  assert.equal(ana?.color, '#f00');
  assert.equal(out.tracks.find((t) => t.name.startsWith('Beto'))?.clips.length, 0, 'the skipped line has no clip');
  // Ana's turn runs from the slice's start to halfway across the gap before Beto (1.5 → 2 s)
  assert.deepEqual(out.dubbed, [{ start: 0, end: 1.75 }], 'only the recorded turn silences the original');
  assert.equal(clipProject.tracks.length, 1, 'input untouched');
});

test('slice: the densest conversation, not a monologue; short clips play whole', async () => {
  const { pickSlice, linesIn } = await import('../src/index.ts');
  const long: PartyLine[] = [];
  // 0-60 s: one character talking alone; 100-130 s: three characters arguing
  for (let i = 0; i < 12; i++) long.push({ cueId: `m${i}`, character: 'A', start: i * 5, end: i * 5 + 4, text: 'blah' });
  for (let i = 0; i < 12; i++) long.push({ cueId: `d${i}`, character: ['A', 'B', 'C'][i % 3], start: 100 + i * 2.5, end: 100 + i * 2.5 + 2, text: 'x' });
  for (let seed = 1; seed < 6; seed++) {
    const s = pickSlice(long, { seconds: 40, players: 3, maxLines: 12 }, seededRng(seed));
    assert.ok(s);
    const inside = linesIn(long, s);
    assert.ok(inside.filter((l) => l.cueId.startsWith('d')).length >= 8, `seed ${seed}: the argument is in the slice`);
    assert.ok(!inside.some((l) => l.cueId.startsWith('m')), 'not the monologue');
    assert.ok(s.end - s.start <= 42);
  }
  assert.deepEqual(
    pickSlice(lines, { seconds: 45, players: 3 }, seededRng(1)),
    { start: 0, end: 13, players: 3 },
    'a 12 s clip with 3 characters plays whole for 3',
  );
  assert.equal(pickSlice([], { seconds: 45, players: 2 }, seededRng(1)), null);
});

test('slice: its characters are a multiple of the players, and every line in it gets dubbed', async () => {
  const { pickSlice, linesIn } = await import('../src/index.ts');
  // a long scene where up to four characters talk, in changing company
  const who = ['A', 'B', 'A', 'C', 'B', 'D', 'A', 'C', 'D', 'B', 'A', 'B', 'C', 'A', 'D', 'C', 'B', 'A'];
  const scene: PartyLine[] = who.map((c, i) => ({ cueId: `x${i}`, character: c, start: i * 3, end: i * 3 + 2.5, text: 't' }));
  for (const players of [1, 2, 3, 4]) {
    for (let seed = 1; seed < 8; seed++) {
      const s = pickSlice(scene, { seconds: 30, players, maxLines: 8 }, seededRng(seed));
      assert.ok(s);
      assert.equal(s.players, players, `${players} players: a slice for all of them exists`);
      const inside = linesIn(scene, s);
      const chars = new Set(inside.map((l) => l.character)).size;
      assert.equal(chars % players, 0, `${players} players, seed ${seed}: ${chars} characters`);
      assert.ok(inside.length <= 8, 'no more lines than the round allows');
      assert.ok(s.end - s.start <= 32);
      // nothing undubbed sneaks in at the edges
      assert.ok(!scene.some((l) => !inside.includes(l) && l.end > s.start && l.start < s.end), 'no partial line at the edges');
    }
  }
  // three characters, four players: nobody can share evenly, so the slice is planned for three
  const s = pickSlice(lines, { seconds: 45, players: 4 }, seededRng(1));
  assert.equal(s?.players, 3);
  // a player voices at most MAX_PARTS_EACH characters
  const crowd: PartyLine[] = 'ABCDEFGH'.split('').map((c, i) => ({ cueId: `y${i}`, character: c, start: i * 2, end: i * 2 + 1.5, text: 't' }));
  const one = pickSlice(crowd, { seconds: 60, players: 1 }, seededRng(1));
  assert.ok(one && new Set(linesIn(crowd, one).map((l) => l.character)).size <= 3);
});

test('casting: every character of the slice is dealt, the same number to each player', () => {
  const four: PartyCharacter[] = [
    { id: 'A', name: 'Ana', color: '#f00', lines: 5 },
    { id: 'B', name: 'Beto', color: '#0f0', lines: 4 },
    { id: 'C', name: 'Carla', color: '#00f', lines: 2 },
    { id: 'D', name: 'Dani', color: '#ff0', lines: 1 },
  ];
  const people = [
    { id: 'p', name: 'Pau', connected: true, played: 0 },
    { id: 'q', name: 'Leo', connected: true, played: 0 },
  ] as Parameters<typeof castRoles>[1];
  for (let seed = 1; seed < 6; seed++) {
    const cast = castRoles(four, people, 2, seededRng(seed));
    assert.equal(cast.length, 4, 'every character is cast');
    const per = (id: string) => cast.filter((c) => c.playerId === id).map((c) => c.characterId);
    assert.equal(per('p').length, 2);
    assert.equal(per('q').length, 2);
    // snake deal: the two most talkative go to different people
    assert.notEqual(cast.find((c) => c.characterId === 'A')?.playerId, cast.find((c) => c.characterId === 'B')?.playerId);
  }
});

test('a round for two on a three-character scene: two characters in the slice, all of its lines queued', () => {
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'cast', projectId: 'p' });
  const slice = g.room.slice;
  assert.ok(slice);
  const inside = lines.filter((l) => l.start >= slice.start && l.end <= slice.end);
  assert.equal(new Set(inside.map((l) => l.character)).size, 2);
  assert.deepEqual([...g.room.queue].sort(), inside.map((l) => l.cueId).sort(), 'every line in the slice is dubbed');
  assert.equal(new Set(g.room.cast.map((c) => c.playerId)).size, 2, 'both play');
});

test('the result is the slice: times move to the slice, what lies outside is dropped', async () => {
  const { defaultProject } = await import('@doblaje/core');
  const { compileRound } = await import('../src/index.ts');
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'cast', projectId: 'p' });
  g.act({ type: 'begin' });
  const t1 = g.room.turn;
  assert.ok(t1);
  const line = lines.find((l) => l.cueId === t1.cueId);
  assert.ok(line);
  g.act({ type: 'submitted', playerId: t1.playerId, turn: t1.n, file: 'take_k1.wav', start: line.start - 0.3, duration: 2 });
  g.act({ type: 'finish' });
  const slice = g.room.slice;
  assert.ok(slice);
  const p = defaultProject({ id: 'p', name: 'Round', mode: 'party' });
  p.cues = lines.map((l) => ({ id: l.cueId, start: l.start, end: l.end, text: l.text, character: l.character, note: '' }));
  const out = compileRound(p, g.room, slice);
  const len = slice.end - slice.start;
  assert.ok(out.cues.length > 0 && out.cues.every((c) => c.start >= 0 && c.end <= len + 1e-9), 'cues within the slice, from 0');
  assert.equal(out.cues.length, lines.filter((l) => l.end > slice.start && l.start < slice.end).length);
  const clip = out.tracks.flatMap((t) => t.clips)[0];
  assert.ok(clip.start >= 0, 'a take that began before the slice is trimmed, not moved before 0');
  assert.ok(Math.abs(clip.start - clip.offset - (line.start - 0.3 - slice.start)) < 1e-9, 'the take stays in sync with the picture');
  assert.deepEqual(out.party.slice, { start: slice.start, end: slice.end });
});

test('heard text and suggestions reach the right phone, only for this round', () => {
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'cast', projectId: 'p' });
  assert.ok(g.room.slice);
  g.act({ type: 'begin' });
  const t1 = g.room.turn;
  assert.ok(t1);
  g.act({ type: 'suggestion', cueId: t1.cueId, text: '¡Hola, cacahuete!' });
  assert.equal(playerView(g.room, t1.playerId).line?.suggestion, '¡Hola, cacahuete!');
  g.act({ type: 'heard', cueId: t1.cueId, text: 'ignored: no take yet' });
  assert.equal(g.room.heard[t1.cueId], undefined);
  g.act({ type: 'submitted', playerId: t1.playerId, turn: t1.n, file: 'take_a.wav', start: 0, duration: 1 });
  g.act({ type: 'heard', cueId: t1.cueId, text: 'hola cacahuete' });
  g.act({ type: 'suggestion', cueId: t1.cueId, text: 'late' });
  assert.equal(g.room.suggestions[t1.cueId], '¡Hola, cacahuete!', 'a recorded line takes no new suggestion');
  const t2 = g.room.turn;
  assert.ok(t2);
  const v2 = playerView(g.room, t2.playerId);
  if (v2.context.before?.cueId === t1.cueId) assert.equal(v2.context.before.heard, 'hola cacahuete', 'the next player sees what was actually said');
  g.act({ type: 'finish' });
  g.act({ type: 'compiled' });
  g.act({ type: 'again' });
  assert.deepEqual(g.room.heard, {});
  assert.deepEqual(g.room.suggestions, {});
  assert.equal(g.room.slice, null);
});

test('blind dubbing: silent segments dealt round-robin, named after the players, the previous take is passed on', () => {
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'settings', settings: { mode: 'blind', maxLines: 6 } });
  g.act({ type: 'cast', projectId: 'p' });
  assert.equal(g.room.preparing, false, 'nothing to write');
  assert.ok(
    g.room.lines.every((l) => l.text === '' && l.cueId.startsWith('seg')),
    'silent segments, no script',
  );
  assert.equal(g.room.cast.length, 2);
  const names = g.room.characters.map((c) => c.name).sort();
  assert.deepEqual(names, ['Leo', 'Pau'], 'each voice is a player');
  const segs = g.room.lines;
  for (let i = 1; i < segs.length; i++) assert.ok(Math.abs(segs[i].start - segs[i - 1].end) < 1e-9, 'segments are contiguous');
  assert.notEqual(segs[0].character, segs[1].character, 'turns alternate');
  g.act({ type: 'begin' });
  const t1 = g.room.turn;
  assert.ok(t1);
  g.act({ type: 'submitted', playerId: t1.playerId, turn: t1.n, file: 'take_a.wav', start: segs[0].start, duration: 3 });
  const t2 = g.room.turn;
  assert.ok(t2);
  const v = playerView(g.room, t2.playerId);
  assert.equal(v.mode, 'blind');
  assert.equal(v.context.before?.take, 'take_a.wav', 'the next player gets the previous take');
  g.act({ type: 'finish' });
  g.act({ type: 'compiled' });
  g.act({ type: 'again' });
  assert.deepEqual(g.room.lines, g.room.source.lines, 'the next round starts from the clip again');
});

test('written games wait for their script; the script replaces the text, not the timing', () => {
  const g = game();
  lobby(g);
  g.act({ type: 'settings', settings: { mode: 'badlip', premise: '  a lazy cat  ' } });
  assert.equal(g.room.settings.premise, 'a lazy cat');
  g.act({ type: 'cast', projectId: 'p' });
  assert.equal(g.room.preparing, true);
  assert.throws(() => g.act({ type: 'begin' }), /still being written/);
  const first = g.room.queue[0];
  const before = g.room.lines.find((l) => l.cueId === first);
  g.act({ type: 'script', texts: { [first]: { text: '¡Mi gato es un pirata!' } } });
  assert.equal(g.room.preparing, false);
  const after = g.room.lines.find((l) => l.cueId === first);
  assert.equal(after?.text, '¡Mi gato es un pirata!');
  assert.equal(after?.start, before?.start);
  g.act({ type: 'begin' });
  assert.equal(g.room.phase, 'playing');
  assert.equal(g.room.source.lines.find((l) => l.cueId === first)?.text, before?.text, 'the clip script is untouched');
  assert.throws(() => g.act({ type: 'settings', settings: { mode: 'nonsense' as never } }), /between rounds/);
});

test('turns: one character each, consecutive lines merge, they tile the slice without overlapping', async () => {
  const { turnsOf } = await import('../src/index.ts');
  const scene: PartyLine[] = [
    { cueId: 'a1', character: 'A', start: 1, end: 2, text: 'Uno' },
    { cueId: 'a2', character: 'A', start: 2.2, end: 3, text: 'Dos' },
    { cueId: 'b1', character: 'B', start: 4, end: 5, text: 'Tres' },
    { cueId: 'a3', character: 'A', start: 4.8, end: 6, text: 'Cuatro' }, // talks over B
    { cueId: 'b2', character: 'B', start: 7, end: 8, text: 'Cinco' },
  ];
  const turns = turnsOf(scene, { start: 0, end: 9 });
  assert.deepEqual(
    turns.map((t) => [t.cueId, t.character, t.parts?.map((x) => x.cueId)]),
    [
      ['a1', 'A', ['a1', 'a2']],
      ['b1', 'B', ['b1']],
      ['a3', 'A', ['a3']],
      ['b2', 'B', ['b2']],
    ],
    'consecutive lines of one character are one turn',
  );
  assert.equal(turns[0].text, 'Uno\nDos');
  assert.equal(turns[0].start, 0, 'the first turn starts with the slice');
  assert.equal(turns.at(-1)?.end, 9, 'the last ends with it');
  for (let i = 1; i < turns.length; i++) assert.equal(turns[i].start, turns[i - 1].end, `turn ${i + 1} starts where turn ${i} ends`);
  assert.equal(turns[1].start, 3.5, 'halfway across the gap');
  assert.equal(turns[2].start, 4.9, 'halfway across talk-over');
});

test('a round plays turns; a take is trimmed to its turn, so no two takes overlap', async () => {
  const { defaultProject } = await import('@doblaje/core');
  const { compileRound } = await import('../src/index.ts');
  const g = game();
  lobby(g, ['Pau', 'Leo']);
  g.act({ type: 'cast', projectId: 'p' });
  assert.ok(
    g.room.lines.every((l) => l.parts?.length),
    'every round line is a turn',
  );
  g.act({ type: 'begin' });
  // every player records with a generous lead-in and tail, well into the neighbouring turns
  for (let guard = 0; guard < 20 && g.room.turn; guard++) {
    const turn = g.room.turn;
    const line = g.room.lines.find((l) => l.cueId === turn.cueId);
    assert.ok(line);
    g.act({
      type: 'submitted',
      playerId: turn.playerId,
      turn: turn.n,
      file: `take_${turn.n}.wav`,
      start: line.start - 1.5,
      duration: line.end - line.start + 3,
    });
  }
  assert.equal(g.phase(), 'compiling');
  const out = compileRound(defaultProject({ id: 'p', name: 'Round', mode: 'party' }), g.room);
  const clips = out.tracks.flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
  assert.equal(clips.length, g.room.lines.length);
  for (let i = 1; i < clips.length; i++) assert.ok(clips[i].start >= clips[i - 1].start + clips[i - 1].duration - 1e-9, 'takes do not overlap');
  for (const c of clips) {
    const cueId = g.room.results.find((r) => r.file === c.file)?.cueId;
    const turn = g.room.lines.find((l) => l.cueId === cueId);
    assert.ok(turn && c.start >= turn.start - 1e-9 && c.start + c.duration <= turn.end + 1e-9, `${c.file} stays inside its turn`);
    assert.ok(c.offset > 0, 'the lead-in is trimmed off');
  }
});

test('slice: a stretch where characters talk over each other is avoided when there is another', async () => {
  const { pickSlice, linesIn } = await import('../src/index.ts');
  const scene: PartyLine[] = [
    // 0-10 s: A and B shouting over each other
    { cueId: 'x1', character: 'A', start: 0, end: 4, text: 't' },
    { cueId: 'x2', character: 'B', start: 2, end: 6, text: 't' },
    { cueId: 'x3', character: 'A', start: 5, end: 9, text: 't' },
    // 30-40 s: A and B taking turns
    { cueId: 'y1', character: 'A', start: 30, end: 32, text: 't' },
    { cueId: 'y2', character: 'B', start: 33, end: 35, text: 't' },
    { cueId: 'y3', character: 'A', start: 36, end: 38, text: 't' },
  ];
  for (let seed = 1; seed < 6; seed++) {
    const s = pickSlice(scene, { seconds: 12, players: 2 }, seededRng(seed));
    assert.ok(s);
    assert.ok(
      linesIn(scene, s).every((l) => l.cueId.startsWith('y')),
      `seed ${seed}: the clean conversation`,
    );
  }
});
