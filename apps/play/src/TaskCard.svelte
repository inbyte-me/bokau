<!-- One thing the room asks of this phone: write a text or vote for one, with the moment of the clip it is about. -->
<script lang="ts">
  import type { TaskView } from '@doblaje/party';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import SceneLoop from '@doblaje/ui/components/SceneLoop.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { partyVideo } from './media.ts';
  import { taskCopy } from './taskCopy.ts';
  import VoteTask from './VoteTask.svelte';
  import WriteTask from './WriteTask.svelte';

  interface Props {
    task: TaskView;
    code: string;
    token: string;
    /** the round's project (its picture is what the scenes are cut from) */
    projectId: string | null;
    skew: number;
    /** the answer: a text for a write task, an entry id for a vote */
    onanswer: (answer: string) => void;
  }
  let { task, code, token, projectId, skew, onanswer }: Props = $props();
  const copy = $derived(taskCopy(task));
</script>

<article class="task" id="task" data-kind={task.kind} data-stage={task.stage} data-done={task.done ? '' : undefined}>
  <p class="eyebrow">
    {copy.eyebrow}
    {#if task.deadline}<span class="timer"><Countdown deadline={task.deadline} {skew} /></span>{/if}
  </p>
  <h1>{copy.title}</h1>
  {#if task.character}<p class="who"><CharacterTag name={task.character.name} color={task.character.color} size="big" /></p>{/if}
  {#if task.scene && projectId}
    {@const scene = task.scene}
    {#key `${task.id}|${task.stage}`}
      {#await partyVideo(code, token, projectId) then src}
        <SceneLoop {src} start={scene.start} end={scene.end} label={t('The scene, without sound')} />
      {/await}
    {/key}
  {/if}
  {#if copy.lead}<p class="lead">{copy.lead}</p>{/if}
  {#if task.stage === 'vote'}
    <VoteTask options={task.options} voted={task.voted} onvote={onanswer} />
  {:else}
    <WriteTask saved={task.mine} placeholder={copy.placeholder} onsend={onanswer} />
  {/if}
  {#if task.done}<p class="ok" role="status">{copy.waiting}</p>{/if}
</article>

<style>
  .task {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .eyebrow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .timer {
    font-size: 1.2rem;
  }
  .lead {
    white-space: pre-line;
  }
  h1 {
    margin: 0;
  }
  .ok {
    margin: 0;
  }
  .who {
    margin: 0;
  }
</style>
