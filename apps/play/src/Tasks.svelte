<!-- What the room asks of this phone while someone else records: write or vote, one card per task. -->
<script lang="ts">
  import type { PartyClient, PlayerView } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import TaskCard from './TaskCard.svelte';

  interface Props {
    client: PartyClient<PlayerView>;
    view: PlayerView;
    code: string;
    token: string;
    skew: number;
  }
  let { client, view, code, token, skew }: Props = $props();
  const tasks = $derived(view.tasks);
  const recording = $derived(view.phase === 'playing' && view.turn && !view.turn.mine ? view.turn.player : null);
</script>

{#each tasks as task (`${task.id}|${task.stage}`)}
  <TaskCard
    {task}
    {code}
    {token}
    projectId={view.projectId}
    {skew}
    onanswer={(answer) => client.player(task.stage === 'vote' ? { type: 'vote', task: task.id, entry: answer } : { type: 'submit', task: task.id, text: answer })}
  />
{/each}
{#if recording}<p class="aside" role="status">{t('{name} is recording. Headphones on.', { name: recording })}</p>{/if}

<style>
  .aside {
    margin: 0;
    color: var(--faint);
    text-align: center;
  }
</style>
