import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const uid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
export const isId = (s) => typeof s === 'string' && /^[a-z0-9_-]{4,40}$/i.test(s);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

export async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
export async function readJson(req, limit) {
  const b = await readBody(req, limit);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

/** Stream a request body to disk atomically (via .part file). */
export async function streamToFile(req, file, limit) {
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  let n = 0;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (c) => { n += c.length; if (limit && n > limit) { req.destroy(); reject(new HttpError(413, 'upload too large')); } });
      req.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
    fs.renameSync(tmp, file);
    return n;
  } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
}

export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
export function readJsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.srt': 'application/x-subrip', '.vtt': 'text/vtt',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.onnx': 'application/octet-stream', '.woff2': 'font/woff2',
};
export const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

/** Serve a file with HTTP Range support (needed for <video> seeking). */
export function serveFile(req, res, file, { cache = 'no-cache', download } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'not found'); }
  if (!st.isFile()) throw new HttpError(404, 'not found');
  const headers = { 'content-type': mimeOf(file), 'accept-ranges': 'bytes', 'cache-control': cache, 'last-modified': st.mtime.toUTCString() };
  if (download) headers['content-disposition'] = `attachment; filename="${download.replace(/"/g, '')}"`;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
      let end = m[1] === '' || m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export const safeName = (s, fallback = 'file') => (String(s || fallback).normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || fallback);
