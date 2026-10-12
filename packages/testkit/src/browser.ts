import fs from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export interface LaunchOptions {
  fakeMic?: string | null;
  realMic?: boolean;
  /** play sound through the speakers; off by default so tests are silent (and work on a muted laptop) */
  audible?: boolean;
  headless?: boolean;
  width?: number;
  height?: number;
}

export async function launch({
  fakeMic = null,
  realMic = false,
  audible = false,
  headless = true,
  width = 1440,
  height = 900,
}: LaunchOptions = {}): Promise<Browser> {
  const args = [
    '--no-first-run',
    `--lang=${process.env.E2E_LANG || 'en-US'}`,
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    ...(realMic ? [] : ['--use-fake-device-for-media-stream']),
    '--disable-features=Translate,MediaRouter',
    ...(audible ? [] : ['--mute-audio']),
    `--window-size=${width},${height}`,
  ];
  if (fakeMic) args.push(`--use-file-for-fake-audio-capture=${fakeMic}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless, args, defaultViewport: { width, height }, protocolTimeout: 600000 });
  return browser;
}

export async function openPage(browser: Browser, url: string, { logs = [] as string[] } = {}): Promise<Page> {
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    logs.push(t);
    if (process.env.E2E_VERBOSE) console.log('[page]', t);
  });
  page.on('pageerror', (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`PAGEERROR ${msg}`);
    console.log('[pageerror]', msg);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page;
}
export const exists = (f: string) => fs.existsSync(f);

/**
 * Deterministic stand-in for a microphone: getUserMedia() returns a stream that loops the given WAV.
 * (Chrome's fake-device flags are flaky in headless mode; real hardware is covered by test/e2e/live-mic.test.js.)
 */
export async function injectFakeMic(page: Page, wavFile: string, { channels = 2, only = null as number | null, rate = 48000 } = {}): Promise<void> {
  const b64 = fs.readFileSync(wavFile).toString('base64');
  await page.evaluateOnNewDocument(
    (b64: string, channels: number, only: number | null, rate: number) => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (!c?.audio) return real(c);
        const camStream = c.video ? await real({ video: c.video, audio: false }) : null;
        const ctx = new AudioContext({ sampleRate: rate });
        const ab = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;
        const buf = await ctx.decodeAudioData(ab);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const dest = ctx.createMediaStreamDestination();
        dest.channelCount = channels;
        dest.channelCountMode = 'explicit';
        if (only == null) src.connect(dest);
        else {
          const sp = ctx.createChannelSplitter(1);
          const mg = ctx.createChannelMerger(channels);
          src.connect(sp);
          sp.connect(mg, 0, only);
          mg.connect(dest);
        } // signal on one input only, like a budget interface
        src.start();
        const stream = dest.stream;
        const tr = stream.getAudioTracks()[0];
        for (const v of camStream?.getVideoTracks() || []) stream.addTrack(v);
        Object.defineProperty(tr, 'label', { value: 'Test microphone (synthetic)' });
        const gs = tr.getSettings.bind(tr);
        tr.getSettings = () => ({ ...gs(), channelCount: channels, sampleRate: rate, deviceId: 'default' });
        return stream;
      };
    },
    b64,
    channels,
    only,
    rate,
  );
}
