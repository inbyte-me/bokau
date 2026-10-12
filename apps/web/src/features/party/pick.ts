// Party, karaoke style: anyone picks a prepared clip from the library and the character(s) they will play.
// TV-sized, keyboard / presenter-clicker friendly (Up/Down/Enter, Esc to go back).
import type { Project, ProjectSummary, Speaker } from '@doblaje/core';
import { clear, fmtClock, h, icon, t, toast } from '@doblaje/ui';
import { api } from '../../api.ts';
import type { KaraokeSetup } from './party.ts';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Toggle buttons for the characters of a clip plus the player's name. */
export function characterPicker(speakers: Speaker[], separated: boolean): { el: HTMLElement; chosen(): string[]; player(): string } {
  const picked = new Set<string>();
  const name = h('input#player-name', { type: 'text', placeholder: t('Your name (optional)') });
  const list = h(
    'div.character-picks',
    ...speakers.map((s) =>
      h(
        'button.character-pick',
        {
          type: 'button',
          dataset: { speaker: s.id },
          'aria-pressed': 'false',
          style: { borderLeftColor: s.color },
          onclick: (e) => {
            const b = e.currentTarget;
            if (picked.has(s.id)) picked.delete(s.id);
            else picked.add(s.id);
            b.setAttribute('aria-pressed', String(picked.has(s.id)));
            b.classList.toggle('on', picked.has(s.id));
          },
        },
        s.name,
      ),
    ),
  );
  const el = h(
    'div.col',
    h('div.field', h('label', t('Who is playing?')), name),
    h('div.lab', t('Which character(s) do you play?')),
    speakers.length ? list : h('div.hint.warn', t('This clip has no characters yet. Prepare it in the library first (Voices → Prepare all).')),
    separated ? null : h('div.hint.warn', t('The dialogue of this clip is not separated, so the original voices cannot be silenced.')),
  );
  return { el, chosen: () => [...picked], player: () => name.value.trim() };
}

/** Route #/party: the clip list, then the character choice; starting creates a party project from the clip. */
export function mountPartyPicker(root: HTMLElement, { go }: { go: (path: string) => void }): { destroy(): void } {
  clear(root);
  const body = h('div.party-body#party-picker');
  root.append(h('div.party', body));
  let clips: ProjectSummary[] = [];

  const list = () => {
    clear(body);
    const ready = clips.filter((c) => c.ready);
    const items = h(
      'ul.running#clip-list',
      ...ready.map((c, i) =>
        h(
          'li',
          h(
            'button.item.pick-clip',
            { dataset: { id: c.id }, onclick: () => void choose(c) },
            h('span.k', String(i + 1)),
            h('span', h('h3', c.name), h('p', `${fmtClock(c.duration)} · ${c.characters.length ? c.characters.join(', ') : t('no characters yet')}`)),
          ),
        ),
      ),
    );
    body.append(
      h('div.row', h('button.ghost#party-back', { onclick: () => go('/') }, icon('back'), t('Library')), h('h1', t('Pick a clip'))),
      h('p.lead', t('Choose a scene, then the character you will play. Up/Down and Enter work from the sofa.')),
      ready.length ? items : h('div.empty', t('The clip library is empty. Add clips from the library first.')),
    );
    items.addEventListener('keydown', (e) => {
      const els = [...items.querySelectorAll<HTMLElement>('.item')];
      const i = els.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') els[Math.min(els.length - 1, i + 1)]?.focus();
      else if (e.key === 'ArrowUp') els[Math.max(0, i - 1)]?.focus();
      else return;
      e.preventDefault();
    });
    setTimeout(() => items.querySelector<HTMLElement>('.item')?.focus(), 0);
  };

  const choose = async (c: ProjectSummary) => {
    let clip: Project;
    try {
      clip = await api.project(c.id);
    } catch (e) {
      toast(errMsg(e), 'error');
      return;
    }
    clear(body);
    const picker = characterPicker(clip.speakers.list, clip.stems.status === 'ready');
    const start: HTMLButtonElement = h(
      'button.signal.big-btn#pick-start',
      {
        onclick: async () => {
          const characters = picker.chosen();
          if (clip.speakers.list.length && !characters.length) {
            toast(t('Pick at least one character'), 'error');
            return;
          }
          start.disabled = true;
          try {
            const player = picker.player();
            const p = await api.derive(clip.id, 'party', `${clip.name} · ${player || t('Party')}`);
            p.party = { ...p.party, karaoke: { characters, player } satisfies KaraokeSetup };
            await api.savedProject(p.id, p);
            go(`/p/${p.id}`);
          } catch (e) {
            toast(errMsg(e), 'error');
            start.disabled = false;
          }
        },
      },
      icon('rec'),
      t('Start'),
    );
    body.append(
      h('div.row', h('button.ghost#pick-back', { onclick: list }, icon('back'), t('Clips')), h('h1', clip.name)),
      h(
        'div.row',
        { style: { alignItems: 'flex-start', gap: '1.5rem', flexWrap: 'wrap' } },
        h('div.col.grow', { style: { minWidth: '320px' } }, picker.el),
        clip.media?.ready ? h('img.pick-poster', { src: `/media/${clip.id}/poster.jpg`, alt: '' }) : null,
      ),
      h('div.row', start),
    );
    body.querySelector<HTMLElement>('.character-pick')?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) go('/');
  };
  window.addEventListener('keydown', onKey);
  void api
    .projects('clips')
    .then((r) => {
      clips = r;
      list();
    })
    .catch((e) => toast(errMsg(e), 'error'));
  return { destroy: () => window.removeEventListener('keydown', onKey) };
}
