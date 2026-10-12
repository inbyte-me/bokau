import crypto from 'node:crypto';

/** File-system-safe version of a user-provided name. */
export const safeName = (s: unknown, fallback = 'file'): string =>
  String(s || fallback)
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || fallback;

/** Sortable, unique folder name for one export: 2026-10-12T03-40-00-a1b */
export const exportStamp = (): string => `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomBytes(2).toString('hex').slice(0, 3)}`;
