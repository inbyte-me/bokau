<!-- The finished round on a phone: one file, started for everyone at the same server time. It can be saved here: a party
     server deletes a room's files once everyone has left. -->
<script lang="ts">
  import type { Board } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy } from 'svelte';
  import { partyMedia } from './media.ts';

  interface Props {
    board: Board;
    code: string;
    token: string;
    /** server clock minus this clock, ms */
    skew: number;
    /** the party server forgets the room's files when everyone leaves */
    ephemeral?: boolean;
  }
  let { board, code, token, skew, ephemeral = true }: Props = $props();
  const result = $derived(board.result);
  const src = $derived(result ? partyMedia(code, token, result.file) : '');
  const download = $derived(result ? `${partyMedia(code, token, result.file)}&download=1` : '');
  let video = $state<HTMLVideoElement | null>(null);
  let now = $state(Date.now());
  /** this phone has been tapped: the browser lets the video play with sound at the start time */
  let unlocked = $state(false);
  let started = $state(false);
  const timer = setInterval(() => {
    now = Date.now();
  }, 200);
  onDestroy(() => clearInterval(timer));
  const wait = $derived(result ? Math.ceil((result.startAt - (now + skew)) / 1000) : 0);

  async function unlock() {
    const v = video;
    if (!v) return;
    unlocked = true;
    // a tap lets this element play later with sound: start it muted-by-pause right away
    await v.play().catch(() => {});
    v.pause();
    v.currentTime = 0;
  }

  // everybody's picture starts together: at the server's start time (or, arriving late, where the others are now)
  $effect(() => {
    const v = video;
    const r = result;
    if (!v || !r || !unlocked || started || wait > 0) return;
    started = true;
    v.currentTime = Math.max(0, now + skew - r.startAt) / 1000;
    void v.play().catch(() => {});
  });
  function again() {
    const v = video;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  }
</script>

{#if result}
  <section class="show" id="phone-show" data-state={started ? 'playing' : unlocked ? 'waiting' : 'locked'}>
    <h1>{wait > 0 && unlocked ? t('Starting in {n}', { n: wait }) : t('Here it is')}</h1>
    <div class="screen-box">
      <!-- svelte-ignore a11y_media_has_caption: the lines players say are the point, and a trailer's cards are in the picture -->
      <video bind:this={video} {src} playsinline controls={started} preload="auto" aria-label={t('The result')}></video>
      {#if !unlocked}
        <button id="watch-result" class="primary big cover" onclick={unlock}>{t('Tap to watch together')}</button>
      {/if}
    </div>
    <div class="actions">
      <button class="big" onclick={again} disabled={!started}>{t('Watch again')}</button>
      <a id="download-result" class="button big" href={download} download>{t('Download')}</a>
    </div>
    {#if ephemeral}<p class="note">{t('This room’s files are deleted when everyone has left. Download the result to keep it.')}</p>{/if}
  </section>
{/if}

<style>
  .show {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    margin: 0;
  }
  .screen-box {
    position: relative;
    border-radius: 10px;
    overflow: hidden;
    background: #000;
    aspect-ratio: 16 / 9;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .cover {
    position: absolute;
    inset: 0;
    width: 100%;
    border-radius: 0;
    background: rgb(0 0 0 / 0.55);
    border: none;
  }
  .actions {
    display: flex;
    gap: 10px;
  }
  .actions > * {
    flex: 1;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--line2);
    background: var(--panel2);
    border-radius: 12px;
  }
  .note {
    margin: 0;
    color: var(--faint);
    font-size: 0.9rem;
  }
</style>
