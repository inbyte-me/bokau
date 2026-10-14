import { type Auth, cookieOf, type Person, SESSION_COOKIE } from './index.ts';

/**
 * A stand-in for the identity provider, for tests and local work: `/auth/callback?code=<name>` signs in as <name>.
 * Anyone can be anyone, so a server never starts with it unless told to (`AUTH_PROVIDER=dev`).
 */
export function devAuth(): Auth {
  const person = (raw: string): Person => ({ id: `dev_${raw.replace(/\W+/g, '').toLowerCase().slice(0, 40) || 'host'}`, name: raw.slice(0, 40) || 'Host' });
  return {
    kind: 'dev',
    required: true,
    loginUrl: async (returnTo) => `/auth/callback?code=${encodeURIComponent('Dev Host')}&state=${encodeURIComponent(returnTo)}`,
    callback: async (code) => ({ cookie: code, person: person(code) }),
    resolve: async (req) => {
      const v = cookieOf(req, SESSION_COOKIE);
      return v ? { person: person(v) } : null;
    },
    logoutUrl: async () => null,
  };
}
