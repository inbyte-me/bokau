import type { Marker } from '@doblaje/core';
import { clear, fmtClock, h, icon, t } from '@doblaje/ui';
import { app } from '../../app.ts';

/**
 * Marks: up to nine numbered positions (⌘/Ctrl+n sets, ⌥/Option+n jumps, [ and ] step through them), listed with
 * their time and an optional name. Click a row to jump; jumping while recording keeps recording.
 */
export function mountMarks(
  root: HTMLElement,
  { setMark, jumpMark }: { setMark: (n: number, at?: number) => void; jumpMark: (n: number) => void },
): { destroy(): void } {
  const list = h('div.col#marks-list');
  const add = h('button.primary#mark-add', { onclick: () => addAtPlayhead() }, icon('flag'), t('Add mark at the playhead'));
  root.append(
    h(
      'div.box',
      h('h4', t('Marks')),
      h('div.row', add),
      list,
      h('div.hint', t('⌘/Ctrl+1…9 set a mark · ⌥/Option+1…9 jump · [ and ] go to the previous / next mark. Jumping while recording keeps recording.')),
    ),
  );
  const free = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !app.project.markers.some((m) => m.n === n)) ?? null;
  function addAtPlayhead() {
    const n = free();
    if (n) setMark(n);
  }
  const rename = (m: Marker, name: string) =>
    app.store.commit(
      'Rename mark',
      (p) => {
        const x = p.markers.find((y) => y.n === m.n);
        if (x) x.name = name.trim() || undefined;
      },
      ['markers'],
    );
  function render() {
    clear(list);
    const marks = [...app.project.markers].sort((a, b) => a.t - b.t);
    add.disabled = free() == null;
    if (!marks.length) {
      list.append(h('div.hint', t('No marks yet. Press ⌘/Ctrl+1 at a spot you want to come back to.')));
      return;
    }
    const now = app.engine.time;
    for (const m of marks) {
      list.append(
        h(
          `div.mark-row${Math.abs(m.t - now) < 0.05 ? '.cur' : ''}`,
          { dataset: { n: String(m.n) } },
          h('button.mark-n', { title: t('Jump to mark {n}', { n: m.n }), onclick: () => jumpMark(m.n) }, String(m.n)),
          h('button.ghost.mono.mark-t', { title: t('Jump to mark {n}', { n: m.n }), onclick: () => jumpMark(m.n) }, fmtClock(m.t, { ms: true })),
          h('input.grow.mark-name', { type: 'text', value: m.name || '', placeholder: t('Name (optional)'), onchange: (e) => rename(m, e.target.value) }),
          h('button.ghost.icon', { title: t('Move mark {n} to the playhead', { n: m.n }), onclick: () => setMark(m.n) }, icon('flag', 13)),
          h('button.ghost.icon', { title: t('Delete mark {n}', { n: m.n }), onclick: () => app.emit('delete-mark', m.n) }, icon('close', 12)),
        ),
      );
    }
  }
  render();
  const offs = [
    app.store.on('change', (k) => {
      if ((k.has('markers') || k.has('all')) && !(document.activeElement as HTMLElement | null)?.classList.contains('mark-name')) render();
    }),
    app.engine.on('pause', render),
  ];
  return {
    destroy: () => {
      for (const off of offs) off();
    },
  };
}
