import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';

// Right-click policy (docs/design.md#context-menus): app menu where there are relevant actions, the browser's own
// menu on text fields and links, nothing anywhere else. Also reachable from the keyboard. Silent.

let app: TestApp;
let browser: Browser;
let page: Page;
let id: string;

test.before(async () => {
  app = await startApp();
  browser = await launch();
  id = await app.ingestFixture('clip_en.mp4');
  const subs = await app.api('POST', `/api/projects/${id}/import-subs`, Buffer.from(fs.readFileSync(fx('sample.srt'))));
  const p = (await app.api('GET', `/api/projects/${id}`)).data;
  p.cues = subs.data.cues.map((c, i) => ({ ...c, id: `c${i}`, note: '' }));
  p.markers = [{ id: 'm1', n: 1, t: 2 }];
  await app.api('PUT', `/api/projects/${id}`, p);
  page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await page.goto(`${app.base}/#/p/${id}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await page.waitForFunction(() => window.__app.engine?.assets?.orig, { timeout: 30000 });
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

/** Dispatch a contextmenu event at a point; report whether the native menu was suppressed and what the app showed. */
async function rightClick(x: number, y: number) {
  return page.evaluate(
    (x, y) => {
      document.querySelector('.ctxmenu')?.remove();
      const target = document.elementFromPoint(x, y) as Element;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 });
      const notCancelled = target.dispatchEvent(ev);
      const menu = document.querySelector('.ctxmenu');
      return {
        target: target.tagName.toLowerCase() + (target.id ? `#${target.id}` : ''),
        native: notCancelled,
        items: menu ? [...menu.querySelectorAll('.ctxitem')].map((b) => b.querySelector('.ctxlabel')?.textContent) : null,
      };
    },
    x,
    y,
  );
}
const center = (sel: string) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, sel);
test('text fields keep the native menu; plain chrome shows nothing', async () => {
  await page.click('#tab-cues');
  await page.waitForSelector('.cue textarea');
  const ta = await center('.cue textarea');
  const r1 = await rightClick(ta.x, ta.y);
  assert.equal(r1.native, true, 'textarea keeps the browser menu (copy/paste/spelling)');
  assert.equal(r1.items, null);
  const title = await center('#proj-title');
  assert.equal((await rightClick(title.x, title.y)).native, true, 'the title field keeps the browser menu');
  const clock = await center('#clock');
  const r2 = await rightClick(clock.x, clock.y);
  assert.equal(r2.native, false, 'no browser menu on app chrome');
  assert.equal(r2.items, null, 'and no app menu where there is nothing to do');
  const brand = await center('.brand');
  assert.deepEqual((await rightClick(brand.x, brand.y)).items, null);
});

test('a cue row offers cue actions; delete from the menu works and is undoable', async () => {
  const row = await center('.cue-list .cue[data-id="c1"] .syl'); // the row itself, not one of its text fields
  const r = await rightClick(row.x, row.y);
  assert.equal(r.native, false);
  assert.deepEqual(r.items, ['Go to cue', 'Play this cue', 'Record this cue (punch)', 'Loop-record this cue until you nail it', 'Edit text', 'Delete cue']);
  await page.evaluate(() => {
    const del = [...document.querySelectorAll<HTMLButtonElement>('.ctxmenu .ctxitem')].find((b) => b.textContent?.includes('Delete cue'));
    del?.click();
  });
  assert.equal(await page.evaluate(() => window.__app.project.cues.some((c) => c.id === 'c1')), false, 'cue deleted');
  assert.equal(await page.$('.ctxmenu'), null, 'menu closes after an action');
  await page.evaluate(() => window.__app.store.undo());
  assert.equal(await page.evaluate(() => window.__app.project.cues.some((c) => c.id === 'c1')), true, 'undo restores it');
});

test('timeline lanes: marker, empty ruler, cue lane, empty cue lane, track', async () => {
  // the canvas is driven through real coordinates: compute them from the app's own view
  const ruler = await page.evaluate(() => {
    const b = document.querySelector('canvas.tl')!.getBoundingClientRect();
    const a = window.__app;
    return { x: b.left + (2 - a.view.t0) * a.view.pps + 6, y: b.top + 6, emptyX: b.left + (9 - a.view.t0) * a.view.pps };
  });
  const onMark = await rightClick(ruler.x, ruler.y);
  assert.deepEqual(onMark.items, ['Jump to mark 1', 'Delete mark 1']);
  const onRuler = await rightClick(ruler.emptyX, ruler.y);
  assert.deepEqual(onRuler.items, ['Play from here', 'Set mark 2 here']);

  const lanes = await page.evaluate(() => {
    const heads = [...document.querySelectorAll<HTMLElement>('.tl-head')];
    const b = document.querySelector('canvas.tl')!.getBoundingClientRect();
    const a = window.__app;
    const y = (i: number) => heads[i].getBoundingClientRect().top + heads[i].getBoundingClientRect().height / 2;
    const iCue = heads.findIndex((hd) => hd.textContent?.includes('Cue lane'));
    const iTrack = heads.findIndex((hd) => hd.dataset.track);
    const cue = a.project.cues[0];
    return {
      cueX: b.left + ((cue.start + cue.end) / 2 - a.view.t0) * a.view.pps,
      emptyX: b.left + (11.5 - a.view.t0) * a.view.pps,
      cueY: y(iCue),
      trackY: y(iTrack),
    };
  });
  const onCue = await rightClick(lanes.cueX, lanes.cueY);
  assert.ok(onCue.items?.includes('Record this cue (punch)') && onCue.items.at(-1) === 'Delete cue', JSON.stringify(onCue.items));
  const onEmptyLane = await rightClick(lanes.emptyX, lanes.cueY);
  assert.deepEqual(onEmptyLane.items, ['Add a cue here']);
  const onTrack = await rightClick(lanes.emptyX, lanes.trackY);
  assert.deepEqual(onTrack.items, ['Record on “Voice 1” from here', 'Play from here']);
  await page.keyboard.press('Escape');
});

test('menus are keyboard accessible and stay inside the window', async () => {
  await page.setViewport({ width: 1024, height: 640 });
  await new Promise((r) => setTimeout(r, 300)); // a resize closes open menus; let it settle first
  const row = await page.evaluate(() => ({ x: innerWidth - 3, y: innerHeight - 3 }));
  // opened at the bottom-right corner, it must be shifted back inside
  await page.evaluate(
    (x, y) => {
      const target = document.querySelector('.cue-list .cue') as Element;
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    row.x,
    row.y,
  );
  const box = await page.evaluate(() => {
    const r = document.querySelector('.ctxmenu')!.getBoundingClientRect();
    return { right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, focused: document.activeElement?.className };
  });
  assert.ok(box.right <= box.w && box.bottom <= box.h, `menu clamped inside the window: ${JSON.stringify(box)}`);
  assert.match(box.focused || '', /ctxitem/, 'first item focused');
  await page.keyboard.press('ArrowDown');
  const second = await page.evaluate(() => document.activeElement?.textContent);
  assert.match(second || '', /Play this cue/);
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.ctxmenu'), null, 'Escape closes');
  // keyboard: Shift+F10 on a focused cue row opens its menu
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.cue-list .cue')!;
    el.tabIndex = 0;
    el.focus();
  });
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  assert.ok(await page.$('.ctxmenu'), 'Shift+F10 opens the menu of the focused element');
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1440, height: 900 });
});

test('library rows: open or delete', async () => {
  await page.goto(`${app.base}/#/`);
  await page.waitForSelector('tr.card');
  const r = await center('tr.card .name');
  assert.deepEqual((await rightClick(r.x, r.y)).items, ['Open', 'Delete project']);
  const empty = await page.evaluate(() => ({ x: innerWidth - 20, y: innerHeight - 20 }));
  assert.equal((await rightClick(empty.x, empty.y)).items, null, 'empty page area: nothing');
});
