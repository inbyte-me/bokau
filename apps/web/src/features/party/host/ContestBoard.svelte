<!-- A contest on the TV: who has written, then the texts being voted on with the votes as they come, then the winner.
     `reveal` off keeps the words off the screen (a scene's direction is a surprise to the one who will perform it). -->
<script lang="ts">
  import { type Contest, playerColor } from '@doblaje/party';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';

  interface Props {
    contest: Contest;
    title: string;
    /** show the texts (the pitch and the title are for everyone; a direction is not) */
    reveal?: boolean;
  }
  let { contest, title, reveal = true }: Props = $props();

  const host = getHost();
  const room = $derived(host.room);
  const skew = $derived(host.state?.skew ?? 0);
  const name = (id: string) => room?.players.find((p) => p.id === id)?.name ?? '?';
  const color = (id: string) => (room ? playerColor(room, id) : '#888');
  const writers = $derived(contest.who.map((id) => ({ id, done: contest.entries.some((e) => e.playerId === id) })));
  const voters = (entryId: string) =>
    Object.entries(contest.votes)
      .filter(([, e]) => e === entryId)
      .map(([v]) => v);
  const winner = $derived(contest.entries.find((e) => e.id === contest.winner));
</script>

<section class="contest" data-contest={contest.id} data-stage={contest.stage}>
  <header>
    <h2>{title}</h2>
    {#if contest.stage !== 'done'}<span class="timer"><Countdown deadline={contest.deadline} {skew} /></span>{/if}
  </header>

  {#if contest.stage === 'write'}
    {#if writers.length}
      <ul class="writers" aria-label={t('Who has written')}>
        {#each writers as w (w.id)}
          <li class={[w.done && 'done']} style:--c={color(w.id)}>{name(w.id)}</li>
        {/each}
      </ul>
    {:else}
      <p class="dim">{t('Nobody is free to write this one: the AI will.')}</p>
    {/if}
  {:else if contest.stage === 'vote'}
    {#if reveal}
      <ul class="entries">
        {#each contest.entries as e (e.id)}
          <li>
            <span class="text">{e.text}</span>
            <span class="votes" aria-label={t('Votes')}>
              {#each voters(e.id) as v (v)}<i style:--c={color(v)}></i>{/each}
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="dim">{t('{n} ideas. Everyone who wrote is voting on their phone.', { n: contest.entries.length })}</p>
    {/if}
  {:else if winner && reveal}
    <p class="winner" id="contest-winner">{winner.text}</p>
    <p class="by" style:--c={color(winner.playerId)}>{name(winner.playerId)}</p>
  {:else if contest.text !== null}
    <p class="dim">{t('Chosen.')}</p>
  {:else}
    <p class="dim">{t('The AI is writing it…')}</p>
  {/if}
</section>

<style>
  .contest {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.1rem 1.3rem;
    border: 1px solid var(--line2);
    border-radius: 4px;
    background: var(--panel);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .timer {
    font-size: 1.6rem;
  }
  .writers,
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.5rem;
  }
  .writers {
    flex-wrap: wrap;
  }
  .writers li {
    padding: 0.35rem 0.9rem;
    border: 2px solid var(--c);
    border-radius: 999px;
    opacity: 0.55;
  }
  .writers li.done {
    background: var(--c);
    color: #121211;
    opacity: 1;
  }
  .entries {
    flex-direction: column;
  }
  .entries li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--line2);
    font-size: 1.4rem;
  }
  .votes {
    display: flex;
    gap: 0.3rem;
    flex: none;
  }
  .votes i {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: var(--c);
  }
  .winner {
    margin: 0;
    font: 700 2.2rem / 1.15 var(--display);
  }
  .by {
    margin: 0;
    color: var(--dim);
    border-left: 6px solid var(--c);
    padding-left: 0.6rem;
  }
  .dim {
    margin: 0;
    color: var(--dim);
    font-size: 1.2rem;
  }
</style>
