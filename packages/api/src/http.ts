import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { AppError } from '@doblaje/core';

export { AppError as HttpError };

export function json(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

export async function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    n += c.length;
    if (n > limit) throw new AppError(413, 'body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit?: number): Promise<T> {
  const b = await readBody(req, limit);
  if (!b.length) return {} as T;
  try {
    return JSON.parse(b.toString('utf8')) as T;
  } catch {
    throw new AppError(400, 'invalid JSON');
  }
}

/** Stream a request body to disk atomically (via a .part file). Returns the byte count. */
export async function streamToFile(req: IncomingMessage, file: string, limit?: number): Promise<number> {
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let n = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (limit && n > limit) {
          req.destroy();
          reject(new AppError(413, 'upload too large'));
        }
      });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
    fs.renameSync(tmp, file);
    return n;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.onnx': 'application/octet-stream',
  '.woff2': 'font/woff2',
};
export const mimeOf = (f: string) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

/** Serve a file with HTTP Range support (needed for <video> seeking). */
export function serveFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  { cache = 'no-cache', download }: { cache?: string; download?: string } = {},
): void {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    throw new AppError(404, 'not found');
  }
  if (!st.isFile()) throw new AppError(404, 'not found');
  const headers: Record<string, string | number> = {
    'content-type': mimeOf(file),
    'accept-ranges': 'bytes',
    'cache-control': cache,
    'last-modified': st.mtime.toUTCString(),
  };
  if (download) headers['content-disposition'] = `attachment; filename="${download.replace(/"/g, '')}"`;
  const m = req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
  if (m) {
    const start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

/** Resolve `rel` inside `base`, refusing anything that escapes it. */
export function safeJoin(base: string, rel: string): string {
  const root = path.resolve(base);
  const f = path.resolve(root, `.${path.sep}${rel}`);
  if (f !== root && !f.startsWith(root + path.sep)) throw new AppError(403, 'forbidden');
  return f;
}
