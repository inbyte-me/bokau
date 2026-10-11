import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({ fakeMic = null, headless = true, width = 1440, height = 900 } = {}) {
  const args = ['--no-first-run', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--disable-features=Translate,MediaRouter', '--mute-audio', `--window-size=${width},${height}`];
  if (fakeMic) args.push(`--use-file-for-fake-audio-capture=${fakeMic}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: headless ? 'new' : false, args, defaultViewport: { width, height }, protocolTimeout: 600000 });
  return browser;
}

export async function openPage(browser, url, { logs = [] } = {}) {
  const page = await browser.newPage();
  page.on('console', (m) => { const t = m.text(); logs.push(t); if (process.env.E2E_VERBOSE) console.log('[page]', t); });
  page.on('pageerror', (e) => { logs.push('PAGEERROR ' + e.message); console.log('[pageerror]', e.message); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}
export const exists = (f) => fs.existsSync(f);
