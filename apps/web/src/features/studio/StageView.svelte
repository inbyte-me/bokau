<!-- The picture: the proxy video (slaved to the audio clock by the engine), the karaoke line, the count-in and REC. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import KaraokeLine from '../../components/KaraokeLine.svelte';
  import { store } from '../../store.svelte.ts';
  import { transport } from '../../transport.svelte.ts';

  interface Props {
    projectId: string;
    banner: boolean;
    /** hands the video element to whoever drives it (the engine); returns its cleanup */
    onvideo: (video: HTMLVideoElement) => () => void;
  }
  let { projectId, banner, onvideo }: Props = $props();
  const cues = $derived(store.read(['cues'], (p) => p.cues.map((c) => ({ ...c })), []));
</script>

<div class="stage">
  <video
    id="video"
    {@attach onvideo}
    src={`/media/${projectId}/proxy.mp4`}
    playsinline
    muted
    preload="auto"
    disablepictureinpicture
  ></video>
  {#if banner}<KaraokeLine {cues} time={transport.time} />{/if}
  <div class="overlay">
    {#if transport.count !== null}
      <div class={['countdown', transport.count === 0 && 'go']}>{transport.count === 0 ? t('GO') : transport.count}</div>
    {/if}
  </div>
  {#if transport.recording === 'recording'}<div class="recbadge"><i></i><span>{t('REC')}</span></div>{/if}
</div>
