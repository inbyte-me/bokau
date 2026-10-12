import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { AppError } from '@doblaje/core';
import { serveFile } from './http.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Caching proxy for Hugging Face model files, so speech models are downloaded once into the models folder
 * and the app works offline afterwards. transformers.js is pointed at /hf/ as its remote host.
 * Path format: /hf/<org>/<model>/resolve/<rev>/<file...>
 */
export async function serveHf(modelsDir: string, req: IncomingMessage, res: ServerResponse, rel: string): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+\/resolve\/[\w.-]+\/[\w.\-/]+$/.test(rel) || rel.includes('..')) throw new AppError(400, 'bad model path');
  const local = path.join(modelsDir, rel);
  if (!fs.existsSync(local)) {
    const r = await fetch(`https://huggingface.co/${rel}`, { redirect: 'follow' });
    if (!r.ok || !r.body) {
      res.writeHead(r.status === 404 ? 404 : 502);
      res.end();
      return;
    }
    fs.mkdirSync(path.dirname(local), { recursive: true });
    const tmp = `${local}.part${process.pid}`;
    await pipeline(Readable.fromWeb(r.body as ReadableStream), fs.createWriteStream(tmp));
    fs.renameSync(tmp, local);
  }
  serveFile(req, res, local, { cache: IMMUTABLE });
}
