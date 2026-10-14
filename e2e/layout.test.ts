import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { TestApp } from '@doblaje/testkit';
import { fx, startApp } from '@doblaje/testkit';
import { injectFakeMic, launch } from '@doblaje/testkit/browser';
import type { Browser, Page } from 'puppeteer-core';
import { REGIONS, ROOMY, STACK_BELOW } from '../apps/web/src/layout.ts';

// Every screen and dialog, at desktop, laptop, small-laptop, tablet-portrait and TV sizes: each region declared in
// apps/web/src/layout.ts must honour its contract, the document never scrolls, and no area scrolls without being
// declared. Silent (muted headless Chrome, synthetic mic and camera).

const VIEWPORTS: [number, number][] = [
  [2560, 1440],
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 720],
  [1024, 640],
  [900, 600],
  [820, 1180],
];

let app: TestApp;
let browser: Browser;
const ids: Record<string, string> = {};

test.before(async () => {
  app = await startApp();
  browser = await launch({ width: 1440, height: 900 });
  ids.pro = await app.ingestFixture('clip_en.mp4');
  const subs = await app.api('POST', `/api/projects/${ids.pro}/import-subs`, Buffer.from(fs.readFileSync(fx('sample.srt'))));
  const pro = (await app.api('GET', `/api/projects/${ids.pro}`)).data;
  const many = Array.from({ length: 12 }, (_, i) =>
    subs.data.cues.map((c) => ({ ...c, id: `c${i}${c.start}`, start: c.start + i * 0.01, end: c.end + i * 0.01 })),
  ).flat();
  pro.cues = many; // a long cue list, so the panel really has to scroll
  pro.tracks = [1, 2, 3, 4, 5, 6].map((n) => ({ ...pro.tracks[0], id: `t${n}`, name: `Voice ${n}` }));
  await app.api('PUT', `/api/projects/${ids.pro}`, pro);
  const pod = await app.api('POST', '/api/projects/from-path', { path: fx('rec_stream.webm'), mode: 'podcast', name: 'Episode' });
  await app.waitJob(pod.data.job);
  ids.pod = pod.data.project.id;
  ids.rec = (await app.api('POST', '/api/projects', { name: 'Recorder', mode: 'podcast' })).data.id;
  for (let i = 0; i < 14; i++) await app.api('POST', '/api/projects', { name: `Old project ${i}`, mode: 'pro' });
});
test.after(async () => {
  await browser?.close();
  await app?.close();
});

/** Runs in the page: checks every declared region and looks for undeclared scroll containers. */
function audit(regions: typeof REGIONS, roomy: boolean, stacked: boolean): string[] {
  const out: string[] = [];
  const W = innerWidth;
  const H = innerHeight;
  const tol = 1.5;
  const de = document.documentElement;
  if (de.scrollHeight > H + tol || de.scrollWidth > W + tol) out.push(`document scrolls (${de.scrollWidth}×${de.scrollHeight})`);
  const scrollers = regions.filter((r) => ['scroll', 'page', 'screen'].includes(stacked && r.stacked ? r.stacked : r.contract)).map((r) => r.selector);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const insideScroller = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (scrollers.some((s) => p.matches(s))) return true;
    return false;
  };
  for (const r0 of regions) {
    const reg = stacked && r0.stacked ? { ...r0, contract: r0.stacked } : r0;
    for (const el of document.querySelectorAll<HTMLElement>(reg.selector)) {
      if (!visible(el) || reg.contract === 'document') continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const name = `${reg.selector} [${reg.contract}]`;
      if (r.left < -tol || r.right > W + tol) out.push(`${name} sticks out horizontally (${Math.round(r.left)}…${Math.round(r.right)} of ${W})`);
      if (!insideScroller(el) && r.bottom > H + tol) out.push(`${name} extends below the window (${Math.round(r.bottom)} > ${H})`);
      const hidesX = el.scrollWidth > el.clientWidth + tol;
      const hidesY = el.scrollHeight > el.clientHeight + tol;
      switch (reg.contract) {
        case 'fit':
          if (hidesX || hidesY) out.push(`${name} cuts its content (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})`);
          break;
        case 'scroll':
        case 'page':
          if (!/auto|scroll/.test(cs.overflowY)) out.push(`${name} must scroll vertically (overflow-y: ${cs.overflowY})`);
          if (hidesX) out.push(`${name} overflows horizontally (${el.scrollWidth} > ${el.clientWidth})`);
          break;
        case 'clip':
          if (cs.overflowX !== 'hidden' || cs.overflowY !== 'hidden') out.push(`${name} must clip (overflow: ${cs.overflow})`);
          break;
        case 'screen':
          if (!/auto|scroll/.test(cs.overflowY)) out.push(`${name} cannot scroll when it does not fit (overflow-y: ${cs.overflowY})`);
          if (hidesX) out.push(`${name} overflows horizontally (${el.scrollWidth} > ${el.clientWidth})`);
          if (roomy && hidesY) out.push(`${name} needs a page scroll on a roomy window (${el.scrollHeight} > ${el.clientHeight})`);
          break;
      }
    }
  }
  // no undeclared scrolling areas (form controls scroll by nature)
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (/^(TEXTAREA|SELECT|INPUT|OPTION)$/.test(el.tagName) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const scrollsY = /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + tol;
    const scrollsX = /auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + tol;
    if ((scrollsY || scrollsX) && !scrollers.some((s) => el.matches(s))) {
      out.push(`undeclared scroll area: ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} (${scrollsX ? 'x' : 'y'})`);
    }
  }
  return out;
}

interface Screen {
  name: string;
  open(page: Page): Promise<void>;
}
const SCREENS: Screen[] = [
  {
    name: 'library',
    open: async (p) => {
      await p.goto(`${app.base}/#/`);
      await p.waitForSelector('.plist');
    },
  },
  {
    name: 'party room (TV)',
    open: async (p) => {
      await p.goto(`${app.base}/#/party`);
      await p.waitForSelector('#room-code');
    },
  },
  {
    name: 'new-project dialog',
    open: async (p) => {
      await p.goto(`${app.base}/#/`);
      await p.waitForSelector('#new-project');
      await p.click('#new-project');
      await p.waitForSelector('.modal');
    },
  },
  {
    name: 'studio (cues)',
    open: async (p) => {
      await p.goto(`${app.base}/#/p/${ids.pro}`);
      await p.waitForSelector('#timeline-canvas', { timeout: 30000 });
      await p.waitForFunction(() => window.__app.engine?.assets?.orig, { timeout: 30000 });
      await p.click('#tab-cues');
    },
  },
  {
    name: 'studio (voices)',
    open: async (p) => {
      await p.click('#tab-voices');
    },
  },
  {
    name: 'studio (marks)',
    open: async (p) => {
      await p.click('#tab-marks');
    },
  },
  {
    name: 'studio (record)',
    open: async (p) => {
      await p.click('#tab-record');
    },
  },
  {
    name: 'studio (mix)',
    open: async (p) => {
      await p.click('#tab-mix');
    },
  },
  {
    name: 'devices dialog',
    open: async (p) => {
      await p.click('#devices-btn');
      await p.waitForSelector('#devices #mic-open');
    },
  },
  {
    name: 'export dialog',
    open: async (p) => {
      await p.click('#devices-done');
      await p.click('#export-btn');
      await p.waitForSelector('.modal #ex-go');
    },
  },
  {
    name: 'podcast recorder',
    open: async (p) => {
      await p.goto(`${app.base}/#/p/${ids.rec}`);
      await p.waitForSelector('#pod-rec', { timeout: 30000 });
    },
  },
  {
    name: 'podcast review',
    open: async (p) => {
      await p.goto(`${app.base}/#/p/${ids.pod}`);
      await p.waitForSelector('#wave', { timeout: 30000 });
    },
  },
];

test('every region honours its sizing contract at every window size', { timeout: 900_000 }, async () => {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await injectFakeMic(page, fx('mic_speech.wav'));
  const problems: string[] = [];
  for (const s of SCREENS) {
    await page.setViewport({ width: 1440, height: 900 });
    await s.open(page);
    for (const [w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await new Promise((r) => setTimeout(r, 150)); // let ResizeObservers and canvases settle
      const roomy = w >= ROOMY.width && h >= ROOMY.height;
      for (const p of await page.evaluate(audit, REGIONS, roomy, w < STACK_BELOW)) problems.push(`${s.name} @ ${w}×${h}: ${p}`);
    }
  }
  await page.close();
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync('.cache/layout-report.json', JSON.stringify(problems, null, 1));
  assert.deepEqual(problems, [], `${problems.length} layout problems:\n${problems.join('\n')}`);
});

test('the studio timeline and band stay usable on a short window', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 640 });
  await page.goto(`${app.base}/#/p/${ids.pro}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  const m = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    return { video: box('.stage')?.height, band: box('canvas.band')?.height, timeline: box('.timeline')?.height, panel: box('.panel')?.height };
  });
  await page.close();
  assert.ok(m.video >= 100, `video keeps at least 100 px: ${JSON.stringify(m)}`);
  assert.ok(m.band >= 70, `band keeps at least 70 px: ${JSON.stringify(m)}`);
  assert.ok(m.timeline >= 200, `timeline keeps at least 200 px: ${JSON.stringify(m)}`);
  assert.ok(m.panel >= 150, `side panel keeps at least 150 px: ${JSON.stringify(m)}`);
});

test('scrolling the track list scrolls headers and lanes together (vertically)', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('lang', 'en'));
  await page.goto(`${app.base}/#/p/${ids.pro}`);
  await page.waitForSelector('#timeline-canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 300));
  const before = await page.evaluate(() => {
    const sc = document.querySelector('.tl-scroll') as HTMLElement;
    const head = document.querySelector('.tl-head[data-track]') as HTMLElement;
    const canvas = document.querySelector('canvas.tl') as HTMLElement;
    const hb = head.getBoundingClientRect();
    return {
      scrollable: sc.scrollHeight > sc.clientHeight,
      top: sc.scrollTop,
      head: hb.top,
      canvas: canvas.getBoundingClientRect().top,
      x: hb.left + 30,
      y: Math.min(hb.top + 20, sc.getBoundingClientRect().bottom - 10),
      t0: window.__app.view.t0,
    };
  });
  assert.ok(before.scrollable, 'six tracks overflow the timeline band, so the list must scroll');
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel({ deltaY: 240 });
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => {
    const sc = document.querySelector('.tl-scroll') as HTMLElement;
    return {
      top: sc.scrollTop,
      head: (document.querySelector('.tl-head[data-track]') as HTMLElement).getBoundingClientRect().top,
      canvas: (document.querySelector('canvas.tl') as HTMLElement).getBoundingClientRect().top,
      t0: window.__app.view.t0,
      doc: document.documentElement.scrollTop,
    };
  });
  await page.close();
  assert.ok(after.top > before.top, `the list scrolled: ${before.top} -> ${after.top}`);
  const moved = before.head - after.head;
  assert.ok(moved > 0, 'track headers moved up');
  assert.ok(Math.abs(before.canvas - after.canvas - moved) < 1, `lanes moved by the same amount (${before.canvas - after.canvas} vs ${moved})`);
  assert.equal(after.t0, before.t0, 'scrolling the list does not move time');
  assert.equal(after.doc, 0, 'the page itself did not scroll');
});
