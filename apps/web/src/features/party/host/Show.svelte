<!-- The show: the round's project played once, big, with its subtitles; then what next (watch again, another round,
     change the game or the scene, open the result in the studio). -->
<script lang="ts">
  import type { Project } from '@doblaje/core';
  import type { TrailerResult } from '@doblaje/party';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../../api.ts';
  import { app } from '../../../app.svelte.ts';
  import KaraokeLine, { type KaraokeCue } from '../../../components/KaraokeLine.svelte';
  import { transport } from '../../../transport.svelte.ts';
  import TrailerCards from './TrailerCards.svelte';

  interface Props {
    projectId: string;
    /** the part of the clip this round played (only used when the round kept the whole clip) */
    slice: { start: number; end: number } | null;
    recorded: number;
    total: number;
    /** the turns were scenes of a trailer, not lines */
    scenes?: boolean;
    onagain: () => void;
    onchangegame: () => void;
    onchangescene: () => void;
    onstudio: () => void;
  }
  let { projectId, slice, recorded, total, scenes = false, onagain, onchangegame, onchangescene, onstudio }: Props = $props();
  let playback = $state<'loading' | 'ready' | 'playing' | 'ended' | 'error'>('loading');
  let error = $state('');
  let cues = $state.raw<KaraokeCue[]>([]);
  /** the round's media was cut down to its slice, or assembled into a trailer: it plays whole */
  let cut = false;
  /** a trailer's cards (shown over the black gaps between its scenes) */
  let trailer = $state.raw<TrailerResult | null>(null);

  /** Load the round into the engine with this video and play it; stop when the screen goes away. */
  function stage(video: HTMLVideoElement) {
    let alive = true;
    const off: (() => void)[] = [];
    api
      .project(projectId)
      .then(async (project: Project) => {
        if (!alive) return;
        video.src = api.media(projectId, 'proxy.mp4');
        await app.engine.load(project, video);
        trailer = (project.party.trailer as TrailerResult | undefined) ?? null;
        cues = project.party.mode === 'blind' || trailer ? [] : project.cues;
        cut = !!project.party.slice || !!trailer;
        off.push(app.engine.on('ended', () => (playback = 'ended')));
        playback = 'ready';
        if (alive) void play();
      })
      .catch((e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
        playback = 'error';
      });
    return () => {
      alive = false;
      for (const f of off) f();
      app.engine.stop();
    };
  }
  async function play() {
    await app.engine.resume();
    playback = 'playing';
    // a round cut down to its slice plays whole; one that kept the whole clip (the cut failed) plays the slice
    if (slice && !cut) await app.engine.playAt(slice.start, undefined, { to: slice.end });
    else await app.engine.play(0);
  }
</script>

<div class="show" id="party-show" data-state={playback}>
  <div class="show-stage stage">
    <video {@attach stage} playsinline muted></video>
    {#if playback === 'playing'}
      {#if trailer}<TrailerCards cards={trailer.cards} time={transport.time} />{:else}<KaraokeLine {cues} time={transport.time} lead={0.3} />{/if}
    {/if}
    {#if playback === 'ended' || playback === 'ready'}
      <div class="after">
        <p class="dim">{scenes ? t('{n} of {total} scenes recorded', { n: recorded, total }) : t('{n} of {total} lines dubbed', { n: recorded, total })}</p>
        <div class="choices">
          <button class="primary big-btn" id="replay" onclick={play}><Icon name="play" />{t('Watch again')}</button>
          <button class="big-btn" id="next-round" onclick={onagain}>{t('Another round')}</button>
          <button class="big-btn" id="change-game" onclick={onchangegame}>{t('Change the game')}</button>
          <button class="big-btn" id="change-scene" onclick={onchangescene}>{t('Change the scene')}</button>
        </div>
        <button class="ghost" onclick={onstudio}>{t('Open in the studio')}</button>
      </div>
    {/if}
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .show {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    height: 100%;
  }
  .show-stage {
    flex: 1;
    min-height: 240px;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .after {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: 1rem;
    padding: 5%;
    background: rgb(0 0 0 / 0.72);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .dim {
    color: var(--dim);
    margin: 0;
    font-size: 1.2rem;
  }
  .error {
    color: var(--signal-text);
  }
</style>
