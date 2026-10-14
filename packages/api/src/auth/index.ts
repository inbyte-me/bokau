// Who is hosting. Only people who open rooms sign in (guests never do); the identity provider keeps the passwords and
// the emails, this server keeps a user id, a display name and which library clips are theirs.
import type { IncomingMessage } from 'node:http';

export interface Person {
  /** the provider's id for them (stable) */
  id: string;
  name: string;
}

export type AuthKind = 'none' | 'dev' | 'workos';

/** A signed-in person, and, when the provider renewed their session, the cookie value to set. */
export interface Resolved {
  person: Person;
  cookie?: string;
}

export interface Auth {
  readonly kind: AuthKind;
  /** hosting needs a login (otherwise rooms are anonymous and the whole library is open, as on a laptop) */
  readonly required: boolean;
  /** the address to send a person to so they can sign in; they come back to `/auth/callback` */
  loginUrl(returnTo: string): Promise<string>;
  /** the provider sent the person back with a code: the session cookie value to keep, and who they are */
  callback(code: string, req: IncomingMessage): Promise<{ cookie: string; person: Person }>;
  /** who the request is from (null: nobody signed in) */
  resolve(req: IncomingMessage): Promise<Resolved | null>;
  /** where to send the person to finish signing out at the provider (null: nothing more to do) */
  logoutUrl(req: IncomingMessage, returnTo: string): Promise<string | null>;
}

export const SESSION_COOKIE = 'doblaje-session';

/** The value of a cookie in a request. */
export function cookieOf(req: IncomingMessage, name: string): string | null {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** A Set-Cookie value: not readable by scripts, only to this site, HTTPS only when the site is. */
export function setCookie(name: string, value: string, { secure, maxAgeSeconds }: { secure: boolean; maxAgeSeconds: number }): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAgeSeconds}`;
}

/** Where to go after signing in: a path on this server, never another site (no open redirect). */
export const safeReturn = (to: unknown): string => (typeof to === 'string' && /^\/[^/\\]/.test(to) ? to : '/play/');

/** No accounts: rooms are anonymous and every library clip is open (a laptop, a household). */
export const noAuth: Auth = {
  kind: 'none',
  required: false,
  loginUrl: async () => '/play/',
  callback: async () => {
    throw new Error('accounts are off');
  },
  resolve: async () => null,
  logoutUrl: async () => null,
};
