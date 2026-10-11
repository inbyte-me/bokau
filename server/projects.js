import fs from 'node:fs';
import path from 'node:path';
import { HttpError, isId, uid, readJsonFile, writeJsonAtomic } from './util.js';
import { defaultProject, migrate } from '../shared/project.js';

export class Projects {
  constructor(cfg) { this.cfg = cfg; fs.mkdirSync(cfg.projectsDir, { recursive: true }); }
  dir(id) { if (!isId(id)) throw new HttpError(400, 'bad project id'); return path.join(this.cfg.projectsDir, id); }
  file(id, name) {
    if (!/^[\w.\-]+(\/[\w.\-]+)*$/.test(name) || name.includes('..')) throw new HttpError(400, 'bad file name');
    return path.join(this.dir(id), name);
  }
  exists(id) { return fs.existsSync(path.join(this.dir(id), 'project.json')); }
  create({ name, mode }) {
    const id = 'p' + uid(9);
    fs.mkdirSync(path.join(this.dir(id), 'takes'), { recursive: true });
    const p = defaultProject({ id, name: (name || 'Untitled').slice(0, 120), mode: mode === 'party' ? 'party' : 'pro' });
    this.save(p);
    return p;
  }
  get(id) {
    const p = readJsonFile(path.join(this.dir(id), 'project.json'));
    if (!p) throw new HttpError(404, 'project not found');
    return migrate(p);
  }
  save(p) {
    p.updatedAt = new Date().toISOString();
    writeJsonAtomic(path.join(this.dir(p.id), 'project.json'), p);
    return p;
  }
  /** Merge client-editable fields; server owns media/stems status. */
  update(id, patch) {
    const cur = this.get(id);
    const { media, stems, id: _i, createdAt, ...editable } = patch || {};
    const next = migrate({ ...cur, ...editable, media: cur.media, stems: cur.stems, id: cur.id, createdAt: cur.createdAt });
    return this.save(next);
  }
  list() {
    const out = [];
    for (const d of fs.readdirSync(this.cfg.projectsDir)) {
      const p = readJsonFile(path.join(this.cfg.projectsDir, d, 'project.json'));
      if (!p) continue;
      out.push({ id: p.id, name: p.name, mode: p.mode, updatedAt: p.updatedAt, createdAt: p.createdAt, duration: p.media?.duration || 0, ready: !!p.media?.ready, poster: p.media?.ready ? `/media/${p.id}/poster.jpg` : null, cues: p.cues?.length || 0, takes: (p.tracks || []).reduce((n, t) => n + (t.clips?.length || 0), 0) });
    }
    return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  remove(id) { fs.rmSync(this.dir(id), { recursive: true, force: true }); }
}
