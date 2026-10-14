// A party with no TV: one phone creates the room and hosts it while playing, another joins by the invite link, they play a
// round, and the host phone renders the result that both phones then watch together and can download.
// Silent: muted headless Chrome with synthetic microphones.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

let app: TestApp;
let browser: Browser;
let clipId: string;
const phones: Page[] = [];
const errors: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (p: Page, sel: string) => p.$eval(sel, (e) => e.textContent?.trim() ?? '');

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
  const clip = (await app.api('GET', `/api/projects/${clipId}`)).data;
  clip.speakers = {
    list: [
      { id: 'A', name: 'Ana', color: '#d97b66', muted: false, solo: false },
      { id: 'B', name: 'Beto', color: '#6fb3a6', muted: false, solo: false },
    ],
    segments: [],
  };
  clip.cues = [
    { id: 'c1', start: 0.5, end: 2, text: 'Hola, ¿qué tal?', character: 'Ana', note: '' },
    { id: 'c2', start: 2.5, end: 4, text: 'Muy bien', character: 'Beto', note: '' },
    { id: 'c3', start: 4.5, end: 6, text: 'Me alegro', character: 'Ana', note: '' },
  ];
  await app.api('PUT', `/api/projects/${clipId}`, clip);
  phones.push(await phone('pau', 'mic_speech.wav'), await phone('leo', 'speech_es.wav'));
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

test('a phone creates the room and hosts it; a friend joins; the host picks the scene and starts', async () => {
  const [host, guest] = phones;
  await host.goto(`${app.base}/play/`);
  await host.waitForSelector('#player-name');
  assert.ok(await host.$eval('#create-room', (b) => (b as HTMLButtonElement).disabled), 'a name first');
  await host.type('#player-name', 'Pau');
  await host.click('#create-room');
  await host.waitForSelector('#host-sheet #host-code');
  const code = await text(host, '#host-code');
  assert.match(code, /^[A-Z2-9]{4}$/);

  await guest.goto(`${app.base}/play/?room=${code}`);
  await guest.waitForSelector('#player-name');
  await guest.type('#player-name', 'Leo');
  await guest.click('#join');
  await guest.waitForSelector('#room-screen[data-phase="lobby"]');
  assert.ok(!(await guest.$('#host-sheet')), 'only the host has the host’s sheet');

  // the host picks the scene from the server's library and starts; the game is dubbing
  await host.waitForSelector(`.clip[data-clip="${clipId}"]`);
  await host.click(`.clip[data-clip="${clipId}"]`);
  await host.waitForFunction(() => document.querySelector('#host-cast') && !(document.querySelector('#host-cast') as HTMLButtonElement).disabled);
  await host.click('#host-cast');
  for (const p of phones) {
    await p.waitForSelector('#room-screen[data-phase="casting"]');
    await p.waitForSelector('#ready:not([disabled])', { timeout: 60_000 });
    await p.click('#ready');
    await p.waitForSelector('#ready-ok');
  }
  await host.click('#host-begin');
  await guest.waitForSelector('#board-strip, #my-turn'); // whoever is called first records, the other watches the board
});

test('the round: turns on the phones, the board shows who records, no TV anywhere', async () => {
  let turns = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (await phones[0].$('#phone-show')) break;
    let mine: Page | null = null;
    for (let tries = 0; tries < 60 && !mine; tries++) {
      for (const p of phones) if (await p.$('#my-turn')) mine = p;
      if (!mine) await wait(150);
      if (await phones[0].$('#phone-show')) break;
    }
    if (!mine) break;
    const other = phones.find((p) => p !== mine) as Page;
    // the other phone sees who is recording, drawn from the board (it may take a moment to show)
    await other.waitForFunction(() => /is recording/.test(document.querySelector('#board-strip')?.textContent ?? ''), { timeout: 15_000 });
    await mine.click('#record');
    await mine.waitForSelector('#send', { timeout: 60_000 });
    await mine.click('#send');
    turns++;
    await wait(300);
  }
  assert.ok(turns >= 2, `turns: ${turns}`);
});

test('the result: rendered by the host phone, started together on both phones, downloadable', async () => {
  for (const p of phones) await p.waitForSelector('#phone-show', { timeout: 120_000 });
  for (const p of phones) {
    const href = await p.$eval('#download-result', (a) => (a as HTMLAnchorElement).href);
    assert.match(href, /result\.mp4\?t=.+&download=1$/);
    const disposition = await p.evaluate(async (url) => (await fetch(url)).headers.get('content-disposition'), href);
    assert.match(disposition ?? '', /attachment; filename=".+\.mp4"/);
    assert.match(await text(p, '#phone-show .note'), /deleted when everyone has left/);
  }
  // a tap unlocks the sound; at the start time the picture plays (both phones are given the same time)
  await Promise.all(phones.map((p) => p.click('#watch-result')));
  for (const p of phones) await p.waitForSelector('#phone-show[data-state="playing"]', { timeout: 30_000 });
  for (const p of phones)
    await p.waitForFunction(() => (document.querySelector('#phone-show video') as HTMLVideoElement).currentTime > 0.2, { timeout: 15_000 });
});

test('no page errors on the phones', () => {
  assert.deepEqual(errors, []);
});
