<!-- Recording a podcast: camera preview, sources and level, record / pause, chapters while recording (M), and the
     full audio setup folded away. Space records/stops. -->
<script lang="ts">
  import { errorMessage } from '@doblaje/core';
  import { fmtBytes, fmtClock, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, onMount } from 'svelte';
  import { mic, openMic } from '../../shell/mic.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import VoiceSettings from '../devices/VoiceSettings.svelte';
  import { PodcastRecorder } from './recorder.svelte.ts';

  const rec = new PodcastRecorder(store.project.id);
  const chapters = $derived(store.read(['podcast'], (p) => p.podcast.chapters.map((c) => ({ ...c })), []));
  const live = $derived(rec.state === 'recording' || rec.state === 'paused');
  const reading = $derived(mic.reading);

  onMount(() => {
    void rec.openCamera().then(() => openMic());
  });
  onDestroy(() => rec.dispose());

  async function toggle() {
    try {
      await rec.toggle();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  function rename(i: number, title: string) {
    store.commit(
      'Chapter title',
      (p) => {
        p.podcast.chapters[i].title = title;
      },
      ['podcast'],
    );
  }
  function keys(e: KeyboardEvent) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'm' || e.key === 'M') rec.addChapter();
    else if (e.key === ' ') {
      e.preventDefault();
      void toggle();
    }
  }
  function preview(v: HTMLVideoElement) {
    v.srcObject = rec.camera;
  }
</script>

<svelte:window onkeydown={keys} />

<div class="pod-stage">
  <div class="stage-box">
    <div class="stage">
      <video id="cam-preview" muted playsinline autoplay {@attach preview} style="transform: scaleX(-1)"></video>
      <div class="recbadge" id="pod-live"><div class="clock" id="rec-timer">{fmtClock(rec.elapsed)}</div></div>
    </div>
  </div>
  <div class="row">
    <span class="small dim mono" id="rec-size">{fmtBytes(rec.bytes)}</span>
    <div class="spacer"></div>
    <div class="hint" id="rec-status" role="status">{rec.status}</div>
  </div>
</div>
<div class="pod-side">
  <h1>{t('Podcast')}</h1>
  <p class="lead">{t('Record audio and video straight from your camera and microphone. Chapters you add while recording are saved with the episode.')}</p>
  <div class="box">
    <h4>{t('Sources')}</h4>
    <label class="row"><input id="use-video" type="checkbox" checked={rec.useVideo} disabled={live} onchange={(e) => rec.setUseVideo(e.currentTarget.checked)} />{t('Record video')}</label>
    <div class="field">
      <label for="cam-device">{t('Camera')}</label>
      <select id="cam-device" bind:value={rec.cameraId} disabled={live} onchange={() => rec.openCamera()}>
        {#each rec.cameras as c (c.deviceId)}<option value={c.deviceId}>{c.label || t('Camera')}</option>{/each}
      </select>
    </div>
    <div class="meter big" id="pod-meter"><i style:width={`${mic.level * 100}%`}></i></div>
    <div class="small mono dim" id="pod-db" style:color={reading.clipped ? 'var(--signal-text)' : undefined}>
      {(reading.peakDb ?? -120) > -90 ? (reading.peakDb ?? 0).toFixed(1) : '-∞'} dBFS{reading.clipped ? ` · ${t('clipping')}` : ''}
    </div>
  </div>
  <div class="row">
    <button class={['signal', 'big-btn', live && 'on']} id="pod-rec" disabled={rec.state === 'finishing'} onclick={toggle}
      ><Icon name={live ? 'stop' : 'rec'} />{live ? t('Stop') : t('Record')}</button
    >
    <button class="big-btn" id="pod-pause" disabled={!live} onclick={() => rec.pauseResume()}
      ><Icon name={rec.state === 'paused' ? 'play' : 'pause'} />{rec.state === 'paused' ? t('Resume') : t('Pause')}</button
    >
  </div>
  <div class="row">
    <button id="pod-chapter" disabled={!live} onclick={() => rec.addChapter()}><Icon name="flag" />{t('Add chapter')}</button>
    <span class="small dim">{t('Press')} M</span>
  </div>
  <div class="col" id="pod-chapters">
    {#each chapters as c, i (i)}
      <div class="row">
        <span class="mono dim">{fmtClock(c.t)}</span>
        <input class="grow" type="text" value={c.title} onchange={(e) => rename(i, e.currentTarget.value)} />
      </div>
    {/each}
  </div>
  <details class="box">
    <summary>{t('Audio setup')}</summary>
    <div class="col setup"><VoiceSettings /></div>
  </details>
</div>

<style>
  .setup {
    margin-top: 0.6rem;
  }
</style>
