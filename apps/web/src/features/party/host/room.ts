// The TV remembers its open room for this tab, so a reload goes back to the same room (same QR, same players).
const KEY = 'party.host';

export interface HostRoom {
  code: string;
  hostKey: string;
  joinUrl: string;
}

export function loadRoom(): HostRoom | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as HostRoom | null;
    return r?.code && r.hostKey ? r : null;
  } catch {
    return null;
  }
}
export function saveRoom(r: HostRoom | null): void {
  try {
    if (r) sessionStorage.setItem(KEY, JSON.stringify(r));
    else sessionStorage.removeItem(KEY);
  } catch {}
}
