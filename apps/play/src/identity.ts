// What a phone remembers: its name, and per room its player token (the server knows it by that).
// Storage can be unavailable (private mode); then the phone simply joins again by name.
const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

const tokenKey = (code: string, seat: string) => `party.token.${code}${seat ? `.${seat}` : ''}`;

export const loadName = (seat: string): string => get(`party.name${seat ? `.${seat}` : ''}`) ?? '';
export const saveName = (seat: string, name: string): void => set(`party.name${seat ? `.${seat}` : ''}`, name);
export const loadToken = (code: string, seat: string): string | null => get(tokenKey(code, seat));
export const saveToken = (code: string, seat: string, token: string): void => set(tokenKey(code, seat), token);
export const forgetToken = (code: string, seat: string): void => set(tokenKey(code, seat), null);

const hostKey = (code: string, seat: string) => `party.host.${code}${seat ? `.${seat}` : ''}`;
/** The host key of a room this phone created (it brings the phone back as the host after a reload). */
export const loadHostKey = (code: string, seat: string): string | null => get(hostKey(code, seat));
export const saveHostKey = (code: string, seat: string, key: string): void => set(hostKey(code, seat), key);
