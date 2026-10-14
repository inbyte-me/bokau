// Where the party server is. By default the page's own origin (the server serves this app at /play/); a build made with
// `VITE_PARTY_API=https://party.example.com` talks to that server instead, so the phone app can live on a static host or a CDN
// (the server then lists that origin in PARTY_ORIGINS).
const configured = ((import.meta.env.VITE_PARTY_API as string | undefined) ?? '').replace(/\/$/, '');

/** An absolute address on the party server for a path like `/api/party/rooms`. */
export const serverUrl = (path: string): string => `${configured}${path}`;

/** The room socket's address. */
export function socketUrl(): string {
  const u = new URL(configured || location.origin);
  return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/party/ws`;
}
