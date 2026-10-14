<!-- Export: renders the mix in the browser (the same graph as the preview), uploads it, the server muxes it with the
     picture. Quick share (one small file) or studio archive (video + stems + subtitles). -->
<script lang="ts">
  import { renderAndUpload, type StemKind } from '@doblaje/audio';
  import { errorMessage } from '@doblaje/core';
  import { fmtBytes, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import Modal from '@doblaje/ui/components/Modal.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../api.ts';
  import { app } from '../../app.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import { exporting } from './export.svelte.ts';

  type Profile = 'quick' | 'archive';
  interface ExportResult {
    dir: string;
    files: string[];
    sizes: Record<string, number>;
    plan: { fast: boolean; container: string };
  }

  const p = store.project;
  const hasVideo = !!p.media?.hasVideo;
  let profile = $state<Profile>('quick');
  let format = $state('mp4');
  let target = $state('0');
  let watermark = $state('');
  let wmPos = $state('br');
  let focusX = $state(0.5);
  let burnSubs = $state(false);
  let vertical = $state(false);
  let loudnorm = $state(false);
  let busy = $state(false);
  let progress = $state<number | null>(null);
  let msg = $state('');
  let result = $state.raw<ExportResult | null>(null);

  // burning, a watermark or a vertical crop means re-encoding; otherwise the original video is copied
  const needsRender = $derived((burnSubs && p.cues.length > 0) || !!watermark.trim() || vertical);
  const fast = $derived(!needsRender && hasVideo);

  function close() {
    if (!busy) exporting.open = false;
  }
  const options = () => ({
    profile,
    format,
    burnSubs: burnSubs && p.cues.length > 0,
    watermark: watermark.trim() ? { text: watermark.trim(), pos: wmPos } : null,
    vertical: vertical ? { enabled: true, focusX } : null,
    targetMb: fast ? 0 : Number(target) || 0,
    loudnorm,
    maxHeight: vertical ? 1920 : 1080,
  });
  const step = (f: number, text: string) => {
    progress = f;
    msg = text;
  };

  async function run() {
    busy = true;
    result = null;
    try {
      step(0.02, t('Saving project and uploading takes…'));
      await app.session.flushUploads();
      await store.flush();
      const assets = app.engine.assets;
      if (!assets) throw new Error('audio not loaded');
      await assets.ensureTakes(store.project);
      const kinds: StemKind[] = profile === 'archive' ? ['mix', 'bg', 'dry', 'wet'] : ['mix'];
      await renderAndUpload(store.project, assets, kinds, {
        onStep: (k, f) => step(0.05 + ((kinds.indexOf(k) + f) / kinds.length) * 0.45, `${t('Rendering')} ${k}…`),
      });
      step(0.55, t('Muxing video…'));
      const { job } = await api.startJob(`/api/projects/${p.id}/export`, options());
      result = await api.waitJob<ExportResult>(job, (j) => step(0.55 + j.progress * 0.45, `${t('Encoding')} ${Math.round(j.progress * 100)}%`));
      step(1, t('Done'));
    } catch (e) {
      progress = null;
      msg = errorMessage(e);
      toast(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }
  const PROFILES: [Profile, string, string][] = [
    ['quick', t('Quick share'), t('Small H.264/AAC (or WebM) for Discord, WhatsApp, chat.')],
    ['archive', t('Studio archive'), t('Mixed video + separate WAV stems: music/SFX, voice dry, voice wet. Plus .srt and .json.')],
  ];
</script>

<Modal title={t('Export')} onclose={close}>
  <div class="modes">
    {#each PROFILES as [id, title, desc] (id)}
      <button type="button" class={['mode', profile === id && 'sel']} data-profile={id} onclick={() => (profile = id)}>
        <h3>{title}</h3>
        <p>{desc}</p>
      </button>
    {/each}
  </div>
  <div class="hint" id="ex-plan">
    {hasVideo ? (needsRender ? t('Full render: video is re-encoded (slower).') : t('Fast export: the original video stream is copied untouched, only the new audio is added — near instant.')) : ''}
  </div>
  <div class="fields">
    <div class="field">
      <label for="ex-format">{t('Format')}</label>
      <select id="ex-format" bind:value={format} disabled={fast}>
        <option value="mp4">MP4 (H.264 + AAC)</option>
        <option value="webm">WebM (VP9 + Opus)</option>
      </select>
    </div>
    <div class="field">
      <label for="ex-target">{t('Target size')}</label>
      <select id="ex-target" value={fast ? '0' : target} onchange={(e) => (target = e.currentTarget.value)} disabled={fast}>
        <option value="0">{t('Best quality')}</option>
        <option value="8">≈ 8 MB</option>
        <option value="10">≈ 10 MB (Discord free)</option>
        <option value="16">≈ 16 MB (WhatsApp)</option>
        <option value="25">≈ 25 MB</option>
      </select>
    </div>
  </div>
  <div class="col">
    <label class="row small"><input id="ex-subs" type="checkbox" bind:checked={burnSubs} />{t('Burn subtitles into the picture')}</label>
    <label class="row small"><input id="ex-vert" type="checkbox" bind:checked={vertical} />{t('Vertical 9:16 (Reels / TikTok / Shorts)')}</label>
    <div class="field">
      <label for="ex-focus">{t('Crop focus (left ↔ right)')}</label>
      <input id="ex-focus" type="range" min="0" max="1" step="0.01" bind:value={focusX} />
    </div>
    <div class="row">
      <input id="ex-wm" type="text" placeholder={t('Watermark text (optional)')} bind:value={watermark} />
      <select id="ex-wmpos" bind:value={wmPos} aria-label={t('Watermark position')}>
        <option value="br">↘</option>
        <option value="bl">↙</option>
        <option value="tr">↗</option>
        <option value="tl">↖</option>
      </select>
    </div>
    <label class="row small"><input id="ex-loud" type="checkbox" bind:checked={loudnorm} />{t('Normalize loudness (−16 LUFS)')}</label>
  </div>
  {#if progress !== null}<div class="progress"><i style:width={`${Math.round(progress * 100)}%`}></i></div>{/if}
  <div class="small dim" id="ex-msg">{msg}</div>
  <div class="col" id="ex-results">
    {#if result}
      {@const r = result}
      {#each r.files as f (f)}
        <a class="take" href={`/media/${p.id}/exports/${r.dir}/${f}`} download={f} data-file={f}>
          <div class="grow">{f}</div>
          <span class="small dim">{fmtBytes(r.sizes[f])}</span>
          <span><Icon name="download" /></span>
        </a>
      {/each}
      <div class="hint">{r.plan.fast ? t('stream copy') : t('re-encoded')} · {t('saved in')} data/projects/{p.id}/exports/{r.dir}</div>
    {/if}
  </div>
  {#snippet actions()}
    <button onclick={close}>{t('Close')}</button>
    <button class="primary" id="ex-go" disabled={busy} onclick={run}>{t('Export')}</button>
  {/snippet}
</Modal>
