import type { IncomingMessage } from 'node:http';
import { WorkOS } from '@workos-inc/node';
import { type Auth, cookieOf, type Person, type Resolved, SESSION_COOKIE } from './index.ts';

export interface WorkosConfig {
  apiKey: string;
  clientId: string;
  /** 32+ characters: seals the session cookie (the session is readable only by this server) */
  cookiePassword: string;
  /** `https://<domain>/auth/callback`, as registered in the WorkOS dashboard */
  redirectUri: string;
}

const nameOf = (u: { firstName?: string | null; lastName?: string | null; email?: string | null }): string =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email?.split('@')[0] || 'Host';

/**
 * Sign-in through WorkOS AuthKit (the hosted login: email, Google…). The session is a sealed cookie that WorkOS's SDK
 * opens and renews; this server stores nothing about the session itself.
 */
export function workosAuth(cfg: WorkosConfig): Auth {
  if (cfg.cookiePassword.length < 32) throw new Error('WORKOS_COOKIE_PASSWORD must be at least 32 characters (openssl rand -base64 32)');
  const workos = new WorkOS(cfg.apiKey, { clientId: cfg.clientId });
  const load = (req: IncomingMessage) => {
    const sealed = cookieOf(req, SESSION_COOKIE);
    return sealed ? workos.userManagement.loadSealedSession({ sessionData: sealed, cookiePassword: cfg.cookiePassword }) : null;
  };
  return {
    kind: 'workos',
    required: true,
    loginUrl: async (returnTo) =>
      workos.userManagement.getAuthorizationUrl({ provider: 'authkit', clientId: cfg.clientId, redirectUri: cfg.redirectUri, state: returnTo }),
    callback: async (code) => {
      const r = await workos.userManagement.authenticateWithCode({
        clientId: cfg.clientId,
        code,
        session: { sealSession: true, cookiePassword: cfg.cookiePassword },
      });
      if (!r.sealedSession) throw new Error('no session came back');
      return { cookie: r.sealedSession, person: { id: r.user.id, name: nameOf(r.user) } };
    },
    resolve: async (req): Promise<Resolved | null> => {
      const session = load(req);
      if (!session) return null;
      const now = await session.authenticate();
      if (now.authenticated) return { person: { id: now.user.id, name: nameOf(now.user) } satisfies Person };
      // the access token ran out: the session may still be renewable
      const renewed = await session.refresh({ cookiePassword: cfg.cookiePassword }).catch(() => null);
      if (renewed?.authenticated && renewed.sealedSession)
        return { person: { id: renewed.user.id, name: nameOf(renewed.user) }, cookie: renewed.sealedSession };
      return null;
    },
    logoutUrl: async (req, returnTo) =>
      (await load(req)
        ?.getLogoutUrl({ returnTo })
        .catch(() => null)) ?? null,
  };
}
