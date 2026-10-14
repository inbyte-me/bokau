<!-- Camera preview and choice (podcast recordings use it; dubbing does not need a camera). -->
<script lang="ts">
  import { errorMessage } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy } from 'svelte';
  import { saveCamera, savedCamera } from './devices.svelte.ts';

  let cams = $state.raw<MediaDeviceInfo[]>([]);
  let camId = $state(savedCamera());
  let stream = $state.raw<MediaStream | null>(null);
  let note = $state('');

  function stop() {
    for (const tr of stream?.getTracks() ?? []) tr.stop();
    stream = null;
  }
  async function show() {
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined }, audio: false });
      stream = s;
      camId = s.getVideoTracks()[0]?.getSettings().deviceId || '';
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      saveCamera(camId);
      note = '';
    } catch (e) {
      note = t('Camera unavailable: {m}. You can still record audio only.', { m: errorMessage(e) });
    }
  }
  onDestroy(stop);
  /** the live preview follows the stream */
  function preview(v: HTMLVideoElement) {
    v.srcObject = stream;
  }
</script>

<div class="box" id="camera-box">
  <h4>{t('Camera')}</h4>
  <div class="row">
    <select id="cam-pick" bind:value={camId} onchange={show}>
      {#each cams as c (c.deviceId)}<option value={c.deviceId}>{c.label || t('Camera')}</option>{/each}
    </select>
    <button id="cam-test-btn" onclick={show}><Icon name="play" />{t('Show camera')}</button>
  </div>
  <video id="cam-test" class="cam" muted playsinline autoplay {@attach preview}></video>
  {#if note}<div class="hint">{note}</div>{/if}
  <div class="hint">{t('Used by podcast recordings. Dubbing does not need a camera.')}</div>
</div>

<style>
  .cam {
    width: 100%;
    max-height: 220px;
    background: #000;
    transform: scaleX(-1);
  }
</style>
