<!-- Before the cast is revealed: each character is described on a phone (voice and personality), blind to who will
     play them. The TV shows who is still writing; the words stay on the phones until the cast is revealed. -->
<script lang="ts">
  import { playerColor } from '@doblaje/party';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const rows = $derived(
    room
      ? room.contests
          .filter((c) => c.kind === 'card')
          .map((c) => {
            const character = room.characters.find((x) => x.id === c.subject);
            const writer = room.players.find((p) => p.id === c.who[0]);
            return { id: c.id, character, writer, done: c.text !== null || c.entries.length > 0, color: writer ? playerColor(room, writer.id) : '#888' };
          })
      : [],
  );
  const deadline = $derived(room?.contests.find((c) => c.kind === 'card')?.deadline ?? 0);
</script>

{#if room}
  <StepScreen title={t('Create the characters')} lead={t('Each player describes one character on their phone: how they sound and what they are like. Nobody knows who will play them.')} id="cards">
    <ul class="rows">
      {#each rows as r (r.id)}
        <li class={[r.done && 'done']} style:--c={r.color}>
          {#if r.character}<CharacterTag name={r.character.name} color={r.character.color} size="big" />{/if}
          <span class="writer">{r.writer?.name ?? '?'}</span>
          <span class="state">{r.done ? t('Written') : t('Writing…')}</span>
        </li>
      {/each}
    </ul>
    {#if deadline}<p class="timer"><Countdown {deadline} skew={host.state?.skew ?? 0} /></p>{/if}
  </StepScreen>
{/if}

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  li {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0.5rem 0 0.5rem 1rem;
    border-left: 6px solid var(--c);
    font-size: 1.5rem;
    opacity: 0.7;
  }
  li.done {
    opacity: 1;
  }
  .writer {
    font-family: var(--display);
    font-weight: 700;
  }
  .state {
    color: var(--dim);
  }
  .timer {
    margin: 0;
    font-size: 2.4rem;
  }
</style>
