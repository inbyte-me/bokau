<!-- After "Start the round": while the script is written, what the server is doing; then the cast, revealed one by one. -->
<script lang="ts">
  import { isImprovMode, type PartyCharacter, playerColor } from '@doblaje/party';
  import { GAMES } from '@doblaje/party-ui/games';
  import { fmtClock } from '@doblaje/ui';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const game = $derived(GAMES().find((g) => g.mode === room?.settings.mode));
  const lines = $derived(room ? Number(room.prepNote) || room.queue.length : 0);
  // one row per player, with every character they voice (the slice deals them evenly)
  const byPlayer = $derived.by(() => {
    if (!room) return [];
    const rows = new Map<string, { playerId: string; name: string; characters: PartyCharacter[] }>();
    for (const role of room.cast) {
      const c = room.characters.find((x) => x.id === role.characterId);
      const row = rows.get(role.playerId) ?? { playerId: role.playerId, name: room.players.find((x) => x.id === role.playerId)?.name ?? '?', characters: [] };
      if (c) row.characters.push(c);
      rows.set(role.playerId, row);
    }
    return [...rows.values()];
  });
</script>

{#if room}
  {#if room.preparing}
    <StepScreen title={t('Getting the round ready')} lead={game ? `${game.title} · ${room.clip?.name ?? ''}` : ''} id="preparing">
      <ol class="checklist" aria-live="polite">
        <li class="done">
          <Icon name="check" /><span
            >{t('Scene: {from} to {to}', { from: fmtClock(room.slice?.start ?? 0), to: fmtClock(room.slice?.end ?? 0) })}</span
          >
        </li>
        <li class="done"><Icon name="check" /><span>{t('Cast: {n} players', { n: room.cast.length })}</span></li>
        <li class="running">
          <span class="spinner" aria-hidden="true"></span><span>{t('Writing {n} lines for {game}…', { n: lines, game: game?.title ?? '' })}</span>
        </li>
      </ol>
      <div class="bar" role="progressbar" aria-label={t('Writing the script…')}><i></i></div>
      <p class="hint">{t('The AI writes the lines when it is available; otherwise they are made on this computer. It takes a few seconds.')}</p>
    </StepScreen>
  {:else}
    <StepScreen title={t('The cast')} lead={t('Look at your phone: it shows your part. Everyone else, headphones on when someone records.')} id="casting">
      <ul class="reveal" id="cast-list">
        {#each byPlayer as part, i (part.playerId)}
          <li style:--c={playerColor(room, part.playerId)} style:--i={i}>
            <span class="player">{part.name}</span>
            {#if !isImprovMode(room.settings.mode)}
              <span class="as">{t('as')}</span>
              {#each part.characters as c (c.id)}
                <span class="role"
                  ><CharacterTag name={c.name} color={c.color} size="big" />{#if c.card}<span class="card">{c.card}</span>{/if}</span
                >
              {/each}
            {:else if room.settings.mode === 'trailer'}
              {#each part.characters as c (c.id)}
                <span class="role"
                  ><CharacterTag name={c.name} color={c.color} size="big" />{#if c.card}<span class="card">{c.card}</span>{/if}</span
                >
              {/each}
              <span class="as">{t('{n} scenes', { n: part.characters.reduce((a, c) => a + c.lines, 0) })}</span>
            {:else}
              <span class="as">{t('{n} turns', { n: part.characters.reduce((a, c) => a + c.lines, 0) })}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#snippet actions()}
        <button class="ghost" onclick={() => host.send({ type: 'again' })}>{t('Back')}</button>
        <button class="primary big-btn" id="begin" onclick={() => host.send({ type: 'begin' })}>{t('Start')}</button>
      {/snippet}
    </StepScreen>
  {/if}
{/if}

<style>
  .checklist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    font-size: 1.5rem;
  }
  .checklist li {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .checklist li.done {
    color: var(--dim);
  }
  .checklist li.done :global(.ic) {
    color: var(--ok);
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    border: 2px solid var(--line2);
    border-top-color: var(--cue);
  }
  .bar {
    height: 4px;
    width: min(640px, 100%);
    background: var(--panel3);
    overflow: hidden;
    margin-top: 1.2rem;
  }
  .bar i {
    display: block;
    height: 100%;
    width: 30%;
    background: var(--cue);
  }
  .hint {
    color: var(--faint);
  }
  .reveal {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .reveal li {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.4rem 0 0.4rem 1rem;
    border-left: 6px solid var(--c);
  }
  .player {
    font-family: var(--display);
    font-size: 2.6rem;
    font-weight: 700;
  }
  .role {
    display: inline-flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .card {
    color: var(--dim);
    font-size: 1.1rem;
    max-width: 28rem;
  }
  .as {
    color: var(--faint);
    font-size: 1.3rem;
  }
  @media (prefers-reduced-motion: no-preference) {
    .spinner {
      animation: spin 0.9s linear infinite;
    }
    .bar i {
      animation: sweep 1.4s ease-in-out infinite;
    }
    .reveal li {
      animation: reveal 0.5s ease-out both;
      animation-delay: calc(var(--i) * 0.6s);
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes sweep {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(340%);
      }
    }
    @keyframes reveal {
      from {
        opacity: 0;
        transform: translateX(-16px);
      }
    }
  }
</style>
