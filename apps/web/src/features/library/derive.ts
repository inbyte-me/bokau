import type { Mode } from '@doblaje/core';
import { t, toast } from '@doblaje/ui';
import { api } from '../../api.ts';

export const modeLabel = (m: Mode): string => (m === 'party' ? t('Party') : m === 'podcast' ? t('Podcast') : t('Dub'));

/** Start a project of `mode` from a library clip and open it. */
export async function deriveAndOpen(clipId: string, mode: Mode, go: (path: string) => void): Promise<void> {
  try {
    const p = await api.derive(clipId, mode);
    go(`/p/${p.id}`);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
