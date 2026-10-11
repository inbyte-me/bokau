import { h, clear, toast, fmtBytes } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { api } from '../api.js';
import { renderAndUpload } from '../audio/render.js';

/** Export dialog: renders the mix in the browser (same graph as preview), uploads it, server muxes. */
export function exportDialog() {
  const p = app.project; const m = p.media; let profile = 'quick';
  const back = h('div.modal-back', { onclick: (e) => e.target === back && !busy && close() }); const close = () => back.remove(); let busy = false;
  const opt = {}; const row = (label, el) => h('div.field', h('label', label), el);
  const chk = (id, label, checked = false) => { opt[id] = h('input', { id, type: 'checkbox', checked }); return h('label.row.small', opt[id], label); };
  opt.format = h('select#ex-format', h('option', { value: 'mp4' }, 'MP4 (H.264 + AAC)'), h('option', { value: 'webm' }, 'WebM (VP9 + Opus)'));
  opt.target = h('select#ex-target', h('option', { value: 0 }, t('Best quality')), h('option', { value: 8 }, '≈ 8 MB'), h('option', { value: 10 }, '≈ 10 MB (Discord free)'), h('option', { value: 16 }, '≈ 16 MB (WhatsApp)'), h('option', { value: 25 }, '≈ 25 MB'));
  opt.wm = h('input#ex-wm', { type: 'text', placeholder: t('Watermark text (optional)') });
  opt.wmPos = h('select#ex-wmpos', ...[['br', '↘'], ['bl', '↙'], ['tr', '↗'], ['tl', '↖']].map(([v, l]) => h('option', { value: v }, l)));
  opt.focus = h('input#ex-focus', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.5 });
  const chkSubs = chk('ex-subs', t('Burn subtitles into the picture'), false), chkVert = chk('ex-vert', t('Vertical 9:16 (Reels / TikTok / Shorts)'), false), chkLoud = chk('ex-loud', t('Normalize loudness (−16 LUFS)'), false);
  const profBtn = (id, em, title, desc) => h('button.mode' + (id === profile ? '.sel' : ''), { dataset: { profile: id }, type: 'button', onclick: () => { profile = id; [...profiles.children].forEach((c) => c.classList.toggle('sel', c.dataset.profile === id)); sync(); } }, h('div.big', em), h('h3', title), h('p', desc));
  const profiles = h('div.modes', profBtn('quick', '', t('Quick share'), t('Small H.264/AAC (or WebM) for Discord, WhatsApp, chat.')), profBtn('archive', '', t('Studio archive'), t('Mixed video + separate WAV stems: music/SFX, voice dry, voice wet. Plus .srt and .json.')));
  const plan = h('div.hint#ex-plan'); const progress = h('div.progress.hidden', h('i')); const msg = h('div.small.dim#ex-msg'); const results = h('div.col#ex-results');
  const sync = async () => {
    const o = options(); const needsRender = o.burnSubs || o.watermark || o.vertical;
    plan.textContent = !m.hasVideo ? '' : needsRender ? t('Full render: video is re-encoded (slower).') : t('Fast export: the original video stream is copied untouched, only the new audio is added — near instant.');
    opt.format.disabled = !needsRender && m.hasVideo; opt.target.disabled = !needsRender && m.hasVideo; if (!needsRender && m.hasVideo) opt.target.value = 0;
  };
  const options = () => ({ profile, format: opt.format.value, burnSubs: opt['ex-subs'].checked && p.cues.length > 0, watermark: opt.wm.value.trim() ? { text: opt.wm.value.trim(), pos: opt.wmPos.value } : null, vertical: opt['ex-vert'].checked ? { enabled: true, focusX: +opt.focus.value } : null, targetMb: +opt.target.value || 0, loudnorm: opt['ex-loud'].checked, maxHeight: opt['ex-vert'].checked ? 1920 : 1080 });
  for (const el of [opt['ex-subs'], opt['ex-vert'], opt['ex-loud'], opt.wm, opt.format, opt.target]) el.addEventListener('input', sync);
  const bar = progress.firstChild; const setP = (f, text) => { bar.style.width = `${Math.round(f * 100)}%`; msg.textContent = text; };
  const go = h('button.primary#ex-go', { onclick: async () => {
    busy = true; go.disabled = true; progress.classList.remove('hidden'); clear(results);
    try {
      setP(0.02, t('Saving project and uploading takes…')); await app.session.flushUploads(); await app.store.flush();
      await app.engine.assets.ensureTakes(app.project);
      const kinds = profile === 'archive' ? ['mix', 'bg', 'dry', 'wet'] : ['mix'];
      await renderAndUpload(app.project, app.engine.assets, kinds, { onStep: (k, f) => { const i = kinds.indexOf(k); setP(0.05 + ((i + f) / kinds.length) * 0.45, `${t('Rendering')} ${k}…`); } });
      setP(0.55, t('Muxing video…'));
      const { job } = await api.post(`/api/projects/${p.id}/export`, options());
      const res = await api.waitJob(job, (j) => setP(0.55 + j.progress * 0.45, `${t('Encoding')} ${Math.round(j.progress * 100)}%`));
      setP(1, t('Done'));
      for (const f of res.files) results.append(h('a.take', { href: `/media/${p.id}/exports/${res.dir}/${f}`, download: f, dataset: { file: f } }, h('div.grow', f), h('span.small.dim', fmtBytes(res.sizes[f])), h('span', icon('download'))));
      results.append(h('div.hint', `${res.plan.fast ? t('stream copy') : t('re-encoded')} · ${t('saved in')} data/projects/${p.id}/exports/${res.dir}`));
    } catch (e) { setP(0, ''); toast(e.message, 'error'); msg.textContent = e.message; } finally { busy = false; go.disabled = false; }
  } }, t('Export'));
  back.append(h('div.modal', h('h2', t('Export')), profiles, plan,
    h('div.fields', row(t('Format'), opt.format), row(t('Target size'), opt.target)),
    h('div.col', chkSubs, chkVert, row(t('Crop focus (left ↔ right)'), opt.focus), h('div.row', opt.wm, opt.wmPos), chkLoud),
    progress, msg, results, h('div.actions', h('button', { onclick: () => !busy && close() }, t('Close')), go)));
  document.body.append(back); sync();
  return { close };
}
