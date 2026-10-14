<!-- The header of one timeline lane, row-aligned with the canvas: names, mute/solo, levels, effect. -->
<script lang="ts">
  import { FX_INFO } from '@doblaje/audio';
  import type { FxPreset, Project } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import type { Row, Timeline } from '../../timeline.ts';

  interface Props {
    row: Row;
    project: Project;
    tl: Timeline | null;
    selected: boolean;
  }
  let { row, project: p, tl, selected }: Props = $props();

  const soloAny = $derived(p.original.solo || p.tracks.some((x) => x.solo));
  const speaker = $derived(row.k === 'speakers' ? p.speakers.list.find((x) => x.id === row.id) : undefined);
  const track = $derived(row.k === 'track' ? p.tracks.find((x) => x.id === row.id) : undefined);

  function setSpeaker(id: string, patch: { muted?: boolean; solo?: boolean }) {
    store.commit(
      'Voice setting',
      (pr) => {
        const s = pr.speakers.list.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      },
      ['speakers'],
    );
    void app.engine.refresh();
  }
  function renameSpeaker(id: string, name: string) {
    store.commit(
      'Rename voice',
      (pr) => {
        const x = pr.speakers.list.find((q) => q.id === id);
        if (!x || !name.trim()) return;
        const old = x.name;
        x.name = name.trim();
        for (const c of pr.cues) if (c.character === old) c.character = x.name;
      },
      ['speakers', 'cues'],
    );
  }
  function editTrack(id: string, label: string, fn: (tr: Project['tracks'][number]) => void, kinds = ['tracks'], refresh = false) {
    store.commit(
      label,
      (pr) => {
        const tr = pr.tracks.find((x) => x.id === id);
        if (tr) fn(tr);
      },
      kinds,
    );
    if (refresh) void app.engine.refresh();
  }
  /** while dragging a volume: live, one undo step on release */
  function liveLevel(fn: (pr: Project) => void) {
    store.silent(fn, ['levels']);
    app.engine.applyLevels();
  }
  const stop = (e: Event) => e.stopPropagation();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: selecting a track by clicking its header is a shortcut; the track list and keyboard select too -->
<div
  class={['tl-head', row.k === 'speakers' && 'spk-head', selected && 'sel']}
  style:height={`${row.h}px`}
  style:opacity={track ? (!track.mute && (!soloAny || track.solo) ? 1 : 0.55) : undefined}
  data-speaker={speaker?.id}
  data-track={track?.id}
  onclick={track ? () => app.select({ trackId: track.id }) : undefined}
>
  {#if row.k === 'ruler'}
    <div class="small dim">{t('Timeline')}</div>
    <div class="mono small dim">{p.media ? `${p.media.width}×${p.media.height} · ${p.media.fps}fps` : ''}</div>
  {:else if row.k === 'thumbs'}
    <div class="name">{t('Video')}</div>
  {:else if row.k === 'orig'}
    <div class="name">{t('Original audio')}</div>
    <div class="btns">
      <button class={[p.original.mute && 'on']} title={t('Mute original')} onclick={() => tl?.tog('original', 'mute')}>M</button>
      <button class={[p.original.solo && 'on']} title={t('Solo original')} onclick={() => tl?.tog('original', 'solo')}>S</button>
      <input
        type="range"
        min="0"
        max="1.5"
        step="0.01"
        value={p.original.volume}
        title={t('Original volume')}
        oninput={(e) => {
          const v = Number(e.currentTarget.value);
          liveLevel((pr) => {
            pr.original.volume = v;
          });
        }}
        onchange={() => store.commit('Original volume', () => {}, ['levels'], { merge: true })}
      />
    </div>
    {#if p.stems?.status === 'ready'}
      <select
        title={t('Which part of the original to play')}
        value={p.original.source}
        onchange={(e) => {
          const v = e.currentTarget.value as Project['original']['source'];
          store.commit(
            'Original source',
            (pr) => {
              pr.original.source = v;
            },
            ['levels'],
          );
          void app.engine.refresh();
        }}
      >
        <option value="full">{t('Full mix')}</option>
        <option value="bg">{t('Music + SFX only')}</option>
        <option value="dialogue">{t('Dialogue only')}</option>
      </select>
    {/if}
  {:else if speaker}
    {@const sp = speaker}
    <div class="name">
      <span class="swatch" style:background={sp.color}></span>
      <input class="nm" value={sp.name} title={t('Character name')} onchange={(e) => renameSpeaker(sp.id, e.currentTarget.value)} />
    </div>
    <div class="btns">
      <button
        class={['voice-mute', sp.muted && 'on']}
        title={t('Silence this character in the original audio, so you can dub it')}
        onclick={() => setSpeaker(sp.id, { muted: !sp.muted })}>{sp.muted ? t('Off') : t('On')}</button
      >
      <button class={[sp.solo && 'on']} title={t('Hear only this character')} onclick={() => setSpeaker(sp.id, { solo: !sp.solo })}>S</button>
    </div>
  {:else if row.k === 'cues'}
    <div class="name">{t('Cue lane')}</div>
    <div class="small dim">{t('Double-click to add')}</div>
  {:else if row.k === 'flaps'}
    <div class="name">{t('Lip flaps')}</div>
    <div class="small dim">{t('Drag to draw mouth-open')}</div>
  {:else if track}
    {@const tr = track}
    <div class="name">
      <span class="swatch" style:background={tr.color}></span>
      <input
        class="nm"
        value={tr.name}
        title={t('Rename')}
        onclick={stop}
        onchange={(e) => {
          const v = e.currentTarget.value;
          editTrack(tr.id, 'Rename track', (x) => {
            x.name = v;
          });
        }}
      />
    </div>
    <div class="btns">
      <button
        class={[tr.mute && 'on']}
        title={t('Mute')}
        onclick={(e) => {
          stop(e);
          tl?.tog(tr.id, 'mute');
        }}>M</button
      >
      <button
        class={[tr.solo && 'on']}
        title={t('Solo')}
        onclick={(e) => {
          stop(e);
          tl?.tog(tr.id, 'solo');
        }}>S</button
      >
      <input
        type="range"
        min="0"
        max="1.6"
        step="0.01"
        value={tr.volume}
        title={t('Track volume')}
        onclick={stop}
        oninput={(e) => {
          const v = Number(e.currentTarget.value);
          liveLevel((pr) => {
            const x = pr.tracks.find((y) => y.id === tr.id);
            if (x) x.volume = v;
          });
        }}
        onchange={() => store.commit('Track volume', () => {}, ['levels'], { merge: true })}
      />
      {#if p.tracks.length > 1}
        <button
          class="ghost"
          title={t('Remove track')}
          onclick={(e) => {
            stop(e);
            if (!tr.clips.length || confirm(t('Remove this track and its clips?')))
              store.commit(
                'Remove track',
                (pr) => {
                  pr.tracks = pr.tracks.filter((x) => x.id !== tr.id);
                },
                ['tracks'],
              );
          }}><Icon name="close" size={12} /></button
        >
      {/if}
    </div>
    <select
      title={t('Voice effect')}
      value={tr.fx}
      onclick={stop}
      onchange={(e) => {
        const v = e.currentTarget.value as FxPreset;
        editTrack(
          tr.id,
          'Voice effect',
          (x) => {
            x.fx = v;
          },
          ['tracks'],
          true,
        );
      }}
    >
      {#each Object.entries(FX_INFO) as [k, v] (k)}<option value={k}>{t(v.label)}</option>{/each}
    </select>
  {/if}
</div>
