<!-- Trailer, before the first scene: the clip plays silently and everyone pitches what the movie is about, then votes. -->
<script lang="ts">
  import SceneLoop from '@doblaje/ui/components/SceneLoop.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../../api.ts';
  import ContestBoard from './ContestBoard.svelte';
  import { getHost } from './host.svelte.ts';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const pitch = $derived(room?.contests.find((c) => c.id === 'pitch'));
</script>

{#if room && pitch && room.projectId}
  <StepScreen title={t('What is this movie about?')} lead={t('Watch the clip. Everyone pitches it on their phone, then votes.')} id="pitching">
    <div class="layout">
      <div class="clip">
        <SceneLoop src={api.media(room.projectId, 'proxy.mp4')} start={0} end={room.clip?.duration ?? 0} label={t('The clip, without sound')} />
      </div>
      <ContestBoard contest={pitch} title={t('The pitch')} />
    </div>
  </StepScreen>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 2rem;
    align-items: start;
  }
  @media (max-width: 999px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
