import type { IncomingMessage } from 'node:http';
import { AppError } from '@doblaje/core';
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
  r.post('/api/party/rooms', ({ req }) => {
    if (!ctx.createRoomAllowed(req)) throw new AppError(429, 'too many rooms from this address, try again later');
    return reply(201, ctx.party.create());
  });
  r.get('/api/party/info', () => ({
    mode: ctx.cfg.mode,
    joinBase: ctx.partyBase(),
    lan: ctx.cfg.party.port !== null,
    addresses: ctx.cfg.mode === 'studio' ? lanAddresses() : [],
    /** the server listens to takes itself: a TV need not */
    transcribes: ctx.cfg.party.transcribe,
  }));
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
