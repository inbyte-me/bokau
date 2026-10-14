import fs from 'node:fs';
import path from 'node:path';
import { AppError, type EditableProject, isMode, type Mode, parseSubs } from '@doblaje/core';
import { isProjectId } from '@doblaje/db';
import {
  cleanTake,
  detectSpeech,
  type ExportOptions,
  ingest,
  type PodcastExportOptions,
  planExport,
  podcastExport,
  runExport,
  type SpeechOptions,
  type StemRequest,
  separateStems,
} from '@doblaje/media';
import type { AppContext } from '../context.ts';
import { readBody, readJson, safeFileName, streamToFile } from '../http.ts';
import { type Router, reply } from '../router.ts';

const SOURCE_EXT = /^\.(mp4|webm|mov|mkv|m4v|avi|mp3|wav|m4a|ogg|flac)$/;

export function projectRoutes(r: Router, ctx: AppContext): void {
  const { cfg, projects, jobs } = ctx;
  const projectId = (id: string) => {
    if (!isProjectId(id)) throw new AppError(400, 'bad id');
    return id;
  };
  const startIngest = (id: string, file: string) => jobs.run('ingest', (progress) => ingest(cfg.media, projects, id, file, progress), { projectId: id });

  // ?kind=clips (the library) | projects | (all)
  r.get('/api/projects', ({ url }) => {
    const kind = url.searchParams.get('kind');
    return projects.list(kind === 'clips' ? { template: true } : kind === 'projects' ? { template: false } : {});
  });
  r.post('/api/projects', async ({ req }) => {
    const b = await readJson<{ name?: string; mode?: Mode; template?: boolean }>(req);
    return reply(201, projects.create({ name: b.name, mode: b.mode, template: b.template === true }));
  });
  // Import a file that is already on this computer (hard-linked, no upload). Local binds only.
  r.post('/api/projects/from-path', async ({ req }) => {
    if (!ctx.localOnly) throw new AppError(403, 'from-path is only available when bound to localhost');
    const b = await readJson<{ path?: string; name?: string; mode?: Mode; template?: boolean }>(req);
    const src = path.resolve(String(b.path || ''));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new AppError(400, 'file not found');
    const proj = projects.create({ name: b.name || path.basename(src, path.extname(src)), mode: b.mode, template: b.template === true });
    const dest = path.join(projects.dir(proj.id), `source${path.extname(src).toLowerCase()}`);
    try {
      fs.linkSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);
    }
    return reply(202, { project: proj, job: startIngest(proj.id, dest).id });
  });

  r.get<'id'>('/api/projects/:id', ({ params }) => projects.get(projectId(params.id)));
  r.put<'id'>('/api/projects/:id', async ({ req, params }) =>
    projects.update(projectId(params.id), await readJson<Partial<EditableProject>>(req, 50 * 1024 * 1024)),
  );
  r.delete<'id'>('/api/projects/:id', ({ params }) => {
    projects.remove(projectId(params.id));
    return { ok: true };
  });

  // a new dubbing / party / podcast project from a library clip
  r.post<'id'>('/api/projects/:id/derive', async ({ req, params }) => {
    const b = await readJson<{ mode?: Mode; name?: string }>(req);
    if (!b.mode || !isMode(b.mode)) throw new AppError(400, 'mode must be pro, party or podcast');
    return reply(201, projects.derive(projectId(params.id), { mode: b.mode, name: b.name }));
  });

  r.post<'id'>('/api/projects/:id/source', async ({ req, params }) => {
    const id = projectId(params.id);
    projects.get(id);
    const ext = (path.extname(safeFileName(req.headers['x-filename']) || 'upload.mp4') || '.mp4').toLowerCase();
    if (!SOURCE_EXT.test(ext)) throw new AppError(415, 'unsupported file type');
    const dest = path.join(projects.dir(id), `source${ext}`);
    await streamToFile(req, dest, cfg.maxUploadBytes);
    return reply(202, { job: startIngest(id, dest).id });
  });

  r.post<'id'>('/api/projects/:id/stems', async ({ req, params }) => {
    const id = projectId(params.id);
    const o = await readJson<{ method?: StemRequest }>(req).catch(() => ({}) as { method?: StemRequest });
    return reply(202, {
      job: jobs.run('stems', (progress) => separateStems(cfg.media, projects, id, { method: o.method || 'auto' }, progress), { projectId: id }).id,
    });
  });
  r.post<'id'>('/api/projects/:id/speech-segments', async ({ req, params }) => ({
    segments: await detectSpeech(cfg.media, projects, projectId(params.id), await readJson<SpeechOptions>(req)),
  }));

  // Recorded takes (WAV from the browser) and their optional server-side clean-up
  r.post<'id' | 'name'>('/api/projects/:id/takes/:name', async ({ req, params }) => {
    const id = projectId(params.id);
    projects.get(id);
    const name = safeFileName(params.name);
    if (!/^[\w-]+\.wav$/.test(name)) throw new AppError(400, 'bad take name');
    const file = projects.file(id, `takes/${name}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return reply(201, { name, bytes: await streamToFile(req, file, 1024 ** 3) });
  });
  r.post<'id' | 'name'>('/api/projects/:id/takes/:name/clean', async ({ params }) => {
    const id = projectId(params.id);
    const name = safeFileName(params.name);
    const src = projects.file(id, `takes/${name}`);
    if (!fs.existsSync(src)) throw new AppError(404, 'take not found');
    const out = `${name.replace(/\.wav$/, '')}_clean.wav`;
    return { name: out, ...(await cleanTake(cfg.media, src, projects.file(id, `takes/${out}`))) };
  });

  // Browser-rendered mixes/stems used by export (rendered with the same graph as the preview)
  r.post<'id' | 'name'>('/api/projects/:id/renders/:name', async ({ req, params }) => {
    const id = projectId(params.id);
    projects.get(id);
    if (!/^(mix|bg|dry|wet)$/.test(params.name)) throw new AppError(400, 'bad render name');
    const dir = path.join(projects.dir(id), 'renders');
    fs.mkdirSync(dir, { recursive: true });
    return reply(201, { name: params.name, bytes: await streamToFile(req, path.join(dir, `${params.name}.wav`), 2 * 1024 ** 3) });
  });

  // Live podcast recording, streamed in chunks (memory-safe for long sessions): start, append…, finish
  r.post<'id' | 'step'>('/api/projects/:id/recording/:step', async ({ req, params }) => {
    const id = projectId(params.id);
    projects.get(id);
    const part = projects.file(id, 'recording.part');
    switch (params.step) {
      case 'start':
        fs.rmSync(part, { force: true });
        return { ok: true };
      case 'append':
        fs.appendFileSync(part, await readBody(req, 64 * 1024 * 1024));
        return { bytes: fs.statSync(part).size };
      case 'finish': {
        if (!fs.existsSync(part) || fs.statSync(part).size < 1000) throw new AppError(400, 'nothing was recorded');
        const dest = projects.file(id, 'source.webm');
        fs.renameSync(part, dest);
        return reply(202, { job: startIngest(id, dest).id });
      }
      default:
        throw new AppError(404, 'not found');
    }
  });

  r.post<'id'>('/api/projects/:id/export', async ({ req, params }) => {
    const id = projectId(params.id);
    const o = await readJson<ExportOptions>(req);
    return reply(202, { job: jobs.run('export', (progress) => runExport(cfg.media, projects, id, o, progress), { projectId: id }).id });
  });
  r.post<'id'>('/api/projects/:id/export-plan', async ({ req, params }) => {
    const media = projects.get(projectId(params.id)).media;
    if (!media) throw new AppError(409, 'no media yet');
    return planExport(media, await readJson<ExportOptions>(req));
  });
  r.post<'id'>('/api/projects/:id/podcast-export', async ({ req, params }) => {
    const id = projectId(params.id);
    const o = await readJson<PodcastExportOptions>(req);
    return reply(202, { job: jobs.run('podcast-export', (progress) => podcastExport(cfg.media, projects, id, o, progress), { projectId: id }).id });
  });
  r.post<'id'>('/api/projects/:id/import-subs', async ({ req }) => {
    const cues = parseSubs((await readBody(req, 5 * 1024 * 1024)).toString('utf8'));
    if (!cues.length) throw new AppError(400, 'no cues found in subtitle file');
    return { cues };
  });
}
