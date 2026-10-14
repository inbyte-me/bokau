// A whole party round through the real UI: the TV page and two phones (separate browser contexts = separate
// people, phone-sized, each with its own synthetic microphone). Silent: muted Chrome, fake mics, no hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

let app: TestApp;
let browser: Browser;
let tv: Page;
const phones: Page[] = [];
let clipId: string;
const errors: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function phone(name: string, mic: string): Promise<Page> {
  const ctx = await browser.createBrowserContext(); // its own storage: a different person
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(p, fx(mic));
  p.on('pageerror', (e: unknown) => errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`));
  return p;
}

test.before(async () => {
  app = await startApp();
  browser = await launch();
  clipId = await app.ingestFixture('clip_voices.mp4', 'pro', { template: true });
  await app.waitJob((await app.api('POST', `/api/projects/${clipId}/stems`, { method: 'auto' })).data.job);
  // the clip as prepared in the library: characters and their lines (the fixture's ground truth)
  const truth = JSON.parse(fs.readFileSync(fx('voices.json'), 'utf8')) as { speaker: string; start: number; end: number }[];
  const names = [...new Set(truth.map((x) => x.speaker))];
  const clip = (await app.api('GET', `/api/projects/${clipId}`)).data;
  clip.speakers = {
    list: names.map((n, i) => ({ id: `s${i + 1}`, name: n, color: ['#d97b66', '#6fb3a6', '#7a9cc9'][i], muted: false, solo: false })),
    segments: truth.map((x) => ({ start: x.start, end: x.end, speaker: `s${names.indexOf(x.speaker) + 1}` })),
  };
  // subtitles carry no character, as when they are made after the voices: the passages say who speaks each line
  clip.cues = truth.map((x, i) => ({ id: `c${i}`, start: x.start, end: x.end, text: `Line number ${i + 1}`, character: '', note: '' }));
  await app.api('PUT', `/api/projects/${clipId}`, clip);
  // one background track for the waiting phones
  const snd = await app.api('POST', '/api/sounds', fs.readFileSync(fx('music.wav')), { 'x-filename': 'music.wav' });
  await app.waitJob(snd.data.job);

  tv = await browser.newPage();
  await tv.setViewport({ width: 1440, height: 900 });
  await tv.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  tv.on('pageerror', (e: unknown) => errors.push(`tv: ${e instanceof Error ? e.message : String(e)}`));
  phones.push(await phone('pau', 'mic_speech.wav'), await phone('leo', 'speech_es.wav'));
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

const text = (p: Page, sel: string) => p.$eval(sel, (e) => e.textContent?.trim() ?? '');

test('TV opens a room, phones join by code, the TV picks a clip', async () => {
  await tv.goto(`${app.base}/#/party`);
  await tv.waitForSelector('#room-code');
  const code = await text(tv, '#room-code');
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.match(await tv.$eval('#join-url', (e) => e.getAttribute('title') ?? ''), new RegExp(`/play/\\?room=${code}$`));
  assert.ok((await tv.$$('svg.qr rect')).length > 100, 'a QR code to scan');

  for (const [i, p] of phones.entries()) {
    await p.goto(`${app.base}/play/?room=${code}`);
    await p.waitForSelector('#player-name');
    await p.type('#player-name', ['Pau', 'Leo'][i]);
    await p.click('#join');
    await p.waitForSelector('#room-screen[data-phase="lobby"]');
  }
  await tv.waitForFunction(() => document.querySelector('#player-count')?.textContent === '2', { timeout: 10_000 });

  // step 1: the scene, step 2: the game (dub the scene is the default), step 3: the players
  await tv.waitForSelector(`.clip-card[data-clip="${clipId}"]`);
  await tv.click(`.clip-card[data-clip="${clipId}"]`);
  await tv.waitForSelector('.game[data-mode="dub"].sel');
  assert.equal(await tv.$$eval('.game', (l) => l.length), 6, 'six games to choose from');
  // every game asks which language the players speak; a new room starts in the TV's (English here)
  await tv.waitForFunction(() => document.querySelector<HTMLSelectElement>('#language')?.value === 'en');
  await tv.click('#to-players');
  await tv.waitForSelector('#invite');
  await tv.waitForFunction(() => document.querySelectorAll('#players .player-tile').length === 2);
  assert.ok(!(await tv.$eval('#cast', (b) => (b as HTMLButtonElement).disabled)));
});

test('a reload keeps the same player (token remembered per phone)', async () => {
  const p = phones[0];
  await p.reload();
  await p.waitForSelector('#room-screen[data-phase="lobby"]');
  await wait(300);
  assert.equal(await tv.$$eval('#players .player-tile', (l) => l.length), 2, 'no duplicate after the reload');
});

test('casting: every phone learns its part, the cast taps "ready" (microphone)', async () => {
  await tv.click('#cast');
  await tv.waitForSelector('#cast-list li');
  const cast = await tv.$$eval('#cast-list li', (l) => l.length);
  assert.equal(cast, 2, 'two players, two parts');
  for (const p of phones) {
    await p.waitForSelector('#room-screen[data-phase="casting"]');
    await p.waitForSelector('#ready:not([disabled])', { timeout: 60_000 }); // the scene downloads first
    await p.click('#ready');
    await p.waitForSelector('#ready-ok');
  }
});

test('turns: the called phone records and sends its line, the others wait with music', async () => {
  await tv.click('#begin');
  await tv.waitForSelector('#now-recording');
  let turns = 0;
  for (let guard = 0; guard < 30; guard++) {
    const phase = await tv.$eval('#party-room', (e) => e.getAttribute('data-phase'));
    if (phase !== 'playing') break;
    // whose turn: the phone that shows its line
    let mine: Page | null = null;
    for (let tries = 0; tries < 100 && !mine; tries++) {
      for (const p of phones) if (await p.$('#my-turn')) mine = p;
      if (!mine) await wait(150);
      if ((await tv.$eval('#party-room', (e) => e.getAttribute('data-phase'))) !== 'playing') break;
    }
    if (!mine) break;
    const other = phones.find((p) => p !== mine) as Page;
    assert.ok(await other.$('#now-recording'), 'the other phone shows who is recording');
    assert.equal(
      await other.$eval('audio', (a) => !(a as HTMLAudioElement).paused && (a as HTMLAudioElement).src.includes('/sounds/')),
      true,
      'and plays the background music',
    );
    assert.ok((await text(mine, '#my-line')).startsWith('Line number'), 'the line to say');
    await mine.click('#record');
    await mine.waitForSelector('#send', { timeout: 60_000 }); // countdown + the line + tail, then review
    await mine.click('#send');
    turns++;
    await mine.waitForFunction(() => document.querySelector('#my-turn')?.getAttribute('data-step') !== 'sending', {
      timeout: 30_000,
    });
    await wait(200);
  }
  assert.ok(turns >= 2, `every cast player had a turn (${turns})`);
  await tv.waitForSelector('#party-show', { timeout: 60_000 });
});

test('the show: the compiled round has one track per part with the takes, and plays on the TV', async () => {
  const projectId = await tv.evaluate(() => location.hash);
  void projectId;
  const list = (await app.api('GET', '/api/projects?kind=projects')).data as { id: string; mode: string; sourceTemplateId: string; takes: number }[];
  const round = list.find((p) => p.mode === 'party' && p.sourceTemplateId === clipId);
  assert.ok(round, 'the round is a party project derived from the clip');
  const p = (await app.api('GET', `/api/projects/${round.id}`)).data;
  assert.equal(p.tracks.length, 2);
  assert.ok(
    p.tracks.every((t: { clips: unknown[] }) => t.clips.length > 0),
    'every part has its takes on its track',
  );
  assert.ok(p.dubbed.length >= 2, 'the original voice is silenced where lines were re-recorded');
  // the result is the slice the players dubbed, cut out of the clip (two players, so two of its three characters)
  const clip = (await app.api('GET', `/api/projects/${clipId}`)).data;
  const slice = p.party.slice as { start: number; end: number };
  assert.ok(slice, 'the round was cut down to its slice');
  assert.ok(Math.abs(p.media.duration - (slice.end - slice.start)) < 0.25, `the media is the slice (${p.media.duration} s)`);
  assert.ok(p.media.duration < clip.media.duration - 1, 'not the whole clip (and the library clip keeps all of its media)');
  assert.ok(
    p.cues.every((c: { start: number; end: number }) => c.start >= 0 && c.end <= p.media.duration + 0.01),
    'cues in the slice time',
  );
  const voices = new Set(p.speakers.segments.filter((g: { start: number; end: number }) => g.end - g.start > 0.1).map((g: { speaker: string }) => g.speaker));
  assert.equal(voices.size, 2, 'as many characters as players');
  await tv.waitForSelector('#party-show[data-state="playing"], #party-show[data-state="ready"]', { timeout: 30_000 });
  for (const ph of phones) assert.ok(await ph.$('#room-screen[data-phase="show"]'), 'phones say: look at the TV');

  await tv.waitForSelector('#change-game', { timeout: 30_000 });
  await tv.click('#change-game');
  await tv.waitForSelector('.game[data-mode="dub"]');
  for (const ph of phones) await ph.waitForSelector('#room-screen[data-phase="lobby"]');
});

test('blind dubbing round: silent stretches, the next phone hears how the last one ended, the result stays hidden until the show', async () => {
  await tv.click('.game[data-mode="blind"]');
  await tv.waitForSelector('.game[data-mode="blind"].sel');
  await tv.click('#to-players');
  await tv.waitForSelector('#cast:not([disabled])');
  await tv.click('#cast');
  await tv.waitForSelector('#begin:not([disabled])');
  for (const p of phones) {
    await p.waitForSelector('#room-screen[data-phase="casting"] #game-name');
    assert.match(await text(p, '#game-name'), /Blind Dubbing/);
  }
  await tv.click('#begin');
  await tv.waitForSelector('#now-recording');
  let turns = 0;
  let heardPrevious = false;
  for (let guard = 0; guard < 30; guard++) {
    if ((await tv.$eval('#party-room', (e) => e.getAttribute('data-phase'))) !== 'playing') break;
    let mine: Page | null = null;
    for (let tries = 0; tries < 100 && !mine; tries++) {
      for (const p of phones) if (await p.$('#my-turn')) mine = p;
      if (!mine) await wait(150);
    }
    if (!mine) break;
    // a later turn opens on how the previous player ended (its last second, played), then the silent scene
    if (turns > 0) {
      await mine.waitForSelector('#my-turn[data-step="intro"][data-heard]', { timeout: 15_000 });
      heardPrevious = true;
      await mine.click('#ready-turn');
    }
    await mine.waitForSelector('#record');
    assert.match(await text(mine, '#my-line'), /Make up what they say/);
    await mine.click('#record');
    await mine.waitForSelector('#send', { timeout: 60_000 });
    await mine.click('#send');
    turns++;
    await wait(300);
  }
  assert.ok(turns >= 2, `turns: ${turns}`);
  assert.ok(heardPrevious, 'a later player heard the end of the previous take before their scene');
  await tv.waitForSelector('#party-show', { timeout: 60_000 });
  const list = (await app.api('GET', '/api/projects?kind=projects')).data as { id: string; updatedAt: string }[];
  const latest = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const p = (await app.api('GET', `/api/projects/${latest.id}`)).data;
  assert.equal(p.party.mode, 'blind');
  assert.ok(
    p.tracks.every((t: { name: string }) => ['Pau', 'Leo'].includes(t.name)),
    'one track per player',
  );
});

test('trailer director: pitch, a critic, a title, and the trailer plays on the TV', async () => {
  const forTask = async (p: Page, kind: string, words: string) => {
    const box = `#task[data-kind="${kind}"][data-stage="write"]`;
    await p.waitForSelector(`${box} textarea`, { timeout: 30_000 });
    await p.type(`${box} textarea`, words);
    await p.click(`${box} button[type="submit"]`);
    // sent: the card says so, or it is gone because that answer closed the contest
    await p.waitForFunction((sel) => !document.querySelector(sel) || document.querySelector(sel)?.hasAttribute('data-done'), {}, box);
  };
  // the previous show plays out first; its buttons show only between plays, so click the moment they appear
  await tv.waitForFunction(
    () => {
      const b = document.querySelector<HTMLButtonElement>('#change-game');
      b?.click();
      return !!b;
    },
    { timeout: 120_000, polling: 'mutation' },
  );
  await tv.click('.game[data-mode="trailer"]');
  await tv.waitForSelector('.game[data-mode="trailer"].sel');
  await tv.click('#to-players');
  await tv.waitForSelector('#cast:not([disabled])');
  await tv.click('details.rules summary');
  await tv.select('#scenes', '2'); // one scene each keeps the test short
  await tv.waitForFunction(() => document.querySelector('details.rules summary')?.textContent?.includes('2 scenes'));
  await tv.click('#cast');
  // the characters are described first, each by one player; the cast is revealed after
  await tv.waitForSelector('#cards');
  for (const p of phones) await forTask(p, 'card', 'Gruff, slow, suspicious of cheese');
  await tv.waitForSelector('#begin:not([disabled])');
  assert.match(await text(tv, '#cast-list'), /1 scenes|1 scene/);
  assert.match(await text(tv, '#cast-list'), /Gruff, slow/, 'the cast is revealed with the cards');
  for (const p of phones) {
    await p.waitForSelector('#room-screen[data-phase="casting"] #ready:not([disabled])', { timeout: 60_000 });
    await p.click('#ready');
    await p.waitForSelector('#ready-ok');
  }
  await tv.click('#begin');

  // the pitch: the clip loops silently on the TV and on every phone; two writers, so no vote
  await tv.waitForSelector('#pitching video');
  for (const [i, p] of phones.entries()) {
    await p.waitForSelector('#task[data-kind="pitch"] video');
    await forTask(p, 'pitch', ['A bank heist by hamsters', 'A love story about a vault'][i]);
  }
  await tv.waitForSelector('#trailer-board', { timeout: 15_000 });

  // scene 1: the performer reads the room's direction; the other phone is the critic
  let first: Page | null = null;
  for (let tries = 0; tries < 100 && !first; tries++) {
    for (const p of phones) if (await p.$('#my-turn')) first = p;
    if (!first) await wait(150);
  }
  assert.ok(first, 'a phone is called');
  const critic = phones.find((p) => p !== first) as Page;
  assert.match(await text(first, '#my-line'), /hamsters|vault/, 'the performer is told what the movie is about');
  await forTask(critic, 'review', 'A triumph of the human spirit');
  await first.click('#record');
  await first.waitForSelector('#send', { timeout: 60_000 });
  await first.click('#send');

  // scene 2: nobody was free to direct it (the AI wrote it, or the pitch stands in); the other phone titles the movie
  await critic.waitForSelector('#my-turn #my-line', { timeout: 30_000 });
  assert.ok((await text(critic, '#my-line')).length > 0, 'a direction for the last scene');
  await forTask(first, 'title', 'Cheddar Hard');
  await critic.click('#record');
  await critic.waitForSelector('#send', { timeout: 60_000 });
  await critic.click('#send');

  // the show: the trailer's cards play over the black gaps
  await tv.waitForSelector('#party-show', { timeout: 90_000 });
  await tv.waitForSelector('#party-show .card[data-kind="opening"]', { timeout: 30_000 });
  const list = (await app.api('GET', '/api/projects?kind=projects')).data as { id: string; updatedAt: string }[];
  const latest = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const p = (await app.api('GET', `/api/projects/${latest.id}`)).data;
  assert.equal(p.party.mode, 'trailer');
  assert.equal(p.party.trailer.title, 'Cheddar Hard');
  assert.equal(p.tracks.length, 2, 'a track per character');
  assert.deepEqual(
    p.party.trailer.cards.map((c: { kind: string }) => c.kind),
    ['opening', 'critic', 'title'],
  );
  assert.equal(p.tracks.length, 2);
});

test('no page errors on the TV or the phones', () => {
  assert.deepEqual(errors, []);
});
