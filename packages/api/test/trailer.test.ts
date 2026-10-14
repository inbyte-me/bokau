// The trailer game over the real server: the room pitches, directs, reviews and titles while two phones take turns
// recording; the result is a trailer (scenes and title cards) with every take on its own track.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostView, PlayerView, ServerMessage } from '@doblaje/party';
import { ffprobeJson, mockOpenRouter, startApp, type TestApp } from '@doblaje/testkit';
import { Client, wav } from './support/party.ts';

let app: TestApp;
let clipId: string;
let ai: Awaited<ReturnType<typeof mockOpenRouter>>;

test.before(async () => {
  // the AI: JSON for the trailer's copy, a plain line for a text nobody wrote
  ai = await mockOpenRouter((b) => {
    const system = String(b.messages[0].content);
    const content = system.includes('on-screen text')
      ? JSON.stringify({ opening: 'IN A WORLD OF CHEESE', narrator: ['One man'], publications: ['The Daily Reel'], tagline: 'Gouda luck' })
      : 'The vault is full of cheese';
    return { json: { model: 'mock/cheap', choices: [{ message: { content } }], usage: { cost: 0.00001, total_tokens: 50 } } };
  });
  app = await startApp({ ai: { openrouterBase: ai.url } });
  clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
  const put = await app.api('PUT', `/api/projects/${clipId}`, {
    speakers: {
      list: [
        { id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false },
        { id: 'B', name: 'Beto', color: '#6fb3a6', muted: false, solo: false },
      ],
      segments: [],
    },
    cues: [
      { id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' },
      { id: 'c2', start: 2.5, end: 4, text: 'Muy bien', character: 'Beto', note: '' },
      { id: 'c3', start: 4.5, end: 6, text: 'Me alegro', character: 'Ana', note: '' },
    ],
  });
  assert.equal(put.status, 200);
});
test.after(async () => {
  await app.close();
  await ai.close();
});

test('a trailer: characters described, pitch, a direction the AI writes, critics, a title, then the assembled trailer', async () => {
  const { code, hostKey } = (await app.api('POST', '/api/party/rooms')).data;
  const tv = new Client(app.base);
  await tv.open();
  tv.send({ type: 'hello-host', code, hostKey });
  const phones: Client[] = [];
  const tokens: Record<string, string> = {};
  const byId: Record<string, Client> = {};
  for (const name of ['Pau', 'Leo']) {
    const ph = new Client(app.base);
    await ph.open();
    ph.send({ type: 'hello-player', code, name });
    const w = await ph.next((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome');
    tokens[w.playerId] = w.token;
    byId[w.playerId] = ph;
    phones.push(ph);
  }
  tv.send({ type: 'host', command: { type: 'settings', settings: { mode: 'trailer' } } });
  tv.send({ type: 'host', command: { type: 'pick-clip', clipId } });
  await tv.view<HostView>((v) => !!v.room.clip && v.room.settings.mode === 'trailer');
  tv.send({ type: 'host', command: { type: 'cast' } });

  // the characters are described first, blind to who will play them
  const cards = await tv.view<HostView>((v) => v.room.phase === 'cards');
  const projectId = cards.room.projectId;
  assert.ok(projectId);
  assert.equal(cards.room.slice, null);
  assert.deepEqual(cards.room.characters.map((c) => c.name).sort(), ['Ana', 'Beto'], 'the clip’s own characters, three scenes');
  assert.equal(cards.room.trailer?.scenes.length, 3);
  const [pauId, leoId] = Object.keys(tokens);
  const asked = await byId[pauId].view<PlayerView>((v) => v.phase === 'cards' && v.tasks.length > 0);
  assert.equal(asked.mine.length, 0, 'the cast stays hidden while the characters are described');
  assert.equal(asked.tasks[0].kind, 'card');
  for (const c of cards.room.contests.filter((x) => x.kind === 'card')) {
    byId[c.who[0]].send({ type: 'player', action: { type: 'submit', task: c.id, text: `The voice of ${c.subject}` } });
  }
  const casting = await tv.view<HostView>((v) => v.room.phase === 'casting');
  assert.ok(
    casting.room.characters.every((c) => c.card?.startsWith('The voice of')),
    'every character has its card',
  );

  // everyone watches the whole clip and pitches
  tv.send({ type: 'host', command: { type: 'begin' } });
  await tv.view<HostView>((v) => v.room.phase === 'pitch');
  const pv = await byId[pauId].view<PlayerView>((v) => v.phase === 'pitch' && v.tasks.length > 0);
  assert.equal(pv.tasks[0].kind, 'pitch');
  assert.deepEqual(pv.tasks[0].scene, { start: 0, end: cards.room.clip?.duration }, 'the pitch is about the whole clip');
  byId[pauId].send({ type: 'player', action: { type: 'submit', task: 'pitch', text: 'Two friends rob a cheese vault' } });
  byId[leoId].send({ type: 'player', action: { type: 'submit', task: 'pitch', text: 'A tragic love story about a vault' } });
  const playing = await tv.view<HostView>((v) => v.room.phase === 'playing' && !!v.room.turn);
  const logline = playing.room.trailer?.logline ?? '';
  assert.ok(['Two friends rob a cheese vault', 'A tragic love story about a vault'].includes(logline));
  const scenes = playing.room.trailer?.scenes ?? [];
  assert.deepEqual(
    scenes.map((s) => s.character),
    [scenes[0].character, scenes[1].character, scenes[0].character],
  );
  assert.notEqual(scenes[0].playerId, scenes[1].playerId);

  // scene 1: the performer is told the pitch, and has their character’s card; nothing of the original lines
  const first = playing.room.turn;
  assert.ok(first);
  const second = scenes[1].playerId;
  const mine = await byId[first.playerId].view<PlayerView>((v) => v.turn?.mine === true && !!v.line);
  assert.equal(mine.line?.direction, logline);
  assert.match(mine.line?.card ?? '', /^The voice of/);
  assert.equal(mine.line?.text, '', 'no script');
  // the next performer is the critic: a review task, no picture
  const critic = await byId[second].view<PlayerView>((v) => v.tasks.some((t) => t.kind === 'review'));
  assert.equal(critic.tasks[0].scene, null);
  byId[second].send({ type: 'player', action: { type: 'submit', task: 'review:0', text: 'A triumph of the human spirit' } });
  // someone who is not asked cannot answer
  byId[first.playerId].send({ type: 'player', action: { type: 'submit', task: 'review:0', text: 'sneaky' } });
  const refused = await byId[first.playerId].next((m): m is Extract<ServerMessage, { type: 'error' }> => m.type === 'error');
  assert.match(refused.message, /Too late/);

  const upload = async (turn: { n: number; cueId: string; playerId: string }, room: HostView['room'], seconds: number) => {
    const line = room.lines.find((l) => l.cueId === turn.cueId);
    assert.ok(line);
    const r = await app.api('POST', `/api/party/rooms/${code}/takes?turn=${turn.n}&start=${line.start}`, wav(seconds), {
      'x-party-token': tokens[turn.playerId],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  };
  await upload(first, playing.room, 1.2);

  // nobody was free to direct scene two: the AI wrote it, and it is what the next performer reads
  const v2 = await tv.view<HostView>((v) => v.room.turn?.n === 2);
  assert.equal(v2.room.trailer?.scenes[1].direction, 'The vault is full of cheese');
  const second1 = await byId[second].view<PlayerView>((v) => v.turn?.mine === true && !!v.line);
  assert.equal(second1.line?.direction, 'The vault is full of cheese');
  // the first performer is the critic of the third scene (their own character again)
  byId[first.playerId].send({ type: 'player', action: { type: 'submit', task: 'review:1', text: 'Unforgettable' } });
  await upload(v2.room.turn as never, v2.room, 1.5);

  // last scene: the other player titles the movie
  const v3 = await tv.view<HostView>((v) => v.room.turn?.n === 3);
  const title = v3.room.contests.find((c) => c.kind === 'title');
  assert.deepEqual(title?.who, [second]);
  byId[second].send({ type: 'player', action: { type: 'submit', task: 'title', text: 'Cheddar Hard' } });
  await upload(v3.room.turn as never, v3.room, 1.4);
  const shown = await tv.view<HostView>((v) => v.room.phase === 'show');
  assert.equal(shown.room.trailer?.title, 'Cheddar Hard');

  // the result: scenes joined with cards between them, takes on their own tracks, cards as subtitles
  const p = (await app.api('GET', `/api/projects/${projectId}`)).data;
  assert.equal(p.party.mode, 'trailer');
  const result = p.party.trailer;
  assert.equal(result.title, 'Cheddar Hard');
  assert.equal(result.tagline, 'Gouda luck');
  assert.deepEqual(
    result.cards.map((c: { kind: string }) => c.kind),
    ['opening', 'critic', 'critic', 'title'],
  );
  assert.equal(result.cards[0].text, 'IN A WORLD OF CHEESE');
  assert.equal(result.cards[1].text, 'A triumph of the human spirit');
  assert.equal(result.cards[1].sub, 'The Daily Reel');
  assert.equal(result.scenes.length, 3);
  assert.ok(Math.abs(p.media.duration - result.duration) < 0.3, `media ${p.media.duration} vs trailer ${result.duration}`);
  assert.ok(Math.abs(Number(ffprobeJson(`${app.dir(projectId)}/proxy.mp4`).format.duration) - result.duration) < 0.3);
  assert.equal(p.tracks.length, 2, 'a track per character');
  assert.deepEqual(p.tracks.map((t: { clips: unknown[] }) => t.clips.length).sort(), [1, 2], 'a character’s scenes share its track');
  for (const t of p.tracks) {
    for (const c of t.clips) {
      const scene = result.scenes.find((s: { at: number; start: number; end: number }) => c.start >= s.at - 1e-6 && c.start < s.at + (s.end - s.start));
      assert.ok(scene && c.start + c.duration <= scene.at + (scene.end - scene.start) + 1e-6, 'the take plays inside its scene');
    }
  }
  assert.deepEqual(
    p.cues.map((c: { text: string }) => c.text.split('\n')[0]),
    ['IN A WORLD OF CHEESE', 'A triumph of the human spirit', 'Unforgettable', 'Cheddar Hard'],
    'the cards are the result’s subtitles',
  );
  assert.equal(p.dubbed.length, 3, 'the original voice is silenced over the scenes');
  tv.close();
  for (const c of phones) c.close();
});
