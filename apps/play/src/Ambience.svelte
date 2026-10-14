<!-- Background sound for waiting phones: loud in the headphones while someone else records their line, so nobody
     hears the take before the show. Tracks come from the studio's sound library; phones only start audio after a
     tap, so the first tap anywhere unlocks it. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy } from 'svelte';

  interface Props {
    urls: string[];
    token: string;
    /** play now (someone else is recording) */
    active: boolean;
  }
  let { urls, token, active }: Props = $props();
  let audio: HTMLAudioElement | null = null;
  let unlocked = $state(false);
  let blocked = $state(false);
  let index = Math.floor(Math.random() * 1000);

  const src = (i: number) => (urls.length ? `${urls[i % urls.length]}?t=${encodeURIComponent(token)}` : '');

  function unlock() {
    const a = audio;
    if (!a || unlocked || !urls.length) return;
    if (!a.src) a.src = src(index);
    a.play()
      .then(() => {
        unlocked = true;
        blocked = false;
        if (!active) a.pause();
      })
      .catch(() => {});
  }
  onDestroy(() => audio?.pause());

  /** Play while someone else records, pause otherwise (re-runs when `active` or the track list changes). */
  function follow(a: HTMLAudioElement) {
    audio = a;
    if (!urls.length) return;
    if (active) {
      if (!a.src) a.src = src(index);
      a.volume = 1;
      a.play().catch(() => {
        blocked = true; // the browser wants a tap first
      });
    } else a.pause();
  }

  function next() {
    index++;
    if (audio) {
      audio.src = src(index);
      if (active) void audio.play().catch(() => {});
    }
  }
</script>

<svelte:document onpointerdowncapture={unlock} />
<audio
  {@attach follow}
  onended={next}
  onplaying={() => {
    blocked = false;
    unlocked = true;
  }}
  preload="none"
></audio>
{#if active && urls.length && blocked}
  <button class="ambience-start primary" onclick={unlock}>{t('Tap to play the background music')}</button>
{/if}
{#if active && !urls.length}
  <p class="ambience-none">{t('No background music in the library: cover your ears.')}</p>
{/if}
