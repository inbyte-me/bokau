import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { serveFile, HttpError } from './util.js';

/**
 * Caching proxy for Hugging Face model files, so speech models are downloaded once into ./models
 * and the app works offline afterwards. transformers.js is pointed at /hf/ as its remote host.
 * Path format: /hf/<org>/<model>/resolve/<rev>/<file...>
 */
export async function serveHf(cfg, req, res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/hf\//, ''));
  if (!/^[\w.\-]+\/[\w.\-]+\/resolve\/[\w.\-]+\/[\w.\-/]+$/.test(rel) || rel.includes('..')) throw new HttpError(400, 'bad model path');
  const local = path.join(cfg.modelsDir, rel);
  if (fs.existsSync(local)) return serveFile(req, res, local, { cache: 'public, max-age=31536000, immutable' });
  const r = await fetch(`https://huggingface.co/${rel}`, { redirect: 'follow' });
  if (!r.ok) { res.writeHead(r.status === 404 ? 404 : 502); return res.end(); }
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const tmp = local + '.part' + process.pid;
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, local);
  serveFile(req, res, local, { cache: 'public, max-age=31536000, immutable' });
}
