<!-- Play, record, what to record, loop, the clock, the mic meter and the take's track. Wraps on narrow windows. -->
<script lang="ts">
  import { fmtClock } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../app.svelte.ts';
  import { mic } from '../../shell/mic.svelte.ts';
  import { store } from '../../store.svelte.ts';
  import { transport } from '../../transport.svelte.ts';
  import { getStudio, type RecMode } from './studio.svelte.ts';

  const studio = getStudio();
  const template = $derived(store.read(['meta'], (p) => p.template, false));
  const length = $derived(store.read(['media'], (p) => p.media?.duration ?? 0, 0));
  // the track a take goes to (selection or the first track)
  const track = $derived.by(() => {
    void app.sel.trackId; // follows the selected track
    return store.read(['tracks'], () => ({ name: app.track?.name ?? '', color: app.track?.color ?? '' }), { name: '', color: '' });
  });
  const recording = $derived(transport.recording === 'recording' || transport.recording === 'countdown');
  const MODES: [RecMode, string][] = [
    ['playhead', t('From playhead')],
    ['cue', t('Selected cue')],
    ['region', t('Punch range')],
    ['loop', t('Loop takes (cue/range)')],
  ];
</script>

<div class="transport">
  <div class="grp">
    <button class="icon" id="to-start" title={t('Go to start (Home)')} onclick={() => app.engine.seek(0)}><Icon name="start" /></button>
    <button class="icon" title={t('Back one frame (←)')} onclick={() => app.engine.stepFrame(-1)}><Icon name="stepBack" /></button>
    <button class="icon" id="play" title={t('Play / pause (Space)')} onclick={() => studio.togglePlay()}><Icon name={transport.playing ? 'pause' : 'play'} /></button>
    <button class="icon" title={t('Forward one frame (→)')} onclick={() => app.engine.stepFrame(1)}><Icon name="stepFwd" /></button>
    <button
      class="icon"
      id="stop"
      title={t('Stop')}
      onclick={() => {
        studio.stopAll();
        app.engine.seek(store.project.loop?.start ?? 0);
      }}><Icon name="stop" /></button
    >
  </div>
  <div class="sep"></div>
  <button class={['icon', 'rec', recording && 'on', template && 'hidden']} id="rec" title={t('Record (R)')} onclick={() => studio.toggleRecord()}
    ><Icon name="rec" /></button
  >
  <select id="rec-mode" title={t('What to record')} bind:value={studio.recMode}>
    {#each MODES as [v, l] (v)}<option value={v}>{l}</option>{/each}
  </select>
  <button class="icon" id="loop-play" title={t('Loop playback of the selected range (L)')} onclick={() => studio.tl?.loopFromSelection()}><Icon name="loop" /></button>
  <div class="sep"></div>
  <div class="clock" id="clock">{fmtClock(transport.time, { ms: true })}</div>
  <span class="dim mono"> / {fmtClock(length)}</span>
  <div class="spacer"></div>
  <span class={['chip', mic.open && 'ok']} id="mic-chip">{mic.open ? t('mic on') : t('mic closed')}</span>
  <div class="meter"><i style:width={`${mic.open ? mic.level * 100 : 0}%`}></i><b></b></div>
  <div class="sep"></div>
  <span class="dim small">{t('Take:')}</span>
  <span class="chip" id="track-chip" style:color={track.color}>{track.name}</span>
</div>
