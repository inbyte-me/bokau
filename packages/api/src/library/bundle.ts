// Moving a prepared clip between machines as one file: prepared in the studio on your computer, `export`ed to a tar, copied to
// the server and `import`ed there (into a host's library, sealed when the server has a library key). The bundle is `clip.json`
// (the clip's project: characters, lines, media facts) plus its media files; recordings, exports and renders are not part of a clip.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError, type Project, type ProjectRepository } from '@doblaje/core';
import { exec } from '@doblaje/media';
import type { Vault } from './vault.ts';

const BUNDLED = /^(source\.\w+|proxy\.mp4|poster\.jpg|thumbs\.jpg|audio_orig\.wav|audio_16k\.wav|stem_dialogue\.wav|stem_bg\.wav)$/;
const FORMAT = 1;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doblaje-bundle-'));

/** Pack a library clip into `file` (a tar). A sealed clip is opened for it: the bundle is plain, keep it safe. */
export async function exportClip(projects: ProjectRepository, vault: Vault | null, clipId: string, file: string): Promise<string[]> {
  const clip = projects.get(clipId);
  if (!clip.template || !clip.media?.ready) throw new AppError(400, 'not a prepared library clip');
  const dir = projects.dir(clipId);
  const work = tmp();
  try {
    if (fs.existsSync(path.join(dir, 'sealed.json'))) {
      if (!vault) throw new AppError(500, 'this clip is sealed: set the library key to export it');
      vault.open(dir, work, (n) => BUNDLED.test(n));
    } else for (const f of fs.readdirSync(dir).filter((n) => BUNDLED.test(n))) fs.copyFileSync(path.join(dir, f), path.join(work, f));
    fs.writeFileSync(path.join(work, 'clip.json'), JSON.stringify({ format: FORMAT, project: clip }));
    const files = fs.readdirSync(work);
    await exec('tar', ['-cf', file, '-C', work, ...files]);
    return files;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Unpack a bundle as a new clip in this library (sealed when there is a vault). Returns its id. */
export async function importClip(projects: ProjectRepository, vault: Vault | null, file: string, { name }: { name?: string } = {}): Promise<string> {
  const work = tmp();
  try {
    await exec('tar', ['-xf', file, '-C', work]);
    const entries = fs.readdirSync(work, { withFileTypes: true });
    // only what a bundle holds: flat files with plain names (nothing from an odd archive ends up elsewhere)
    for (const e of entries)
      if (!e.isFile() || !(e.name === 'clip.json' || BUNDLED.test(e.name))) throw new AppError(400, `unexpected entry in the bundle: ${e.name}`);
    const meta = JSON.parse(fs.readFileSync(path.join(work, 'clip.json'), 'utf8')) as { format?: number; project?: Project };
    const source = meta.project;
    if (meta.format !== FORMAT || !source?.media?.ready) throw new AppError(400, 'not a clip bundle this version can read');
    if (!entries.some((e) => e.name === source.media?.proxy) || !entries.some((e) => e.name === source.media?.sourceFile))
      throw new AppError(400, 'the bundle is missing the clip’s media');

    const created = projects.create({ name: name || source.name, mode: 'pro', template: true });
    const dir = projects.dir(created.id);
    try {
      for (const e of entries) if (e.name !== 'clip.json') fs.copyFileSync(path.join(work, e.name), path.join(dir, e.name));
      projects.save({ ...source, id: created.id, name: name || source.name, template: true, sourceTemplateId: null });
      if (vault) vault.seal(dir);
    } catch (e) {
      projects.remove(created.id);
      throw e;
    }
    return created.id;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
