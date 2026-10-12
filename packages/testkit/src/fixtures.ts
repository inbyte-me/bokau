// Generates deterministic test media into .cache/fixtures using ffmpeg + macOS `say` (no microphone, nothing audible).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(here, '..', '..', '..', '.cache', 'fixtures');
const run = (bin: string, args: string[]) => execFileSync(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
const ff = (...args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

export function make({ force = false } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = (n: string) => path.join(OUT, n);
  const need = (n: string) => force || !fs.existsSync(f(n));

  // speech
  const speech = (name: string, voice: string, text: string) => {
    if (!need(`${name}.wav`)) return;
    run('say', ['-v', voice, '-o', f(`${name}.aiff`), text]);
    ff('-i', f(`${name}.aiff`), '-ar', '48000', '-ac', '1', f(`${name}.wav`));
  };
  speech('speech_en', 'Samantha', 'Hello there. I would like a cup of coffee, please. Do you have any cheese?');
  speech('speech_es', 'Paulina', 'Hola, buenos días. Quisiera un café, por favor. ¿Tienen queso?');

  // fake-microphone feed for headless Chrome: plain 44-byte-header 16-bit PCM (Chrome rejects files with LIST chunks)
  if (need('mic_speech.wav')) {
    ff(
      '-i',
      f('speech_en.wav'),
      '-i',
      f('speech_es.wav'),
      '-filter_complex',
      '[0]apad=pad_dur=0.5[a];[1]apad=pad_dur=0.5[b];[a][b]concat=n=2:v=0:a=1',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      '-map_metadata',
      '-1',
      f('mic_speech.wav'),
    );
  }

  // music: chord left-heavy + bass + noise hits, stereo with real width
  if (need('music.wav')) {
    ff(
      '-f',
      'lavfi',
      '-i',
      'sine=f=220:d=14',
      '-f',
      'lavfi',
      '-i',
      'sine=f=277:d=14',
      '-f',
      'lavfi',
      '-i',
      'sine=f=330:d=14',
      '-f',
      'lavfi',
      '-i',
      'sine=f=55:d=14',
      '-filter_complex',
      '[0]volume=0.12[a];[1]volume=0.12[b];[2]volume=0.12[c];[3]volume=0.25[bass];[a][bass]amerge=inputs=2,pan=stereo|c0=c0+0.5*c1|c1=0.2*c0+0.5*c1[l];[b][c]amerge=inputs=2,pan=stereo|c0=0.2*c0|c1=c0+c1[r];[l][r]amix=inputs=2:normalize=0[m]',
      '-map',
      '[m]',
      '-ar',
      '48000',
      f('music.wav'),
    );
  }

  const video = (name: string, speechName: string, { layout = 'stereo', dur = 12, w = 640, h = 360, fps = 25, vcodec = 'libx264', ext = 'mp4' } = {}) => {
    const file = `${name}.${ext}`;
    if (!need(file)) return;
    const vsrc = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${fps}:d=${dur}`];
    const venc = vcodec === 'libx264' ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'] : ['-c:v', vcodec, '-b:v', '600k'];
    if (layout === 'stereo') {
      ff(
        ...vsrc,
        '-i',
        f(`${speechName}.wav`),
        '-i',
        f('music.wav'),
        '-filter_complex',
        `[1:a]adelay=1000|1000,pan=stereo|c0=c0|c1=c0[v];[2:a]atrim=0:${dur}[m];[v][m]amix=inputs=2:normalize=0,atrim=0:${dur}[a]`,
        '-map',
        '0:v',
        '-map',
        '[a]',
        ...venc,
        '-c:a',
        ext === 'webm' ? 'libopus' : 'aac',
        '-t',
        String(dur),
        f(file),
      );
    } else if (layout === '5.1') {
      ff(
        ...vsrc,
        '-i',
        f(`${speechName}.wav`),
        '-i',
        f('music.wav'),
        '-filter_complex',
        '[1:a]adelay=1000|1000[v];[2:a]atrim=0:' +
          dur +
          ',pan=5.1|FL=c0|FR=c1|FC=0*c0|LFE=0.1*c0|BL=0.3*c0|BR=0.3*c1[m];[v]pan=5.1|FC=c0[vc];[m][vc]amix=inputs=2:normalize=0,atrim=0:' +
          dur +
          '[a]',
        '-map',
        '0:v',
        '-map',
        '[a]',
        ...venc,
        '-c:a',
        'ac3',
        '-t',
        String(dur),
        f(file),
      );
    } else if (layout === 'mono') {
      ff(
        ...vsrc,
        '-i',
        f(`${speechName}.wav`),
        '-i',
        f('music.wav'),
        '-filter_complex',
        `[1:a]adelay=1000|1000[v];[2:a]atrim=0:${dur},pan=mono|c0=0.5*c0+0.5*c1[m];[v][m]amix=inputs=2:normalize=0,atrim=0:${dur}[a]`,
        '-map',
        '0:v',
        '-map',
        '[a]',
        ...venc,
        '-c:a',
        'aac',
        '-t',
        String(dur),
        f(file),
      );
    } else if (layout === 'none') {
      ff(...vsrc, ...venc, '-t', String(dur), f(file));
    }
  };
  video('clip_en', 'speech_en');
  video('clip_es', 'speech_es');
  video('clip_51', 'speech_en', { layout: '5.1', ext: 'mkv' });
  video('clip_mono', 'speech_en', { layout: 'mono' });
  video('clip_silent', 'speech_en', { layout: 'none', dur: 6 });
  video('clip_webm', 'speech_en', { vcodec: 'libvpx', ext: 'webm', dur: 8 });
  video('clip_tall', 'speech_en', { w: 360, h: 640, dur: 6 });

  // three distinct voices taking turns over music, with ground truth: voices.json = [{speaker,start,end}]
  if (need('clip_voices.mp4')) {
    const lines = [
      ['Samantha', 'Hello there, how are you doing today?'],
      ['Daniel', 'I am fine, thank you very much for asking.'],
      ['Fred', 'Excuse me, is anybody going to make some tea?'],
      ['Samantha', 'Of course, would you like some sugar with it?'],
      ['Daniel', 'Yes please, two spoons would be perfect.'],
      ['Fred', 'And I would like a big piece of chocolate cake.'],
    ];
    const parts: string[] = [];
    const truth: { speaker: string; start: number; end: number }[] = [];
    let t = 0.8;
    lines.forEach(([voice, text], i) => {
      run('say', ['-v', voice, '-o', f(`v${i}.aiff`), text]);
      ff('-i', f(`v${i}.aiff`), '-ar', '48000', '-ac', '1', '-af', 'loudnorm=I=-20:TP=-2', f(`v${i}.wav`));
      const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f(`v${i}.wav`)]).toString());
      truth.push({ speaker: voice, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
      parts.push(f(`v${i}.wav`));
      t += d + 0.7;
    });
    const total = Math.ceil(t + 0.5);
    const inputs = parts.flatMap((p) => ['-i', p]);
    const delays = truth.map((x, i) => `[${i}:a]adelay=${Math.round(x.start * 1000)}|${Math.round(x.start * 1000)}[d${i}]`).join(';');
    ff(
      ...inputs,
      '-filter_complex',
      `${delays};${truth.map((_, i) => `[d${i}]`).join('')}amix=inputs=${truth.length}:normalize=0,pan=stereo|c0=c0|c1=c0,apad=whole_dur=${total}[v]`,
      '-map',
      '[v]',
      '-t',
      String(total),
      f('voices_dialog.wav'),
    );
    ff(
      '-f',
      'lavfi',
      '-i',
      `testsrc2=s=640x360:r=25:d=${total}`,
      '-i',
      f('voices_dialog.wav'),
      '-i',
      f('music.wav'),
      '-filter_complex',
      `[2:a]volume=0.5,atrim=0:${total}[m];[1:a][m]amix=inputs=2:normalize=0[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-t',
      String(total),
      f('clip_voices.mp4'),
    );
    fs.writeFileSync(f('voices.json'), JSON.stringify(truth));
  }

  // what MediaRecorder produces: streamed WebM (VP8 + Opus) with no duration / cues
  if (need('rec_stream.webm')) {
    const buf = execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        f('clip_en.mp4'),
        '-t',
        '8',
        '-c:v',
        'libvpx',
        '-b:v',
        '600k',
        '-c:a',
        'libopus',
        '-ac',
        '1',
        '-af',
        'volume=-14dB',
        '-f',
        'webm',
        'pipe:1',
      ],
      { maxBuffer: 1 << 28 },
    );
    fs.writeFileSync(f('rec_stream.webm'), buf);
  }
  if (need('rec_stream_audio.webm')) {
    const buf = execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        f('clip_en.mp4'),
        '-t',
        '8',
        '-vn',
        '-c:a',
        'libopus',
        '-ac',
        '1',
        '-af',
        'volume=-20dB',
        '-f',
        'webm',
        'pipe:1',
      ],
      { maxBuffer: 1 << 28 },
    );
    fs.writeFileSync(f('rec_stream_audio.webm'), buf);
  }

  if (need('clip_1080.mp4'))
    ff(
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=1920x1080:r=25:d=4',
      '-f',
      'lavfi',
      '-i',
      'sine=f=300:d=4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      f('clip_1080.mp4'),
    );

  if (need('clip_mov.mov')) ff('-i', f('clip_en.mp4'), '-t', '6', '-c:v', 'copy', '-c:a', 'aac', '-f', 'mov', f('clip_mov.mov'));

  if (!fs.existsSync(f('sample.srt'))) {
    fs.writeFileSync(
      f('sample.srt'),
      '1\n00:00:01,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:03,000 --> 00:00:06,000\nJOHN: I would like a cup of coffee, please.\n\n3\n00:00:07,000 --> 00:00:09,500\n<i>Do you have any cheese?</i>\n',
    );
    fs.writeFileSync(
      f('sample.vtt'),
      'WEBVTT\n\n00:01.000 --> 00:02.500\nHello there.\n\n00:00:03.000 --> 00:00:06.000\nI would like a cup of coffee, please.\n',
    );
  }
  return OUT;
}
