import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeConfig } from './config.js';
import { HttpError, json, readJson, readBody, streamToFile, serveFile, isId, uid, safeName } from './util.js';
import { Jobs } from './jobs.js';
import { Projects } from './projects.js';
import { ingest } from './ingest.js';
import { separateStems, detectSpeech, cleanTake, neuralAvailable } from './stems.js';
import { runExport, planExport } from './export.js';
import { podcastExport } from './podcast.js';
import { AI } from './ai.js';
import { serveHf } from './hf.js';
import { exec, probe } from './ffmpeg.js';
import { registerAiRoutes } from './aiRoutes.js';
import { parseSubs } from '../shared/srt.js';

const MEDIA_FILES = /^(source\.(webm|mp4|mov|mkv|m4v)|proxy\.mp4|poster\.jpg|thumbs\.jpg|audio_orig\.wav|audio_16k\.wav|stem_dialogue\.wav|stem_bg\.wav|takes\/[\w.\-]+\.wav|exports\/[\w.\-]+(\/[\w.\-]+)?)$/;

export async function createServer(overrides = {}) {
  const cfg = makeConfig(overrides);
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const projects = new Projects(cfg);
  const jobs = new Jobs();
  const ai = new AI(cfg);
  const ctx = { cfg, projects, jobs, ai };
  const aiRoutes = registerAiRoutes(ctx);

  let ffVersion = '';
  try { ffVersion = (await exec(cfg.ffmpeg, ['-version'])).stdout.toString().split('\n')[0]; } catch { ffVersion = ''; }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isLocalBind = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    // DNS-rebinding / CSRF guard: the API controls local files and a paid key, so only same-origin local use.
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (isLocalBind && !localHosts.has(hostName)) throw new HttpError(403, 'forbidden host');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      const o = new URL(req.headers.origin);
      if (o.host !== req.headers.host) throw new HttpError(403, 'cross-origin request blocked');
    }

    // ---- static ----
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p.startsWith('/media/')) {
        const [, , id, ...rest] = p.split('/');
        const name = rest.join('/');
        if (!isId(id) || !MEDIA_FILES.test(name) || name.includes('..')) throw new HttpError(404, 'not found');
        return serveFile(req, res, path.join(projects.dir(id), name), { download: p.includes('/exports/') ? path.basename(name) : /^source\./.test(name) ? `${safeName(projects.get(id).name, 'recording')}_original${path.extname(name)}` : undefined });
      }
      if (p.startsWith('/hf/')) return serveHf(cfg, req, res, p);
      if (p.startsWith('/vendor/transformers/')) return serveFile(req, res, safeJoin(path.join(cfg.root, 'node_modules/@huggingface/transformers/dist'), p.slice(21)), { cache: 'public, max-age=86400' });
      if (p.startsWith('/vendor/ort/')) return serveFile(req, res, safeJoin(path.join(cfg.root, 'node_modules/onnxruntime-web/dist'), p.slice(12)), { cache: 'public, max-age=86400' });
      if (p.startsWith('/shared/')) return serveFile(req, res, safeJoin(cfg.sharedDir, p.slice(8)));
      if (!p.startsWith('/api/')) {
        let rel = p === '/' ? 'index.html' : p.slice(1);
        const f = safeJoin(cfg.publicDir, rel);
        if (!fs.existsSync(f)) return serveFile(req, res, path.join(cfg.publicDir, 'index.html')); // SPA fallback
        return serveFile(req, res, f);
      }
    }

    // ---- api ----
    if (!p.startsWith('/api/')) throw new HttpError(404, 'not found');
    const seg = p.split('/').slice(2);
    const m = req.method;

    if (seg[0] === 'health') return json(res, 200, { ok: true, ffmpeg: ffVersion });
    if (seg[0] === 'system' && m === 'GET') return json(res, 200, { neuralSeparation: neuralAvailable(cfg), ffmpeg: ffVersion, ai: ai.status(), node: process.version, localOnly: isLocalBind, cwd: cfg.root });

    if (seg[0] === 'jobs' && m === 'GET') {
      const j = jobs.get(seg[1]); if (!j) throw new HttpError(404, 'job not found');
      return json(res, 200, j);
    }

    if (seg[0] === 'ai') return aiRoutes(req, res, seg.slice(1));

    if (seg[0] === 'projects') {
      if (seg.length === 1) {
        if (m === 'GET') return json(res, 200, projects.list());
        if (m === 'POST') {
          const b = await readJson(req);
          const proj = projects.create({ name: b.name, mode: b.mode });
          return json(res, 201, proj);
        }
      }
      if (seg[1] === 'from-path' && m === 'POST') {
        if (!isLocalBind) throw new HttpError(403, 'from-path is only available when bound to localhost');
        const b = await readJson(req);
        const src = path.resolve(String(b.path || ''));
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new HttpError(400, 'file not found');
        const proj = projects.create({ name: b.name || path.basename(src, path.extname(src)), mode: b.mode });
        const dest = path.join(projects.dir(proj.id), 'source' + path.extname(src).toLowerCase());
        try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
        const job = jobs.run('ingest', (j) => ingest(cfg, projects, proj.id, dest, j), { projectId: proj.id });
        return json(res, 202, { project: proj, job: job.id });
      }
      const id = seg[1];
      if (!isId(id)) throw new HttpError(400, 'bad id');
      const rest = seg.slice(2);
      if (rest.length === 0) {
        if (m === 'GET') return json(res, 200, projects.get(id));
        if (m === 'PUT') return json(res, 200, projects.update(id, await readJson(req, 50 * 1024 * 1024)));
        if (m === 'DELETE') { projects.remove(id); return json(res, 200, { ok: true }); }
      }
      const proj = () => projects.get(id);

      if (rest[0] === 'source' && m === 'POST') {
        proj();
        const fname = safeName(req.headers['x-filename'] || 'upload.mp4');
        const ext = (path.extname(fname) || '.mp4').toLowerCase();
        if (!/^\.(mp4|webm|mov|mkv|m4v|avi|mp3|wav|m4a|ogg|flac)$/.test(ext)) throw new HttpError(415, 'unsupported file type');
        const dest = path.join(projects.dir(id), 'source' + ext);
        await streamToFile(req, dest, cfg.maxUploadBytes);
        const job = jobs.run('ingest', (j) => ingest(cfg, projects, id, dest, j), { projectId: id });
        return json(res, 202, { job: job.id });
      }
      if (rest[0] === 'stems' && m === 'POST') {
        const o = await readJson(req).catch(() => ({}));
        const job = jobs.run('stems', (j) => separateStems(cfg, projects, id, j, { method: o.method || 'auto' }), { projectId: id });
        return json(res, 202, { job: job.id });
      }
      if (rest[0] === 'speech-segments' && m === 'POST') {
        const o = await readJson(req);
        return json(res, 200, { segments: await detectSpeech(cfg, projects, id, o) });
      }
      if (rest[0] === 'takes' && rest.length === 2 && m === 'POST') {
        proj();
        const name = safeName(rest[1]);
        if (!/^[\w\-]+\.wav$/.test(name)) throw new HttpError(400, 'bad take name');
        const file = path.join(projects.dir(id), 'takes', name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const n = await streamToFile(req, file, 1024 ** 3);
        return json(res, 201, { name, bytes: n });
      }
      if (rest[0] === 'takes' && rest[2] === 'clean' && m === 'POST') {
        const name = safeName(rest[1]);
        const src = path.join(projects.dir(id), 'takes', name);
        if (!fs.existsSync(src)) throw new HttpError(404, 'take not found');
        const out = name.replace(/\.wav$/, '') + '_clean.wav';
        const r = await cleanTake(cfg, src, path.join(projects.dir(id), 'takes', out));
        return json(res, 200, { name: out, ...r });
      }
      if (rest[0] === 'renders' && rest.length === 2 && m === 'POST') {
        proj();
        if (!/^(mix|bg|dry|wet)$/.test(rest[1])) throw new HttpError(400, 'bad render name');
        const dir = path.join(projects.dir(id), 'renders'); fs.mkdirSync(dir, { recursive: true });
        const n = await streamToFile(req, path.join(dir, rest[1] + '.wav'), 2 * 1024 ** 3);
        return json(res, 201, { name: rest[1], bytes: n });
      }
      if (rest[0] === 'recording' && m === 'POST') { // live recording from the browser, streamed in chunks (memory-safe for long sessions)
        const pr = proj(); const part = path.join(projects.dir(id), 'recording.part');
        if (rest[1] === 'append') { const chunk = await readBody(req, 64 * 1024 * 1024); fs.appendFileSync(part, chunk); return json(res, 200, { bytes: fs.statSync(part).size }); }
        if (rest[1] === 'start') { fs.rmSync(part, { force: true }); return json(res, 200, { ok: true }); }
        if (rest[1] === 'finish') {
          if (!fs.existsSync(part) || fs.statSync(part).size < 1000) throw new HttpError(400, 'nothing was recorded');
          const kind = new URL(req.url, 'http://x').searchParams.get('kind') === 'audio' ? 'audio' : 'video';
          const dest = path.join(projects.dir(id), 'source.webm'); fs.renameSync(part, dest); void kind; void pr;
          const job = jobs.run('ingest', (j) => ingest(cfg, projects, id, dest, j), { projectId: id });
          return json(res, 202, { job: job.id });
        }
      }
      if (rest[0] === 'podcast-export' && m === 'POST') {
        const o = await readJson(req);
        const job = jobs.run('podcast-export', (j) => podcastExport(cfg, projects, id, o, j), { projectId: id });
        return json(res, 202, { job: job.id });
      }
      if (rest[0] === 'export' && m === 'POST') {
        const o = await readJson(req);
        const job = jobs.run('export', (j) => runExport(cfg, projects, id, o, j), { projectId: id });
        return json(res, 202, { job: job.id });
      }
      if (rest[0] === 'export-plan' && m === 'POST') return json(res, 200, planExport(proj().media, await readJson(req)));
      if (rest[0] === 'import-subs' && m === 'POST') {
        const text = (await readBody(req, 5 * 1024 * 1024)).toString('utf8');
        const cues = parseSubs(text);
        if (!cues.length) throw new HttpError(400, 'no cues found in subtitle file');
        return json(res, 200, { cues });
      }
    }
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status || 500;
      if (status >= 500) console.error('[server]', req.method, req.url, e);
      if (!res.headersSent) json(res, status, { error: e.message || 'error' }); else res.destroy();
    });
  });
  server.requestTimeout = 0; // long uploads
  const listen = () => new Promise((resolve) => server.listen(cfg.port, cfg.host, () => resolve(server.address().port)));
  return { server, cfg, listen, ctx, close: () => new Promise((r) => server.close(r)) };
}

function safeJoin(base, rel) {
  const f = path.resolve(base, '.' + path.sep + rel);
  if (!f.startsWith(path.resolve(base) + path.sep) && f !== path.resolve(base)) throw new HttpError(403, 'forbidden');
  return f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createServer();
  const port = await app.listen();
  const ai = app.ctx.ai.status();
  console.log(`\n  Doblaje Studio  →  http://localhost:${port}\n  ffmpeg: ${app.ctx.cfg.ffmpeg}   AI: ${ai.configured ? `OpenRouter (${ai.model}, spent $${ai.spentUsd.toFixed(4)} of $${ai.capUsd} cap)` : 'offline mode (no OPENROUTER_API_KEY)'}\n`);
}
