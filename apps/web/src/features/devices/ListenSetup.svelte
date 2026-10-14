<!-- Listening: the output device, a test beep, headphones or TV/speakers (which changes what plays while recording),
     hearing yourself, and echo cancellation. The last two settings belong to the open project. -->
<script lang="ts">
  import { errorMessage } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
  import { app } from '../../app.svelte.ts';
  import { listDevices, openMic } from '../../shell/mic.svelte.ts';
  import { store } from '../../store.svelte.ts';

  let outputs = $state.raw<MediaDeviceInfo[]>([]);
  let output = $state('default');
  let monitor = $state(app.mic.settings.monitor);
  let aec = $state(app.mic.settings.aec);
  const where = $derived(store.read(['settings'], (p) => p.settings.output, null));

  onMount(() => {
    void listDevices().then((d) => (outputs = d.outputs));
  });
  async function switchOutput() {
    try {
      await app.engine.setOutputDevice(output);
      toast(t('Output switched'), 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function testSound() {
    await app.engine.init();
    await app.engine.resume();
    app.engine.scheduleBeeps(app.engine.ctx.currentTime + 1.3, 1, { beep: true }); // one beep, then the higher GO beep
  }
  function setWhere(v: 'headphones' | 'speakers') {
    store.commit(
      'Output type',
      (p) => {
        p.settings.output = v;
        if (v === 'speakers') p.settings.muteOriginalWhileRecording = true;
      },
      ['settings'],
    );
  }
</script>

<div class="box" id="listen-box">
  <h4>{t('Listening')}</h4>
  <div class="field">
    <label for="out-device">{t('Output device (headphones / TV)')}</label>
    <div class="row">
      <select id="out-device" bind:value={output} onchange={switchOutput}>
        {#each outputs as o (o.deviceId)}<option value={o.deviceId}>{o.label || `${t('Output')} ${o.deviceId.slice(0, 4)}`}</option>{/each}
      </select>
      <button id="test-sound" title={t('Plays two short beeps')} onclick={testSound}>{t('Test sound')}</button>
    </div>
  </div>
  {#if where}
    <div class="lab">{t('Are you wearing headphones?')}</div>
    <div class="row">
      <label class="row small"><input type="radio" name="outtype" value="headphones" checked={where === 'headphones'} onchange={() => setWhere('headphones')} />{t('Headphones')}</label>
      <label class="row small"><input type="radio" name="outtype" value="speakers" checked={where === 'speakers'} onchange={() => setWhere('speakers')} />{t('TV / speakers')}</label>
    </div>
    {#if where === 'speakers'}
      <div class="hint warn">
        {t(
          'On speakers the mic hears the video sound. The original audio is muted while recording (you will still see the cues and picture). Use headphones for ghost-guide and music beds.',
        )}
      </div>
    {:else}
      <div class="hint">{t('Headphones: no bleed into the mic, so you can hear the original or the ghost guide while recording.')}</div>
    {/if}
  {/if}
  <label class="row small"
    ><input id="monitor" type="checkbox" bind:checked={monitor} onchange={() => app.mic.setMonitor(monitor, app.mic.settings.monitorPan)} />{t(
      'Hear myself (headphones only!)',
    )}</label
  >
  <label class="row small"
    ><input
      id="aec"
      type="checkbox"
      bind:checked={aec}
      onchange={() => {
        app.mic.settings.aec = aec;
        if (app.mic.isOpen) void openMic();
      }}
    />{t('Echo cancellation (for speakers; slightly degrades the voice)')}</label
  >
</div>
