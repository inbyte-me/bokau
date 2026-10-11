import { h, clear, toast, fmtClock } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

export function mountLibrary(root, { go }) {
  clear(root);
  const body = h('div');
  const page = h('div.library',
    h('div.hero', h('div.grow', h('h1', t('Your projects')), h('div.dim', t('Projects and recordings are stored on this computer.'))),
      h('button.primary', { onclick: () => newProjectModal({ go }), id: 'new-project' }, icon('plus'), t('New project'))), body);
  root.append(page);
  refresh();
  async function refresh() {
    let items = [];
    try { items = await api.projects(); } catch (e) { toast(e.message, 'error'); }
    clear(body);
    if (!items.length) { body.append(h('div.empty', { id: 'empty' }, t('No projects. Choose New project, then pick a video file.'))); return; }
    const rows = items.map((p) => h('tr.card', { tabIndex: 0, dataset: { id: p.id }, onclick: () => go(`/p/${p.id}`), onkeydown: (e) => e.key === 'Enter' && go(`/p/${p.id}`) },
      h('td', h('span.thumb', { style: p.poster ? { backgroundImage: `url(${p.poster})` } : {} })),
      h('td', h('div.name', p.name), h('div.badge', p.mode === 'party' ? t('Party') : t('Pro'))),
      h('td.num', fmtClock(p.duration)), h('td.num', `${p.cues}`), h('td.num', `${p.takes}`), h('td.num', new Date(p.updatedAt).toLocaleDateString()),
      h('td', h('button.del.ghost.icon', { title: t('Delete'), onclick: async (e) => { e.stopPropagation(); if (confirm(t('Delete this project and its recordings?'))) { await api.deleteProject(p.id); mountLibrary(root, { go }); } } }, icon('trash')))));
    body.append(h('table.plist', h('thead', h('tr', h('th', ''), h('th', t('Name')), h('th', { style: { textAlign: 'right' } }, t('Length')), h('th', { style: { textAlign: 'right' } }, t('Cues')), h('th', { style: { textAlign: 'right' } }, t('Takes')), h('th', { style: { textAlign: 'right' } }, t('Modified')), h('th', ''))), h('tbody', rows)));
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
  const setFile = (f) => { file = f; if (f) { dropLabel.textContent = `${f.name} · ${(f.size / 1e6).toFixed(1)} MB`; if (!name.value) name.value = f.name.replace(/\.[^.]+$/, ''); } };
  fileInput.onchange = () => setFile(fileInput.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); };
  const modeBtn = (m, title, desc) => { const b = h('button.mode', { type: 'button', dataset: { mode: m }, onclick: () => { mode = m; [...modes.children].forEach((c) => c.classList.toggle('sel', c.dataset.mode === m)); } }, h('h3', title), h('p', desc)); if (m === mode) b.classList.add('sel'); return b; };
  const modes = h('div.modes', modeBtn('pro', t('Pro Dub Studio'), t('Timeline, rhythm band, lip-sync markers, ghost guide and translation. For practicing real dubbing.')), modeBtn('party', t('Parody & Party'), t('Bad lip reading, telenovela, blind dubbing and genre swap. Made for the living-room TV.')));
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
  back.append(h('div.modal', h('h2', t('New project')), h('div.col', h('div.field', h('label', t('Name')), name), h('div.lab', t('Mode')), modes, drop, fileInput, prog, status),
    h('div.actions', h('button', { onclick: close }, t('Cancel')), go_)));
  document.body.append(back); name.focus();
  return { close, back };
}
