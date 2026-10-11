import { h, clear, toast, fmtClock } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';

export function mountLibrary(root, { go }) {
  clear(root);
  const list = h('div.grid');
  const page = h('div.library',
    h('div.hero', h('div.grow', h('h1', t('Your projects')), h('div.dim', t('Dub a clip, make a parody, or play a party game with friends.'))),
      h('button.primary.big-btn', { onclick: () => newProjectModal({ go }), id: 'new-project' }, '＋ ' + t('New project'))),
    list);
  root.append(page);
  refresh();
  async function refresh() {
    let items = [];
    try { items = await api.projects(); } catch (e) { toast(e.message, 'error'); }
    clear(list);
    if (!items.length) { list.replaceWith(h('div.empty', { id: 'empty' }, t('No projects yet — create one and drop in a video clip.'))); return; }
    for (const p of items) {
      list.append(h('div.card', { onclick: () => go(`/p/${p.id}`), dataset: { id: p.id } },
        h('div.poster', { style: p.poster ? { backgroundImage: `url(${p.poster})` } : {} }, p.poster ? '' : '…'),
        h('div.meta', h('div.name', p.name), h('div.row.small.dim', h('span.badge.' + p.mode, p.mode === 'party' ? t('Party') : t('Pro')), h('span', fmtClock(p.duration)), h('span', `${p.cues} ${t('cues')}`), h('span', `${p.takes} ${t('takes')}`))),
        h('button.del.icon', { title: t('Delete'), onclick: async (e) => { e.stopPropagation(); if (confirm(t('Delete this project and its recordings?'))) { await api.deleteProject(p.id); mountLibrary(root, { go }); } } }, '🗑')));
    }
  }
}

export function newProjectModal({ go }) {
  let mode = 'pro'; let file = null;
  const back = h('div.modal-back', { onclick: (e) => e.target === back && close() });
  const close = () => back.remove();
  const name = h('input', { type: 'text', placeholder: t('Project name'), id: 'np-name' });
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mkv,.mov,.webm,audio/*', hidden: true, id: 'np-file' });
  const dropLabel = h('div', t('Drop a video here or click to choose (.mp4 .webm .mov .mkv)'));
  const drop = h('div.drop', { onclick: () => fileInput.click(), id: 'np-drop' }, dropLabel);
  const setFile = (f) => { file = f; if (f) { dropLabel.textContent = `🎞 ${f.name} (${(f.size / 1e6).toFixed(1)} MB)`; if (!name.value) name.value = f.name.replace(/\.[^.]+$/, ''); } };
  fileInput.onchange = () => setFile(fileInput.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
  const modeBtn = (m, em, title, desc) => { const b = h('button.mode', { type: 'button', dataset: { mode: m }, onclick: () => { mode = m; [...modes.children].forEach((c) => c.classList.toggle('sel', c.dataset.mode === m)); } }, h('div.big', em), h('h3', title), h('p', desc)); if (m === mode) b.classList.add('sel'); return b; };
  const modes = h('div.modes', modeBtn('pro', '🎬', t('Pro Dub Studio'), t('Timeline, rhythm band, lip-sync markers, ghost guide and translation. For practicing real dubbing.')), modeBtn('party', '🎉', t('Parody & Party'), t('Bad lip reading, telenovela, blind dubbing and genre swap. Made for the living-room TV.')));
  const status = h('div.small.dim'); const bar = h('i'); const prog = h('div.progress.hidden', bar);
  const go_ = h('button.primary', { id: 'np-create', onclick: async () => {
    if (!file) return toast(t('Choose a video first'), 'error');
    go_.disabled = true; prog.classList.remove('hidden');
    try {
      const proj = await api.createProject(name.value || file.name, mode);
      status.textContent = t('Uploading…');
      const job = await api.uploadSource(proj.id, file, (f) => { bar.style.width = `${f * 40}%`; });
      status.textContent = t('Preparing proxy video, audio and thumbnails…');
      await api.waitJob(job, (j) => { bar.style.width = `${40 + j.progress * 60}%`; status.textContent = `${t('Preparing')}: ${j.message || ''}`; });
      close(); go(`/p/${proj.id}`);
    } catch (e) { toast(e.message, 'error'); status.textContent = e.message; go_.disabled = false; }
  } }, t('Create'));
  back.append(h('div.modal', h('h2', t('New project')), h('div.col', h('div.field', h('label', t('Name')), name), h('label.small.dim', t('Mode')), modes, drop, fileInput, prog, status),
    h('div.actions', h('button', { onclick: close }, t('Cancel')), go_)));
  document.body.append(back); name.focus();
  return { close, back };
}
