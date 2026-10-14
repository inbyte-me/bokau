<!-- Who is in the room: a tile per player in their colour; new ones slide in. Right-click a player to remove them. -->
<script lang="ts">
  import { playerColor, type Room } from '@doblaje/party';
  import { registerMenu } from '@doblaje/ui';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy } from 'svelte';
  import { getHost } from './host.svelte.ts';

  interface Props {
    room: Room;
    size?: 'big' | 'small';
  }
  let { room, size = 'big' }: Props = $props();
  const host = getHost();

  const off = registerMenu('.player-tile[data-player]', (el) => {
    const id = (el as HTMLElement).dataset.player ?? '';
    const name = room.players.find((p) => p.id === id)?.name ?? '';
    return [{ label: t('Remove {name} from the room', { name }), icon: 'close', run: () => host.send({ type: 'kick', playerId: id }) }];
  });
  onDestroy(off);
</script>

<ul class={['players', size]} id="players">
  {#each room.players as p (p.id)}
    <li class={['player-tile', !p.connected && 'away']} data-player={p.id} style:--c={playerColor(room, p.id)} title={p.connected ? '' : t('Disconnected')}>
      <span class="initial" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
      <span class="name">{p.name}</span>
    </li>
  {:else}
    <li class="empty">{t('Nobody yet')}</li>
  {/each}
</ul>

<style>
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .player-tile {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.9rem 0.45rem 0.45rem;
    border: 1px solid var(--line2);
    border-left: 4px solid var(--c);
    border-radius: 3px;
    background: var(--panel2);
  }
  .big .player-tile {
    font-size: 1.35rem;
    padding: 0.6rem 1.2rem 0.6rem 0.6rem;
  }
  .initial {
    width: 1.8em;
    height: 1.8em;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--c);
    color: #121211;
    font-weight: 700;
  }
  .small .initial {
    width: 1.6em;
    height: 1.6em;
  }
  .player-tile.away {
    opacity: 0.45;
  }
  .empty {
    color: var(--faint);
  }
  @media (prefers-reduced-motion: no-preference) {
    .player-tile {
      animation: join 0.35s ease-out;
    }
    @keyframes join {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
  }
</style>
