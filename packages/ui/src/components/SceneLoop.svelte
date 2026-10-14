<!-- A moment of the clip, silent, playing over and over (the whole clip when it spans it). Whoever is not
     recording uses it to see what a scene is about while they write about it. -->
<script lang="ts">
  import { untrack } from 'svelte';

  interface Props {
    /** the clip's picture (the round's proxy) */
    src: string;
    /** seconds into the clip */
    start: number;
    end: number;
    label: string;
  }
  let { src, start, end, label }: Props = $props();

  function loop(video: HTMLVideoElement) {
    // the moment is fixed for the life of the element: the parent keys it by task
    const [from, to] = untrack(() => [start, end]);
    video.muted = true;
    const home = () => {
      video.currentTime = from;
    };
    const tick = () => {
      if (video.currentTime >= to || video.currentTime < from - 0.5) home();
    };
    video.addEventListener('loadedmetadata', home, { once: true });
    video.addEventListener('timeupdate', tick);
    void video.play().catch(() => {}); // a phone that wants a tap first just shows the first frame
    return () => {
      video.removeEventListener('timeupdate', tick);
      video.pause();
    };
  }
</script>

<div class="loop">
  <video {src} {@attach loop} muted playsinline preload="auto" aria-label={label}></video>
</div>

<style>
  .loop {
    border-radius: 10px;
    overflow: hidden;
    background: #000;
    aspect-ratio: 16 / 9;
    flex: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
</style>
