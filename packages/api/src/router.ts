import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from './http.ts';

export interface RequestCtx<P extends string = string> {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<P, string>;
}
/**
 * A handler returns the JSON body (status 200), a `Reply` for another status,
 * or `undefined` after writing the response itself (files, streams).
 */
export type Handler<P extends string = string> = (c: RequestCtx<P>) => unknown | Promise<unknown>;

export class Reply {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
}
export const reply = (status: number, body: unknown) => new Reply(status, body);

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
interface Route {
  method: Method;
  parts: string[];
  handler: Handler;
}

/**
 * Tiny path router: `/api/projects/:id/takes/:name`. Static segments win over parameters,
 * so `/api/projects/from-path` is not captured by `/api/projects/:id`.
 */
export class Router {
  #routes: Route[] = [];
  #add(method: Method, pattern: string, handler: Handler) {
    this.#routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    this.#routes.sort((a, b) => score(b) - score(a));
    return this;
  }
  get<P extends string>(p: string, h: Handler<P>) {
    return this.#add('GET', p, h as Handler);
  }
  post<P extends string>(p: string, h: Handler<P>) {
    return this.#add('POST', p, h as Handler);
  }
  put<P extends string>(p: string, h: Handler<P>) {
    return this.#add('PUT', p, h as Handler);
  }
  delete<P extends string>(p: string, h: Handler<P>) {
    return this.#add('DELETE', p, h as Handler);
  }

  /** Returns false when no route matched. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    // split before decoding, so an encoded slash stays inside its segment (and fails the id checks)
    const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    for (const r of this.#routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      const matches = r.parts.every((p, i) => {
        if (!p.startsWith(':')) return p === segs[i];
        params[p.slice(1)] = segs[i];
        return true;
      });
      if (!matches) continue;
      const out = await r.handler({ req, res, url, params });
      if (out instanceof Reply) json(res, out.status, out.body);
      else if (out !== undefined) json(res, 200, out);
      return true;
    }
    return false;
  }
}
const score = (r: Route) => r.parts.reduce((n, p, i) => n + (p.startsWith(':') ? 0 : 2 ** (10 - i)), 0);
