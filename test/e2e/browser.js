import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({ fakeMic = null, realMic = false, headless = true, width = 1440, height = 900 } = {}) {
  const args = ['--no-first-run', `--lang=${process.env.E2E_LANG || 'en-US'}`, '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', ...(realMic ? [] : ['--use-fake-device-for-media-stream']),
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

/**
 * Deterministic stand-in for a microphone: getUserMedia() returns a stream that loops the given WAV.
 * (Chrome's fake-device flags are flaky in headless mode; real hardware is covered by test/e2e/live-mic.test.js.)
 */
export async function injectFakeMic(page, wavFile, { channels = 2 } = {}) {
  const b64 = fs.readFileSync(wavFile).toString('base64');
  await page.evaluateOnNewDocument((b64, channels) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!c?.audio) return real(c);
      const ctx = new AudioContext({ sampleRate: 48000 });
      const ab = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;
      const buf = await ctx.decodeAudioData(ab);
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const dest = ctx.createMediaStreamDestination(); dest.channelCount = channels; dest.channelCountMode = 'explicit';
      src.connect(dest); src.start();
      const stream = dest.stream; const tr = stream.getAudioTracks()[0];
      Object.defineProperty(tr, 'label', { value: 'Test microphone (synthetic)' });
      const gs = tr.getSettings.bind(tr); tr.getSettings = () => ({ ...gs(), channelCount: channels, sampleRate: 48000, deviceId: 'default' });
      return stream;
    };
  }, b64, channels);
}
