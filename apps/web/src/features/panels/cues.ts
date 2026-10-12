import { type Cue, countText, detectLang, errorMessage, newCue, segmentsToCues, speechRate, toJson, toSrt } from '@doblaje/core';
import { STT_MODELS, transcribeProject } from '@doblaje/speech';
import { clear, download, h, icon, t, toast } from '@doblaje/ui';
import { api } from '../../api.ts';
import { app } from '../../app.ts';

const num = (s: string) => {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : NaN;
};
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

type CueInput = Pick<Cue, 'start' | 'end' | 'text'> & Partial<Pick<Cue, 'character' | 'direction'>>;

export function mountCues(root: HTMLElement): { destroy(): void } {
  const list = h('div.cue-list#cue-list');
  const status = h('div.hint#stt-status');
  const model = h('select#stt-model', ...STT_MODELS.map((m) => h('option', { value: m.id, selected: m.id === 'Xenova/whisper-base' }, t(m.label))));
  const lang = h(
    'select#stt-lang',
    ...[
      ['auto', t('Auto-detect')],
      ['english', 'English'],
      ['spanish', 'Español'],
      ['french', 'Français'],
      ['portuguese', 'Português'],
      ['german', 'Deutsch'],
      ['italian', 'Italiano'],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const file = h('input', {
    type: 'file',
    accept: '.srt,.vtt,text/plain',
    hidden: true,
    id: 'sub-file',
    onchange: async () => {
      const f = file.files?.[0];
      if (f) await importSubs(f);
      file.value = '';
    },
  });

  async function importSubs(f: File) {
    try {
      const { cues } = await api.raw<{ cues: CueInput[] }>(`/api/projects/${app.project.id}/import-subs`, f);
      const replace =
        !app.project.cues.length ||
        confirm(t('Replace the {n} existing cues with the {m} imported ones? (Cancel = append)', { n: app.project.cues.length, m: cues.length }));
      setCues(cues, replace, 'Import subtitles');
      toast(t('{n} cues imported', { n: cues.length }), 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  function setCues(cues: CueInput[], replace = true, label = 'Set cues') {
    app.store.commit(
      label,
      (p) => {
        const mapped = cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text, character: c.character || '', direction: c.direction || '' }));
        p.cues = replace ? mapped : [...p.cues, ...mapped].sort((a, b) => a.start - b.start);
      },
      ['cues'],
    );
  }
  async function stt() {
    const btn = root.querySelector<HTMLButtonElement>('#stt-go');
    if (btn) btn.disabled = true;
    status.textContent = t('Starting speech recognition…');
    try {
      const r = await transcribeProject(app.project, {
        model: model.value,
        language: lang.value,
        onProgress: (p) => {
          status.textContent = p.type === 'progress' ? `${t('Downloading model')} ${Math.round(p.pct * 100)}%` : t('Transcribing…');
        },
      });
      if (!r.cues.length) {
        status.textContent = t('No speech found.');
        return;
      }
      setCues(r.cues, !app.project.cues.length || confirm(t('Replace existing cues?')), 'Transcribe');
      status.textContent = t('{n} cues from speech recognition.', { n: r.cues.length });
    } catch (e) {
      status.textContent = errorMessage(e);
      toast(errorMessage(e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async function detect() {
    const { segments } = await api.speechSegments(app.project.id);
    if (!segments.length) {
      toast(t('No speech detected'), 'error');
      return;
    }
    setCues(segmentsToCues(segments), !app.project.cues.length || confirm(t('Replace existing cues with empty speech slots?')), 'Speech slots');
    toast(t('{n} empty cue slots created — fill them in or use the AI tab', { n: segments.length }), 'ok');
  }

  root.append(
    h(
      'div.box',
      h('h4', t('Get dialogue text')),
      h(
        'div.row',
        h('button#sub-import', { onclick: () => file.click() }, icon('file'), t('Import .srt / .vtt')),
        h(
          'button#cue-add',
          {
            onclick: () => {
              const s = app.engine.time;
              const c = newCue({ start: s, end: Math.min(app.engine.duration, s + 2), text: t('New line') });
              app.store.commit(
                'Add cue',
                (p) => {
                  p.cues.push(c);
                  p.cues.sort((a, b) => a.start - b.start);
                },
                ['cues'],
              );
              app.select({ cueId: c.id });
            },
          },
          t('Cue at playhead'),
        ),
      ),
      file,
      h('div.row', model, lang),
      h(
        'div.row',
        h('button.primary#stt-go', { onclick: () => void stt() }, t('Auto-transcribe')),
        h('button#vad-go', { onclick: () => void detect(), title: t('Create empty cue slots where someone is talking') }, t('Speech slots')),
      ),
      status,
    ),
    h(
      'div.row',
      h('button#srt-export', { onclick: () => download(`${app.project.name}.srt`, toSrt(app.project.cues)) }, icon('download'), '.srt'),
      h(
        'button#json-export',
        {
          onclick: () =>
            download(
              `${app.project.name}.json`,
              toJson(app.project.cues, { project: app.project.name, duration: app.project.media?.duration || 0 }),
              'application/json',
            ),
        },
        icon('download'),
        '.json',
      ),
      h('div.spacer'),
      h(
        'button.ghost',
        {
          onclick: () => {
            if (app.project.cues.length && confirm(t('Delete all cues?')))
              app.store.commit(
                'Clear cues',
                (p) => {
                  p.cues = [];
                },
                ['cues'],
              );
          },
        },
        icon('trash'),
        t('Clear'),
      ),
    ),
    list,
  );

  let activeId: string | null = null;
  function render() {
    const keep = document.activeElement?.closest<HTMLElement>('.cue')?.dataset.id;
    clear(list);
    const cues = app.project.cues;
    if (!cues.length) list.append(h('div.hint', t('No cues yet. Import subtitles, auto-transcribe, or double-click the cue lane in the timeline.')));
    for (const c of cues) {
      const lg = detectLang(c.text || '');
      const syl = countText(c.text || '', lg);
      const rate = speechRate(c, lg);
      const ta = h('textarea', {
        value: c.text,
        rows: 2,
        placeholder: t('Dialogue…'),
        oninput: (e) => {
          app.store.commit(
            'Edit cue text',
            () => {
              c.text = e.target.value;
            },
            ['cues'],
            { merge: true },
          );
          updSyl();
        },
        onfocus: () => app.select({ cueId: c.id }),
      });
      const sylEl = h(
        `span.syl${rate > 9 ? '.bad' : rate > 7 ? '.off' : ''}`,
        { title: t('syllables · syllables per second (above ~7/s is hard to say)') },
        `${syl} syl · ${rate.toFixed(1)}/s`,
      );
      const updSyl = () => {
        const l = detectLang(c.text || '');
        const r = speechRate(c, l);
        sylEl.textContent = `${countText(c.text || '', l)} syl · ${r.toFixed(1)}/s`;
        sylEl.className = `syl${r > 9 ? ' bad' : r > 7 ? ' off' : ''}`;
      };
      const time = (k: 'start' | 'end') =>
        h('input.mono', {
          value: fmt(c[k]),
          onchange: (e) => {
            const v = num(e.target.value);
            if (Number.isFinite(v))
              app.store.commit('Edit cue time', () => {
                c[k] = Math.max(0, Math.min(app.engine.duration, v));
                if (c.end <= c.start) c.end = c.start + 0.2;
              }, ['cues']);
            else e.target.value = fmt(c[k]);
          },
        });
      const el = h(
        `div.cue${app.sel.cueId === c.id ? '.sel' : ''}`,
        { dataset: { id: c.id }, onclick: () => app.select({ cueId: c.id }) },
        h(
          'div.meta',
          time('start'),
          '→',
          time('end'),
          h('input.who', {
            value: c.character || '',
            placeholder: t('Character'),
            onchange: (e) =>
              app.store.commit('Edit cue character', () => {
                c.character = e.target.value;
              }, ['cues']),
          }),
          sylEl,
        ),
        ta,
        h(
          'div.row',
          h(
            'button.icon',
            {
              title: t('Go to cue'),
              onclick: (e) => {
                e.stopPropagation();
                app.engine.seek(c.start);
              },
            },
            icon('start', 13),
          ),
          h(
            'button.icon',
            {
              title: t('Play this cue'),
              onclick: (e) => {
                e.stopPropagation();
                void app.engine.playRange(Math.max(0, c.start - 0.5), c.end + 0.3);
              },
            },
            icon('play', 13),
          ),
          h(
            'button.icon.rec-cue',
            {
              title: t('Record this cue (punch)'),
              onclick: (e) => {
                e.stopPropagation();
                app.select({ cueId: c.id });
                app.emit('record-cue', c);
              },
            },
            icon('mic', 13),
          ),
          h(
            'button.icon',
            {
              title: t('Loop-record this cue until you nail it'),
              onclick: (e) => {
                e.stopPropagation();
                app.select({ cueId: c.id });
                app.emit('record-cue', c, true);
              },
            },
            icon('loop', 13),
          ),
          h('div.spacer'),
          h(
            'button.ghost',
            {
              title: t('Delete'),
              onclick: (e) => {
                e.stopPropagation();
                app.store.commit(
                  'Delete cue',
                  (p) => {
                    p.cues = p.cues.filter((x) => x.id !== c.id);
                  },
                  ['cues'],
                );
              },
            },
            icon('close', 12),
          ),
        ),
      );
      list.append(el);
    }
    if (keep) list.querySelector<HTMLTextAreaElement>(`.cue[data-id="${keep}"] textarea`)?.focus();
  }
  render();
  const offs = [
    app.store.on('change', (k) => {
      if (k.has('cues') || k.has('all')) {
        if (document.activeElement?.tagName === 'TEXTAREA' && k.has('cues') && !k.has('all')) return;
        render();
      }
    }),
    app.on('selection', () => {
      for (const e of list.querySelectorAll<HTMLElement>('.cue')) e.classList.toggle('sel', e.dataset.id === app.sel.cueId);
    }),
    app.on('focus-cue', (id: string) => setTimeout(() => list.querySelector<HTMLTextAreaElement>(`.cue[data-id="${id}"] textarea`)?.focus(), 50)),
    app.engine.on('time', (tm) => {
      const a = app.project.cues.find((c) => tm >= c.start && tm < c.end)?.id || null;
      if (a !== activeId) {
        activeId = a;
        for (const e of list.querySelectorAll<HTMLElement>('.cue')) e.classList.toggle('active', e.dataset.id === a);
        if (a && app.engine.playing) list.querySelector(`.cue[data-id="${a}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    }),
  ];
  return {
    destroy: () => {
      for (const off of offs) off();
    },
  };
}
