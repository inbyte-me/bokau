import type { IncomingMessage } from 'node:http';
import { AppError } from '@doblaje/core';
import { SESSION_COOKIE, safeReturn, setCookie } from '../auth/index.ts';
import type { AppContext } from '../context.ts';
import { type Router, reply } from '../router.ts';
import { lanAddresses } from './net.ts';

/** The phone's identity in a room (sent on every request; `?t=` only where a header cannot be set). */
export const partyToken = (req: IncomingMessage, url?: URL): string | null => {
  const h = req.headers['x-party-token'];
  return (typeof h === 'string' ? h : null) ?? url?.searchParams.get('t') ?? null;
};
/** The room's host key, for a client that holds it (a TV, or a phone that created the room). */
export const partyHostKey = (req: IncomingMessage): string | null => {
  const h = req.headers['x-party-host'];
  return typeof h === 'string' ? h : null;
};

/**
 * Routes for whoever creates a room: the local TV, or in a party server any phone. A room is cheap but not free, so
 * creating one is limited per address (`ctx.createRoomAllowed`), and a server holds at most `maxRooms` of them.
 */
export function partyCreateRoutes(r: Router, ctx: AppContext): void {
  r.post('/api/party/rooms', async ({ req, res }) => {
    // with accounts on, only a signed-in person opens a room: it is theirs, and so is the library it plays from
    const host = await ctx.personOf(req, res);
    if (ctx.auth.required && !host) throw new AppError(401, 'sign in to host a room', 'login');
    if (!ctx.createRoomAllowed(req)) throw new AppError(429, 'too many rooms from this address, try again later');
    return reply(201, ctx.party.create({ ownerId: host?.id ?? null }));
  });
  r.get('/api/me', async ({ req, res }) => ({ accounts: ctx.auth.kind, loginRequired: ctx.auth.required, person: await ctx.personOf(req, res) }));
  r.get('/api/party/info', () => ({
    mode: ctx.cfg.mode,
    joinBase: ctx.partyBase(),
    lan: ctx.cfg.party.port !== null,
    addresses: ctx.cfg.mode === 'studio' ? lanAddresses() : [],
    /** the server listens to takes itself: a TV need not */
    transcribes: ctx.cfg.party.transcribe,
  }));
}

/** Sign in and out (served wherever phones are: the cookie belongs to the host's own phone). */
export function authRoutes(r: Router, ctx: AppContext): void {
  const secure = () => !!ctx.cfg.party.tls || (ctx.cfg.party.publicUrl ?? '').startsWith('https:') || ctx.cfg.mode === 'studio';
  r.get('/auth/login', async ({ res, url }) => {
    const to = await ctx.auth.loginUrl(safeReturn(url.searchParams.get('return')));
    res.writeHead(302, { location: to, 'cache-control': 'no-store' });
    res.end();
  });
  r.get('/auth/callback', async ({ req, res, url }) => {
    const code = url.searchParams.get('code');
    if (!code) throw new AppError(400, 'no sign-in code');
    const { cookie, person } = await ctx.auth.callback(code, req).catch(() => {
      throw new AppError(401, 'sign-in failed');
    });
    ctx.users.touch(person);
    res.writeHead(302, {
      location: safeReturn(url.searchParams.get('state')),
      'set-cookie': setCookie(SESSION_COOKIE, cookie, { secure: secure(), maxAgeSeconds: 30 * 86400 }),
      'cache-control': 'no-store',
    });
    res.end();
  });
  r.get('/auth/logout', async ({ req, res }) => {
    const out = await ctx.auth.logoutUrl(req, `${ctx.partyBase() ?? ''}/play/`).catch(() => null);
    res.writeHead(302, {
      location: out ?? '/play/',
      'set-cookie': setCookie(SESSION_COOKIE, '', { secure: secure(), maxAgeSeconds: 0 }),
      'cache-control': 'no-store',
    });
    res.end();
  });
}

/** Routes for the local TV (served on the local listener only: the studio's library and the Wi-Fi addresses). */
export function partyHostRoutes(r: Router, ctx: AppContext): void {
  partyCreateRoutes(r, ctx);
}

/** Routes for phones (served on every listener; each one needs the player's token, the host's ones the host key too). */
export function partyPlayerRoutes(r: Router, ctx: AppContext): void {
  r.get<'code'>('/api/party/rooms/:code/project', ({ req, params }) => ctx.party.project(params.code, partyToken(req)));
  r.post<'code'>('/api/party/rooms/:code/takes', async ({ req, url, params }) =>
    reply(201, await ctx.party.submitTake(params.code, partyToken(req), Number(url.searchParams.get('turn')), Number(url.searchParams.get('start')), req)),
  );
  // the host's: the library to pick a clip from, and the mix it renders for the finished round
  r.get<'code'>('/api/party/rooms/:code/clips', ({ req, params }) => ctx.party.clips(params.code, partyToken(req), partyHostKey(req)));
  r.post<'code'>('/api/party/rooms/:code/mix', async ({ req, params }) =>
    reply(201, await ctx.party.receiveMix(params.code, partyToken(req), partyHostKey(req), req)),
  );
}
