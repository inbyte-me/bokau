<!-- The selected track's voice: effect and amount, mic fix, micro-nudge; for a selected clip, its gain and a server
     denoise. -->
<script lang="ts">
  import { FX_INFO } from '@doblaje/audio';
  import type { FxPreset, Track } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import { denoiseClip } from '../../actions.ts';

  const track = $derived.by(() => {
    void app.sel.trackId;
    const clipId = app.sel.clipId;
    return store.read(
      ['tracks'],
      () => {
        const tr = app.track;
        if (!tr) return null;
        const clip = tr.clips.find((c) => c.id === clipId);
        return { id: tr.id, name: tr.name, fx: tr.fx, fxAmount: tr.fxAmount, micFix: tr.micFix, nudgeMs: tr.nudgeMs, clip: clip ? { ...clip } : null };
      },
      null,
    );
  });
  let nudge = $derived(track?.nudgeMs ?? 0);

  function set<K extends keyof Track>(label: string, k: K, v: Track[K]) {
    const id = track?.id;
    store.commit(
      label,
      (p) => {
        const tr = p.tracks.find((x) => x.id === id);
        if (tr) tr[k] = v;
      },
      ['tracks'],
    );
    void app.engine.refresh();
  }
  /** while dragging: move the track live, one undo step on release */
  function dragNudge(v: number) {
    nudge = v;
    const id = track?.id;
    store.silent(
      (p) => {
        const tr = p.tracks.find((x) => x.id === id);
        if (tr) tr.nudgeMs = v;
      },
      ['tracks'],
    );
  }
  function setClipGain(clipId: string, v: number) {
    store.commit(
      'Clip gain',
      (p) => {
        for (const tr of p.tracks) for (const c of tr.clips) if (c.id === clipId) c.gain = v;
      },
      ['tracks'],
    );
    void app.engine.refresh();
  }
  function denoise(clipId: string) {
    const c = app.track?.clips.find((x) => x.id === clipId);
    if (c) void denoiseClip(c);
  }
</script>

{#if track}
  <div class="box" id="fx-box">
    <h4>{t('Voice effect')} — {track.name}</h4>
    <div class="fxgrid">
      {#each Object.entries(FX_INFO) as [k, v] (k)}
        <button class={['fxbtn', track.fx === k && 'sel']} data-fx={k} onclick={() => set('Voice setting', 'fx', k as FxPreset)}>{t(v.label)}</button>
      {/each}
    </div>
    <div class="slider">
      <label for="fx-amount">{t('Effect amount')}</label>
      <input
        id="fx-amount"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={track.fxAmount}
        disabled={track.fx === 'none'}
        onchange={(e) => set('Voice setting', 'fxAmount', Number(e.currentTarget.value))}
      />
      <span class="v">{Math.round(track.fxAmount * 100)}%</span>
    </div>
    <label class="row small"
      ><input id="micfix" type="checkbox" checked={track.micFix} onchange={(e) => set('Voice setting', 'micFix', e.currentTarget.checked)} />{t(
        'Mic fix: rumble filter + gentle leveling (great for budget mics)',
      )}</label
    >
    <div class="slider">
      <label for="nudge">{t('Micro-nudge')}</label>
      <input
        id="nudge"
        type="range"
        min="-250"
        max="250"
        step="1"
        value={nudge}
        oninput={(e) => dragNudge(Number(e.currentTarget.value))}
        onchange={() => {
          store.commit('Nudge track', () => {}, ['tracks'], { merge: true });
          void app.engine.refresh();
        }}
      />
      <span class="v">{nudge} ms</span>
    </div>
    <div class="hint">{t('Nudge shifts this whole track earlier (−) or later (+) after recording — fix small sync errors by ear.')}</div>
    {#if track.clip}
      {@const clip = track.clip}
      <div class="row">
        <button id="clean-take" onclick={() => denoise(clip.id)}><Icon name="wave" />{t('Denoise this clip (server)')}</button>
        <div class="slider grow">
          <label for="clip-gain">{t('Clip gain')}</label>
          <input id="clip-gain" type="range" min="0" max="3" step="0.01" value={clip.gain ?? 1} onchange={(e) => setClipGain(clip.id, Number(e.currentTarget.value))} />
          <span class="v">{(clip.gain ?? 1).toFixed(2)}×</span>
        </div>
      </div>
    {/if}
  </div>
{/if}
