// Files of a party room on the party server, behind the player's token.

/** A file of the round's project (`proxy.mp4`, `poster.jpg`, a take…) as the phone asks for it. */
export const partyMedia = (code: string, token: string, file: string): string => `/party/${code}/media/${file}?t=${encodeURIComponent(token)}`;

const videos = new Map<string, Promise<string>>();

/**
 * The round's picture as a local (blob) URL. Phone browsers play a <video> through their own media stack, which
 * seeks badly or not at all over the room's self-signed HTTPS address (a clip that loops its first second); a file
 * fetched once and played from memory seeks anywhere. Falls back to the plain URL when the download fails.
 */
export function partyVideo(code: string, token: string, projectId: string): Promise<string> {
  const key = `${code}|${projectId}`;
  let hit = videos.get(key);
  if (!hit) {
    for (const [k, old] of videos) {
      if (k.startsWith(`${code}|`)) {
        videos.delete(k);
        void old.then((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
      }
    }
    const url = partyMedia(code, token, 'proxy.mp4');
    hit = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => URL.createObjectURL(b))
      .catch(() => {
        videos.delete(key);
        return url;
      });
    videos.set(key, hit);
  }
  return hit;
}
