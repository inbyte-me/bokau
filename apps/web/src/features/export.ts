import { renderAndUpload, type StemKind } from '@doblaje/audio';
import { errorMessage } from '@doblaje/core';
import { clear, fmtBytes, h, icon, t, toast } from '@doblaje/ui';
import { api } from '../api.ts';
import { app } from '../app.ts';

type Profile = 'quick' | 'archive';
interface ExportResult {
  dir: string;
  files: string[];
  sizes: Record<string, number>;
  plan: { fast: boolean; container: string };
}

/** Export dialog: renders the mix in the browser (same graph as preview), uploads it, the server muxes. */
export function exportDialog(): { close: () => void } {
  const p = app.project;
  const hasVideo = !!p.media?.hasVideo;
  let profile: Profile = 'quick';
  let busy = false;
  const back: HTMLElement = h('div.modal-back', {
    onclick: (e) => {
      if (e.target === back && !busy) close();
    },
  });
  const close = () => back.remove();
  const row = (label: string, el: HTMLElement) => h('div.field', h('label', label), el);
  const check = (id: string, label: string) => {
    const input = h('input', { id, type: 'checkbox', checked: false });
    return { input, el: h('label.row.small', input, label) };
  };

  const format = h('select#ex-format', h('option', { value: 'mp4' }, 'MP4 (H.264 + AAC)'), h('option', { value: 'webm' }, 'WebM (VP9 + Opus)'));
  const target = h(
    'select#ex-target',
    h('option', { value: '0' }, t('Best quality')),
    h('option', { value: '8' }, '≈ 8 MB'),
    h('option', { value: '10' }, '≈ 10 MB (Discord free)'),
    h('option', { value: '16' }, '≈ 16 MB (WhatsApp)'),
    h('option', { value: '25' }, '≈ 25 MB'),
  );
  const wm = h('input#ex-wm', { type: 'text', placeholder: t('Watermark text (optional)') });
  const wmPos = h(
    'select#ex-wmpos',
    ...[
      ['br', '↘'],
      ['bl', '↙'],
      ['tr', '↗'],
      ['tl', '↖'],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const focus = h('input#ex-focus', { type: 'range', min: '0', max: '1', step: '0.01', value: '0.5' });
  const subs = check('ex-subs', t('Burn subtitles into the picture'));
  const vert = check('ex-vert', t('Vertical 9:16 (Reels / TikTok / Shorts)'));
  const loud = check('ex-loud', t('Normalize loudness (−16 LUFS)'));

  const profBtn = (id: Profile, title: string, desc: string) =>
    h(
      `button.mode${id === profile ? '.sel' : ''}`,
      {
        dataset: { profile: id },
        type: 'button',
        onclick: () => {
          profile = id;
          for (const c of profiles.querySelectorAll<HTMLElement>('.mode')) c.classList.toggle('sel', c.dataset.profile === id);
          sync();
        },
      },
      h('h3', title),
      h('p', desc),
    );
  const profiles = h(
    'div.modes',
    profBtn('quick', t('Quick share'), t('Small H.264/AAC (or WebM) for Discord, WhatsApp, chat.')),
    profBtn('archive', t('Studio archive'), t('Mixed video + separate WAV stems: music/SFX, voice dry, voice wet. Plus .srt and .json.')),
  );
  const plan = h('div.hint#ex-plan');
  const bar = h('i');
  const progress = h('div.progress.hidden', bar);
  const msg = h('div.small.dim#ex-msg');
  const results = h('div.col#ex-results');

  const options = () => ({
    profile,
    format: format.value,
    burnSubs: subs.input.checked && p.cues.length > 0,
    watermark: wm.value.trim() ? { text: wm.value.trim(), pos: wmPos.value } : null,
    vertical: vert.input.checked ? { enabled: true, focusX: Number(focus.value) } : null,
    targetMb: Number(target.value) || 0,
    loudnorm: loud.input.checked,
    maxHeight: vert.input.checked ? 1920 : 1080,
  });
  const sync = () => {
    const o = options();
    const needsRender = o.burnSubs || !!o.watermark || !!o.vertical;
    plan.textContent = !hasVideo
      ? ''
      : needsRender
        ? t('Full render: video is re-encoded (slower).')
        : t('Fast export: the original video stream is copied untouched, only the new audio is added — near instant.');
    format.disabled = !needsRender && hasVideo;
    target.disabled = !needsRender && hasVideo;
    if (!needsRender && hasVideo) target.value = '0';
  };
  for (const el of [subs.input, vert.input, loud.input, wm, format, target]) el.addEventListener('input', sync);
  const setP = (f: number, text: string) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    msg.textContent = text;
  };

  const run = async () => {
    busy = true;
    go.disabled = true;
    progress.classList.remove('hidden');
    clear(results);
    try {
      setP(0.02, t('Saving project and uploading takes…'));
      await app.session.flushUploads();
      await app.store.flush();
      const assets = app.engine.assets;
      if (!assets) throw new Error('audio not loaded');
      await assets.ensureTakes(app.project);
      const kinds: StemKind[] = profile === 'archive' ? ['mix', 'bg', 'dry', 'wet'] : ['mix'];
      await renderAndUpload(app.project, assets, kinds, {
        onStep: (k, f) => setP(0.05 + ((kinds.indexOf(k) + f) / kinds.length) * 0.45, `${t('Rendering')} ${k}…`),
      });
      setP(0.55, t('Muxing video…'));
      const { job } = await api.startJob(`/api/projects/${p.id}/export`, options());
      const res = await api.waitJob<ExportResult>(job, (j) => setP(0.55 + j.progress * 0.45, `${t('Encoding')} ${Math.round(j.progress * 100)}%`));
      setP(1, t('Done'));
      for (const f of res.files) {
        results.append(
          h(
            'a.take',
            { href: `/media/${p.id}/exports/${res.dir}/${f}`, download: f, dataset: { file: f } },
            h('div.grow', f),
            h('span.small.dim', fmtBytes(res.sizes[f])),
            h('span', icon('download')),
          ),
        );
      }
      results.append(h('div.hint', `${res.plan.fast ? t('stream copy') : t('re-encoded')} · ${t('saved in')} data/projects/${p.id}/exports/${res.dir}`));
    } catch (e) {
      setP(0, '');
      toast(errorMessage(e), 'error');
      msg.textContent = errorMessage(e);
    } finally {
      busy = false;
      go.disabled = false;
    }
  };
  const go = h('button.primary#ex-go', { onclick: () => void run() }, t('Export'));
  back.append(
    h(
      'div.modal',
      h('h2', t('Export')),
      profiles,
      plan,
      h('div.fields', row(t('Format'), format), row(t('Target size'), target)),
      h('div.col', subs.el, vert.el, row(t('Crop focus (left ↔ right)'), focus), h('div.row', wm, wmPos), loud.el),
      progress,
      msg,
      results,
      h(
        'div.actions',
        h(
          'button',
          {
            onclick: () => {
              if (!busy) close();
            },
          },
          t('Close'),
        ),
        go,
      ),
    ),
  );
  document.body.append(back);
  sync();
  return { close };
}
