import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { startApp } from '@doblaje/testkit';
import { launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

// Fixing who says what: split a character's passage (right-click or S) and give the piece to another character;
// split a subtitle cue the same way. Uses hand-made speaker passages, so no voice model is needed. Silent.

let app: TestApp;
let browser: Browser;
let page: Page;
let id: string;

const speakers = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__app.project.speakers.segments)) as { start: number; end: number; speaker: string }[]);
/** viewport point at time `time` in the lane whose header matches */
const at = (headSel: string, time: number) =>
  page.evaluate(
    (headSel, time) => {
      const hd = document.querySelector(headSel) as HTMLElement;
      const hb = hd.getBoundingClientRect();
      const b = document.querySelector('canvas.tl')!.getBoundingClientRect();
      const a = window.__app;
      return { x: b.left + (time - a.view.t0) * a.view.pps, y: hb.top + hb.height / 2 };
    },
    headSel,
    time,
  );
const menuClick = async (x: number, y: number, label: string) => {
  await page.evaluate(
    (x, y) => document.elementFromPoint(x, y)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })),
    x,
    y,
  );
  const ok = await page.evaluate((label) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.ctxmenu .ctxitem')].find((x) => x.textContent?.includes(label));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, label);
  assert.ok(ok, `menu item "${label}" available`);
};

test.before(async () => {
  app = await startApp();
  browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
  const p = (await app.api('GET', `/api/projects/${id}`)).data;
  p.speakers = {
    list: [
      { id: 's1', name: 'Bluey', color: '#7a9cc9', muted: false, solo: false },
      { id: 's2', name: 'Bingo', color: '#d97b66', muted: false, solo: false },
    ],
    segments: [
      { start: 1, end: 5, speaker: 's1' }, // really Bluey 1–3 then Bingo 3–5
      { start: 6, end: 9, speaker: 's2' },
    ],
  };
  p.cues = [{ id: 'c1', start: 1, end: 5, text: 'Hello there my old friend', character: 'Bluey', note: '' }];
  await app.api('PUT', `/api/projects/${id}`, p);
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await page.goto(`${app.base}/#/p/${id}`);
  await page.waitForSelector('.tl-head[data-speaker="s1"]', { timeout: 30000 });
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

test('right-click a passage: split it there, then give the second half to the other character', async () => {
  const p = await at('.tl-head[data-speaker="s1"]', 3);
  await menuClick(p.x, p.y, 'Split passage here');
  let segs = await speakers();
  assert.equal(segs.length, 3);
  assert.ok(Math.abs(segs[0].end - 3) < 0.05 && segs[1].start === segs[0].end, `split near 3 s: ${JSON.stringify(segs)}`);
  const q = await at('.tl-head[data-speaker="s1"]', 4);
  await menuClick(q.x, q.y, 'This passage is Bingo');
  segs = await speakers();
  assert.deepEqual(
    segs.map((g) => g.speaker),
    ['s1', 's2', 's2'],
  );
  assert.ok(Math.abs(segs[1].start - 3) < 0.05 && segs[1].end === 5, 'the second half now belongs to Bingo');
  // undo twice restores the original single passage
  await page.evaluate(() => {
    window.__app.store.undo();
    window.__app.store.undo();
  });
  assert.equal((await speakers()).length, 2);
});

test('S splits the passage under the playhead; a touching piece given back merges into one passage', async () => {
  await page.evaluate(() => {
    window.__app.select({ segIdx: null, cueId: null, clipId: null });
    window.__app.engine.seek(7.5);
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await page.keyboard.press('s');
  let segs = await speakers();
  assert.equal(segs.length, 3, 'Bingo 6–9 split at 7.5');
  assert.ok(segs.some((g) => g.start === 6 && Math.abs(g.end - 7.5) < 0.01));
  // give the piece away and back: touching passages of the same character merge again
  const p = await at('.tl-head[data-speaker="s2"]', 8);
  await menuClick(p.x, p.y, 'This passage is Bluey');
  await menuClick(p.x, (await at('.tl-head[data-speaker="s1"]', 8)).y, 'This passage is Bingo');
  segs = await speakers();
  assert.deepEqual(
    segs.filter((g) => g.speaker === 's2').map((g) => [g.start, g.end]),
    [[6, 9]],
    'touching passages of one character merge back',
  );
});

test('a subtitle cue splits at the nearest word; each half can carry its own character', async () => {
  const lane = await page.evaluate(() => {
    const heads = [...document.querySelectorAll<HTMLElement>('.tl-head')];
    const hd = heads.find((h) => h.textContent?.includes('Cue lane')) as HTMLElement;
    hd.dataset.testCueLane = '1';
    return true;
  });
  assert.ok(lane);
  const p = await at('.tl-head[data-test-cue-lane="1"]', 3.1);
  await menuClick(p.x, p.y, 'Split cue here');
  const cues = await page.evaluate(() => window.__app.project.cues.map((c) => ({ start: c.start, end: c.end, text: c.text, character: c.character })));
  assert.equal(cues.length, 2);
  assert.equal(`${cues[0].text} ${cues[1].text}`, 'Hello there my old friend', 'no words lost');
  assert.ok(cues[0].text && cues[1].text, JSON.stringify(cues));
  assert.equal(cues[0].end, cues[1].start);
});
