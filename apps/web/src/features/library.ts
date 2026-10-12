import type { Mode, ProjectSummary } from '@doblaje/core';
import { clear, fmtClock, h, icon, registerMenu, t, toast } from '@doblaje/ui';
import { api } from '../api.ts';
import { requestPrepare } from './prepare.ts';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Go = { go: (path: string) => void };
// Right-click on a project row: open it, or delete it (registered once; rows exist only on this screen).
registerMenu('tr.card[data-id]', (el) => {
  const id = (el as HTMLElement).dataset.id as string;
  return [
    {
      label: t('Open'),
      icon: 'file',
      run: () => {
        location.hash = `#/p/${id}`;
      },
    },
    { label: t('Delete project'), icon: 'trash', danger: true, run: () => (el.querySelector('button.del') as HTMLButtonElement | null)?.click() },
  ];
});
// Right-click on a library clip: prepare it, or start a project from it.
registerMenu('tr.clip[data-id]', (el) => {
  const id = (el as HTMLElement).dataset.id as string;
  const go = (path: string) => {
    location.hash = `#${path}`;
  };
  return [
    { label: t('Prepare this clip'), icon: 'sliders', run: () => go(`/p/${id}`) },
    'separator',
    { label: t('New dubbing project from this clip'), icon: 'mic', run: () => void deriveAndOpen(id, 'pro', go) },
    { label: t('New party project from this clip'), icon: 'tv', run: () => void deriveAndOpen(id, 'party', go) },
    { label: t('New podcast project from this clip'), icon: 'wave', run: () => void deriveAndOpen(id, 'podcast', go) },
    { label: t('Delete clip'), icon: 'trash', danger: true, run: () => (el.querySelector('button.del') as HTMLButtonElement | null)?.click() },
  ];
});

const modeLabel = (m: Mode) => (m === 'party' ? t('Party') : m === 'podcast' ? t('Podcast') : t('Dub'));

export function mountLibrary(root: HTMLElement, { go }: Go): void {
  clear(root);
  const clipsBody = h('div#clips');
  const projectsBody = h('div#projects');
  const page = h(
    'div.library',
    h(
      'div.hero',
      h('div.grow', h('h1', t('Library')), h('div.dim', t('Clips and projects are stored on this computer.'))),
      h('button.signal#party-pick', { onclick: () => go('/party') }, icon('tv'), t('Party: pick a clip')),
      h('button#add-clip', { onclick: () => newProjectModal({ go, template: true }) }, icon('plus'), t('Add clip')),
      h('button.primary', { onclick: () => newProjectModal({ go }), id: 'new-project' }, icon('plus'), t('New project')),
    ),
    h(
      'section.lib-section',
      h('h2', t('Clip library')),
      h('div.hint', t('Prepare a clip once (dialogue, subtitles, characters), then start as many dubbing, party or podcast projects from it as you like.')),
      clipsBody,
    ),
    h('section.lib-section', h('h2', t('Projects')), projectsBody),
  );
  root.append(page);
  void refresh();

  const del = (item: ProjectSummary, msg: string) =>
    h(
      'button.del.ghost.icon',
      {
        title: t('Delete'),
        onclick: async (e) => {
          e.stopPropagation();
          if (confirm(msg)) {
            await api.deleteProject(item.id);
            mountLibrary(root, { go });
          }
        },
      },
      icon('trash'),
    );
  const head = (...cols: [string, boolean?][]) =>
    h('thead', h('tr', ...cols.map(([label, right]) => h('th', right ? { style: { textAlign: 'right' } } : {}, label))));

  async function refresh() {
    let items: ProjectSummary[] = [];
    try {
      items = await api.projects();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
    const clips = items.filter((p) => p.template);
    const projects = items.filter((p) => !p.template);
    const clipName = new Map(clips.map((c) => [c.id, c.name]));
    clear(clipsBody);
    clear(projectsBody);

    if (!clips.length)
      clipsBody.append(h('div.empty#no-clips', t('No clips yet. Add a funny video or a movie scene, prepare it once, and play it as often as you like.')));
    else
      clipsBody.append(
        h(
          'table.plist.clips',
          head(['', false], [t('Clip'), false], [t('Length'), true], [t('Lines'), true], [t('Start a project'), false], ['', false]),
          h(
            'tbody',
            clips.map((c) =>
              h(
                'tr.card.clip',
                { tabIndex: 0, dataset: { id: c.id }, onclick: () => go(`/p/${c.id}`), onkeydown: (e) => e.key === 'Enter' && go(`/p/${c.id}`) },
                h('td', h('span.thumb', { style: c.poster ? { backgroundImage: `url(${c.poster})` } : {} })),
                h(
                  'td',
                  h('div.name', c.name),
                  c.characters.length
                    ? h('div.characters', ...c.characters.map((n) => h('span.chip', n)))
                    : h('div.small.dim', c.ready ? t('Not prepared yet: open it and press Prepare all') : t('Importing…')),
                ),
                h('td.num', fmtClock(c.duration)),
                h('td.num', `${c.cues}`),
                h(
                  'td.derive',
                  ...(['pro', 'party', 'podcast'] as Mode[]).map((m) =>
                    h(
                      `button.small.derive-${m}`,
                      {
                        disabled: !c.ready,
                        title: t('New {mode} project from this clip', { mode: modeLabel(m) }),
                        onclick: (e) => {
                          e.stopPropagation();
                          void deriveAndOpen(c.id, m, go);
                        },
                      },
                      modeLabel(m),
                    ),
                  ),
                ),
                h('td', del(c, t('Delete this clip? Projects made from it keep working.'))),
              ),
            ),
          ),
        ),
      );

    if (!projects.length) projectsBody.append(h('div.empty', { id: 'empty' }, t('No projects. Choose New project, then pick a video file.')));
    else
      projectsBody.append(
        h(
          'table.plist',
          head(['', false], [t('Name'), false], [t('Length'), true], [t('Cues'), true], [t('Takes'), true], [t('Modified'), true], ['', false]),
          h(
            'tbody',
            projects.map((p) =>
              h(
                'tr.card',
                { tabIndex: 0, dataset: { id: p.id }, onclick: () => go(`/p/${p.id}`), onkeydown: (e) => e.key === 'Enter' && go(`/p/${p.id}`) },
                h('td', h('span.thumb', { style: p.poster ? { backgroundImage: `url(${p.poster})` } : {} })),
                h(
                  'td',
                  h('div.name', p.name),
                  h('div.badge', modeLabel(p.mode)),
                  p.sourceTemplateId ? h('span.small.dim.from-clip', ` ${t('from')} ${clipName.get(p.sourceTemplateId) || t('a deleted clip')}`) : null,
                ),
                h('td.num', fmtClock(p.duration)),
                h('td.num', `${p.cues}`),
                h('td.num', `${p.takes}`),
                h('td.num', new Date(p.updatedAt).toLocaleDateString()),
                h('td', del(p, t('Delete this project and its recordings?'))),
              ),
            ),
          ),
        ),
      );
  }
}

/** Start a project of `mode` from a library clip and open it. */
export async function deriveAndOpen(clipId: string, mode: Mode, go: (path: string) => void): Promise<void> {
  try {
    const p = await api.derive(clipId, mode);
    go(`/p/${p.id}`);
  } catch (e) {
    toast(errMsg(e), 'error');
  }
}

export function newProjectModal({ go, template = false }: Go & { template?: boolean }): { close: () => void; back: HTMLElement } {
  let mode: Mode = 'pro';
  let file: File | null = null;
  const back: HTMLElement = h('div.modal-back', { onclick: (e) => e.target === back && close() });
  const close = () => back.remove();
  const name = h('input', { type: 'text', placeholder: t('Project name'), id: 'np-name' });
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mkv,.mov,.webm,audio/*', hidden: true, id: 'np-file' });
  const dropLabel = h('div', t('Drop a video here or click to choose (.mp4 .webm .mov .mkv)'));
  const drop = h('div.drop', { onclick: () => fileInput.click(), id: 'np-drop' }, dropLabel);
  const setFile = (f: File | null | undefined) => {
    if (!f) return;
    file = f;
    dropLabel.textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`;
    if (!name.value) name.value = f.name.replace(/\.[^.]+$/, '');
  };
  fileInput.onchange = () => setFile(fileInput.files?.[0]);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    setFile(e.dataTransfer?.files[0]);
  };
  const modeBtn = (m: Mode, title: string, desc: string) => {
    const b = h(
      'button.mode',
      {
        type: 'button',
        dataset: { mode: m },
        onclick: () => {
          mode = m;
          for (const c of modes.querySelectorAll<HTMLElement>('.mode')) c.classList.toggle('sel', c.dataset.mode === m);
          prepRow.classList.toggle('hidden', m !== 'pro');
          dropLabel.textContent = file
            ? dropLabel.textContent
            : m === 'podcast'
              ? t('Optional: drop an existing recording here, or leave empty and record in the next step')
              : t('Drop a video here or click to choose (.mp4 .webm .mov .mkv)');
        },
      },
      h('h3', title),
      h('p', desc),
    );
    if (m === mode) b.classList.add('sel');
    return b;
  };
  const modes = h(
    'div.modes',
    modeBtn('pro', t('Pro Dub Studio'), t('Timeline, rhythm band, lip-sync markers, ghost guide and translation. For practicing real dubbing.')),
    modeBtn('party', t('Parody & Party'), t('Bad lip reading, telenovela, blind dubbing and genre swap. Made for the living-room TV.')),
    modeBtn('podcast', t('Podcast'), t('Record audio and video with your camera and microphone, then trim, add chapters, clean up the voice and export.')),
  );
  // dubbing: prepare right after import (separate dialogue → subtitles → speakers), like transcribe-on-import tools
  const prepOn = h('input#np-prepare', { type: 'checkbox', checked: true });
  const prepLang = h(
    'select#np-lang',
    { title: t('Language of the dialogue') },
    ...[
      ['auto', t('Auto-detect')],
      ['spanish', 'Español'],
      ['english', 'English'],
      ['french', 'Français'],
      ['portuguese', 'Português'],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const prepRow = h('div.row', h('label.row.small', prepOn, t('Prepare automatically: separate dialogue, subtitles and speakers')), prepLang);
  const status = h('div.small.dim');
  const bar = h('i');
  const prog = h('div.progress.hidden', bar);
  const go_ = h(
    'button.primary',
    {
      id: 'np-create',
      onclick: async () => {
        if (!file && mode !== 'podcast') return toast(t('Choose a video first'), 'error');
        go_.disabled = true;
        prog.classList.remove('hidden');
        try {
          const proj = await api.createProject(
            name.value || (file ? file.name : `${t('Podcast')} ${new Date().toLocaleDateString()}`),
            template ? 'pro' : mode,
            { template },
          );
          if (!file) {
            close();
            go(`/p/${proj.id}`);
            return;
          }
          status.textContent = t('Uploading…');
          const job = await api.uploadSource(proj.id, file, (f: number) => {
            bar.style.width = `${f * 40}%`;
          });
          if ((template || mode === 'pro') && prepOn.checked) requestPrepare(proj.id, prepLang.value);
          status.textContent = t('Preparing proxy video, audio and thumbnails…');
          await api.waitJob(job, (j) => {
            bar.style.width = `${40 + j.progress * 60}%`;
            status.textContent = `${t('Preparing')}: ${j.message || ''}`;
          });
          close();
          go(`/p/${proj.id}`);
        } catch (e) {
          toast(errMsg(e), 'error');
          status.textContent = errMsg(e);
          go_.disabled = false;
        }
      },
    },
    t('Create'),
  );
  back.append(
    h(
      'div.modal',
      h('h2', template ? t('Add a clip to the library') : t('New project')),
      template ? h('div.hint', t('A clip is prepared once (dialogue, subtitles, characters). Recordings happen in projects you start from it.')) : null,
      h(
        'div.col',
        h('div.field', h('label', t('Name')), name),
        template ? null : h('div.lab', t('Mode')),
        template ? null : modes,
        drop,
        prepRow,
        fileInput,
        prog,
        status,
      ),
      h('div.actions', h('button', { onclick: close }, t('Cancel')), go_),
    ),
  );
  document.body.append(back);
  name.focus();
  return { close, back };
}
