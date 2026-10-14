// Hash routes: #/ (library), #/new, #/p/<id> (an open project; /studio opens a party round in the studio), #/party[?clip=<id>] (party room, optionally with a clip).
// One reactive `route`; `go()` changes the hash, the browser's back/forward work as usual.

export type Route =
  | { name: 'library'; path: string; newProject: boolean }
  | { name: 'project'; path: string; id: string; studio: boolean }
  | { name: 'party'; path: string; clip: string | null };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  const m = /^\/p\/([\w-]+)(\/studio)?/.exec(path);
  if (m) return { name: 'project', path, id: m[1], studio: !!m[2] };
  const [base, query = ''] = path.split('?');
  if (base === '/party') return { name: 'party', path, clip: new URLSearchParams(query).get('clip') };
  return { name: 'library', path, newProject: path === '/new' };
}

class Router {
  current = $state<Route>(parse(location.hash));
  #before = new Set<(next: Route) => void>();
  constructor() {
    window.addEventListener('hashchange', () => {
      const next = parse(location.hash);
      for (const f of this.#before) f(next);
      this.current = next;
    });
  }
  /** run before every route change (e.g. close the open project when leaving it) */
  beforeChange(f: (next: Route) => void): () => void {
    this.#before.add(f);
    return () => this.#before.delete(f);
  }
}
export const router = new Router();

export function go(path: string): void {
  location.hash = `#${path}`;
}
