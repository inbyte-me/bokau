<!-- After recording: play it back, trim (I/O or the handles), chapters (M), a transcript, voice clean-up and loudness,
     export. The recording itself is already saved; the original can be downloaded untouched. -->
<script lang="ts">
  import { errorMessage, newCue, type PodcastSettings } from '@doblaje/core';
  import { STT_MODELS, transcribeProject } from '@doblaje/speech';
  import { fmtBytes, fmtClock, registerMenu, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../../api.ts';
  import { app } from '../../app.svelte.ts';
  import { go } from '../../router.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import { transport } from '../../transport.svelte.ts';
  import StageView from '../studio/StageView.svelte';
  import WaveStrip from './WaveStrip.svelte';

  interface PodcastExportResult {
    dir: string;
    files: string[];
    sizes: Record<string, number>;
    seconds: number;
    loudness: { integrated: number | null; truePeak: number | null };
  }

  const project = store.project;
  let loaded = $state(false);
  const duration = $derived(loaded ? app.engine.duration : 0);
  const pod = $derived(store.read(['podcast'], (p) => structuredClone(p.podcast), null));
  const FORMATS: [PodcastSettings['format'], string][] = [
    ['mp3', 'MP3 · 192 kbps'],
    ['m4a', 'M4A (AAC) · chapters'],
    ['wav', 'WAV · lossless'],
    ...(project.media?.hasVideo
      ? ([
          ['mp4', 'MP4 video'],
          ['webm', 'WebM video'],
        ] as [PodcastSettings['format'], string][])
      : []),
  ];

  function load(video: HTMLVideoElement) {
    untrack(() => app.engine.load(project, video))
      .then(() => (loaded = true))
      .catch((e: unknown) => toast(errorMessage(e), 'error'));
    return () => {};
  }

  // ---- playback within the trim
  const clampTrim = (tt: number) => {
    const tr = store.project.podcast.trim;
    return tr && (tt < tr.start || tt >= tr.end) ? tr.start : tt;
  };
  function play() {
    if (app.engine.playing) app.engine.pause();
    else void app.engine.play(clampTrim(app.engine.time));
  }
  // stop at the trim's end (the engine's clock, no state written)
  $effect(() => {
    const tr = pod?.trim;
    if (tr && transport.playing && transport.time >= tr.end) app.engine.pause();
  });

  function setTrim(patch: { start?: number; end?: number }) {
    const dur = duration;
    store.commit(
      'Trim',
      (p) => {
        const nx = { ...(p.podcast.trim || { start: 0, end: dur }), ...patch };
        p.podcast.trim = nx.end - nx.start < 0.5 || (nx.start <= 0.01 && nx.end >= dur - 0.01) ? null : nx;
      },
      ['podcast'],
    );
  }

  // ---- chapters
  const chapter = (fn: (c: PodcastSettings['chapters']) => void, label: string) => store.commit(label, (p) => fn(p.podcast.chapters), ['podcast']);
  function addChapter() {
    const at = app.engine.time;
    chapter((cs) => {
      cs.push({ t: at, title: `${t('Chapter')} ${cs.length + 1}` });
      cs.sort((a, b) => a.t - b.t);
      cs.forEach((c, i) => {
        if (/^(Chapter|Capítulo) \d+$/.test(c.title)) c.title = `${t('Chapter')} ${i + 1}`;
      });
    }, 'Add chapter');
  }
  const offMenu = registerMenu('[data-chapter]', (el) => {
    const i = Number((el as HTMLElement).dataset.chapter);
    const c = store.project.podcast.chapters[i];
    if (!c) return null;
    return [
      { label: t('Go to chapter'), icon: 'start', run: () => app.engine.seek(c.t) },
      {
        label: t('Move chapter to the playhead'),
        run: () =>
          chapter((cs) => {
            cs[i].t = app.engine.time;
            cs.sort((a, b) => a.t - b.t);
          }, 'Move chapter'),
      },
      { label: t('Delete chapter'), icon: 'trash', danger: true, run: () => chapter((cs) => void cs.splice(i, 1), 'Delete chapter') },
    ];
  });
  onDestroy(offMenu);

  // ---- transcript
  let lang = $state('auto');
  let sttBusy = $state(false);
  let sttStatus = $state('');
  async function transcribe() {
    sttBusy = true;
    sttStatus = t('Starting speech recognition…');
    try {
      const r = await transcribeProject(store.project, {
        model: STT_MODELS[1].id,
        language: lang,
        onProgress: (e) => {
          sttStatus = e.type === 'progress' ? `${t('Downloading model')} ${Math.round(e.pct * 100)}%` : t('Transcribing…');
        },
      });
      store.commit(
        'Transcribe',
        (p) => {
          p.cues = r.cues.map((c) => newCue({ start: c.start, end: c.end, text: c.text }));
        },
        ['cues'],
      );
      sttStatus = t('{n} cues from speech recognition.', { n: r.cues.length });
    } catch (e) {
      sttStatus = errorMessage(e);
    } finally {
      sttBusy = false;
    }
  }

  // ---- clean-up and export
  const setOption = (fn: (o: PodcastSettings) => void) => store.commit('Podcast options', (p) => fn(p.podcast), ['podcast']);
  let exporting = $state(false);
  let progress = $state<number | null>(null);
  let msg = $state('');
  let result = $state.raw<PodcastExportResult | null>(null);
  async function exportIt() {
    exporting = true;
    result = null;
    progress = 0;
    try {
      await store.flush();
      const o = store.project.podcast;
      const { job } = await api.startJob(`/api/projects/${project.id}/podcast-export`, {
        format: o.format,
        clean: o.clean,
        loudnorm: o.loudnorm,
        trim: o.trim,
        chapters: o.chapters,
      });
      const res = await api.waitJob<PodcastExportResult>(job, (j) => {
        progress = j.progress;
        msg = j.message || '';
      });
      const lufs = res.loudness.integrated != null ? `${res.loudness.integrated.toFixed(1)} LUFS` : '';
      const peak = res.loudness.truePeak != null ? `${res.loudness.truePeak.toFixed(1)} dBFS` : '';
      msg = `${fmtClock(res.seconds)} · ${lufs} · ${t('peak')} ${peak}`;
      result = res;
    } catch (e) {
      toast(errorMessage(e), 'error');
      msg = errorMessage(e);
    } finally {
      exporting = false;
    }
  }
  async function newRecording() {
    const np = await api.createProject(`${t('Podcast')} ${new Date().toLocaleDateString()}`, 'podcast');
    go(`/p/${np.id}`);
  }

  function keys(e: KeyboardEvent) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === ' ') {
      e.preventDefault();
      play();
    } else if (e.key === 'm' || e.key === 'M') addChapter();
    else if (e.key === 'i' || e.key === 'I') setTrim({ start: app.engine.time });
    else if (e.key === 'o' || e.key === 'O') setTrim({ end: app.engine.time });
  }
</script>

<svelte:window onkeydown={keys} />

<div class="pod-stage">
  <div class="stage-box"><StageView projectId={project.id} banner={true} onvideo={load} /></div>
  {#if pod}<WaveStrip {duration} trim={pod.trim} chapters={pod.chapters} ontrim={setTrim} />{/if}
  <div class="row">
    <div class="grp">
      <button class="icon" title={t('Go to start (Home)')} onclick={() => app.engine.seek(0)}><Icon name="start" /></button>
      <button class="primary" id="pod-play" onclick={play}><Icon name={transport.playing ? 'pause' : 'play'} />{transport.playing ? t('Pause') : t('Play')}</button>
    </div>
    <div class="clock" id="clock">{fmtClock(transport.time, { ms: true })}</div>
    <span class="dim mono"> / {fmtClock(duration)}</span>
    <div class="spacer"></div>
    <span class="small dim">{t('Click the waveform to move; drag the amber handles to trim.')}</span>
  </div>
</div>

{#if pod}
  <div class="pod-side">
    <h1>{project.name}</h1>
    <div class="hint" id="pod-saved">
      {t('Your recording is already saved automatically. Choose a format and press Export to get a file, or download the untouched original.')}
      <a id="pod-original" href={`/media/${project.id}/${project.media?.sourceFile || ''}`} download="">{t('Download original')}</a>
    </div>
    <div class="box">
      <h4>{t('Trim')}</h4>
      <div class="row">
        <button id="trim-in" onclick={() => setTrim({ start: app.engine.time })}>{t('Start here (I)')}</button>
        <button id="trim-out" onclick={() => setTrim({ end: app.engine.time })}>{t('End here (O)')}</button>
        <button class="ghost" onclick={() => store.commit('Clear trim', (p) => {
p.podcast.trim = null;
}, ['podcast'])}>{t('Clear')}</button>
      </div>
      <div class="small dim mono" id="trim-info">
        {pod.trim
          ? `${fmtClock(pod.trim.start, { ms: true })} → ${fmtClock(pod.trim.end, { ms: true })} · ${fmtClock(pod.trim.end - pod.trim.start)}`
          : t('Whole recording')}
      </div>
    </div>
    <div class="box">
      <h4>{t('Chapters')}</h4>
      <button id="pod-add-chapter" onclick={addChapter}><Icon name="flag" />{t('Add chapter at playhead (M)')}</button>
      <div class="col" id="pod-chapters">
        {#each pod.chapters as c, i (i)}
          <div class="row" data-chapter={i}>
            <button class="ghost mono" onclick={() => app.engine.seek(c.t)}>{fmtClock(c.t)}</button>
            <input
              class="grow"
              type="text"
              value={c.title}
              onchange={(e) => {
                const v = e.currentTarget.value;
                chapter((cs) => {
cs[i].title = v;
}, 'Chapter title');
              }}
            />
            <button class="ghost icon" title={t('Delete')} onclick={() => chapter((cs) => void cs.splice(i, 1), 'Delete chapter')}><Icon name="close" size={12} /></button>
          </div>
        {:else}
          <div class="hint">{t('No chapters. Add one at the playhead with M. Podcast apps show them as a table of contents.')}</div>
        {/each}
      </div>
    </div>
    <div class="box">
      <h4>{t('Transcript')}</h4>
      <div class="row">
        <select id="pod-lang" bind:value={lang}>
          <option value="auto">{t('Auto-detect')}</option>
          <option value="english">English</option>
          <option value="spanish">Español</option>
          <option value="french">Français</option>
          <option value="portuguese">Português</option>
        </select>
        <button id="pod-transcribe" disabled={sttBusy} onclick={transcribe}>{t('Transcribe')}</button>
      </div>
      <div class="hint" id="pod-stt">{sttStatus}</div>
    </div>
    <div class="box">
      <h4>{t('Voice clean-up')}</h4>
      <label class="row small"
        ><input id="pod-rumble" type="checkbox" checked={pod.clean.rumble} onchange={(e) => {
          const v = e.currentTarget.checked;
          setOption((o) => {
o.clean.rumble = v;
});
        }} />{t('Remove low rumble (desk thumps, hum)')}</label
      >
      <label class="row small"
        ><input id="pod-denoise" type="checkbox" checked={pod.clean.denoise} onchange={(e) => {
          const v = e.currentTarget.checked;
          setOption((o) => {
o.clean.denoise = v;
});
        }} />{t('Reduce background noise')}</label
      >
      <label class="row small"
        ><input id="pod-compress" type="checkbox" checked={pod.clean.compress} onchange={(e) => {
          const v = e.currentTarget.checked;
          setOption((o) => {
o.clean.compress = v;
});
        }} />{t('Even out volume (gentle compression)')}</label
      >
      <label class="row small"
        ><input id="pod-loud" type="checkbox" checked={pod.loudnorm} onchange={(e) => {
          const v = e.currentTarget.checked;
          setOption((o) => {
o.loudnorm = v;
});
        }} />{t('Normalize loudness to −16 LUFS (podcast standard)')}</label
      >
    </div>
    <div class="box">
      <h4>{t('Export')}</h4>
      <div class="field">
        <label for="pod-format">{t('Format')}</label>
        <select
          id="pod-format"
          value={pod.format}
          onchange={(e) => {
            const v = e.currentTarget.value as PodcastSettings['format'];
            setOption((o) => {
o.format = v;
});
          }}
        >
          {#each FORMATS as [v, l] (v)}<option value={v}>{l}</option>{/each}
        </select>
      </div>
      <button class="primary" id="pod-export" disabled={exporting} onclick={exportIt}><Icon name="export" />{t('Export')}</button>
      {#if progress !== null}<div class="progress"><i style:width={`${progress * 100}%`}></i></div>{/if}
      <div class="small dim" id="pod-msg">{msg}</div>
      <div class="col" id="pod-results">
        {#each result?.files ?? [] as f (f)}
          <a class="take" href={`/media/${project.id}/exports/${result?.dir}/${f}`} download={f} data-file={f}>
            <div class="grow">{f}</div>
            <span class="small dim">{fmtBytes(result?.sizes[f] ?? 0)}</span>
            <Icon name="download" />
          </a>
        {/each}
      </div>
    </div>
    <div class="row"><button id="pod-new" onclick={newRecording}><Icon name="plus" />{t('New recording')}</button></div>
  </div>
{/if}
