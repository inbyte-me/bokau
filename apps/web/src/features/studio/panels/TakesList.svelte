<!-- The selected track's takes: audition one over the original, put it on the timeline ("Use"), or drop it from the
     list. Nothing is deleted from disk. -->
<script lang="ts">
  import { applyTake } from '@doblaje/audio';
  import type { Take } from '@doblaje/core';
  import { fmtClock } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';

  const track = $derived.by(() => {
    void app.sel.trackId;
    return store.read(
      ['tracks'],
      () => {
        const tr = app.track;
        if (!tr) return null;
        const active = new Set(tr.clips.flatMap((c) => [c.takeId, c.file]));
        return { id: tr.id, name: tr.name, takes: [...tr.takes].reverse().map((k) => ({ ...k, active: active.has(k.id) || active.has(k.file) })) };
      },
      null,
    );
  });

  /** play the take alone (without touching the track's clips) over the original */
  function audition(k: Take) {
    const { engine } = app;
    void engine.playRange(Math.max(0, k.start - 0.3), k.start + k.duration + 0.2, { include: { original: true, voices: false, ghost: false } });
    const buf = engine.assets?.takes.get(k.file);
    const out = engine.out;
    if (!buf || !out) return;
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.start(Math.max(ctx.currentTime, engine.anchor + (k.start - Math.max(0, k.start - 0.3))));
  }
  function use(trackId: string, k: Take) {
    applyTake(store, trackId, k.id);
    void app.engine.refresh();
  }
  function drop(trackId: string, k: Take) {
    store.commit(
      'Remove take',
      (p) => {
        const tr = p.tracks.find((x) => x.id === trackId);
        if (tr) tr.takes = tr.takes.filter((x) => x.id !== k.id);
      },
      ['tracks'],
    );
  }
</script>

{#if track}
  <div class="col" id="takes-list">
    <div class="hint">
      {t('Takes on')} “{track.name}” — {t('click “Use” to put a take on the timeline (it replaces what is there). Nothing is ever deleted from disk.')}
    </div>
    {#each track.takes as k (k.id)}
      <div class={['take', k.active && 'active']} data-take={k.id}>
        <div class="grow">
          <div>{k.label || t('Take')}</div>
          <div class="small dim mono">{fmtClock(k.start, { ms: true })} · {k.duration.toFixed(1)}s{k.latencyMs ? ` · −${k.latencyMs}ms` : ''}</div>
        </div>
        <button class="icon" title={t('Audition')} onclick={() => audition(k)}><Icon name="play" size={13} /></button>
        <button class="use" onclick={() => use(track.id, k)}>{k.active ? t('Active') : t('Use')}</button>
        <button class="ghost" title={t('Remove from list')} onclick={() => drop(track.id, k)}><Icon name="close" size={12} /></button>
      </div>
    {:else}
      <div class="empty" style="padding: 1rem">{t('No takes yet. Press R to record.')}</div>
    {/each}
  </div>
{/if}
