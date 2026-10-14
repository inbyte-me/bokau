<!-- Step 3: everyone joins on their phone. A big QR, the steps to join, the players as they arrive, the round's rules,
     and the button that starts the round. -->
<script lang="ts">
  import type { RoomSettings } from '@doblaje/party';
  import { GAMES } from '@doblaje/party-ui/games';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';
  import Players from './Players.svelte';
  import QrCode from './QrCode.svelte';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const s = $derived(room?.settings ?? null);
  const set = (settings: Partial<RoomSettings>) => host.send({ type: 'settings', settings });
  const game = $derived(GAMES().find((g) => g.mode === s?.mode));
  const trailer = $derived(s?.mode === 'trailer');
  /** people the game needs before it can start */
  const needed = $derived(trailer ? 2 : 1);
  const joinUrl = $derived(host.view?.joinUrl ?? '');
  const shortUrl = $derived(joinUrl.replace(/^https?:\/\//, '').replace(/\?room=.*$/, ''));
  const lead = $derived(room?.clip && game ? `${game.title} · ${room.clip.name}` : '');
</script>

{#if room && s}
  <StepScreen title={t('Everyone joins on their phone')} {lead} id="invite">
    <div class="layout">
      <div class="qr-side">
        <div class="qr-box"><QrCode url={joinUrl} label={t('QR code to join')} /></div>
        <div class="code-line">
          <span class="dim">{t('Room code')}</span>
          <span class="code">{room.code}</span>
        </div>
      </div>
      <div class="info">
        <ol class="join-steps">
          <li>{t('Connect your phone to this Wi-Fi.')}</li>
          <li>{t('Scan the code with the camera, or open {url} and type the room code.', { url: shortUrl })}</li>
          <li>{t('If the phone warns about the connection, choose to continue: it is this computer’s own certificate.')}</li>
          <li>{t('Keep your headphones at hand. Nobody hears anyone’s lines until the show.')}</li>
        </ol>
        <h2>{t('Players ({n})', { n: room.players.length })}</h2>
        <Players {room} />
        <details class="rules">
          <summary
            >{t('Rules')}:
            {#if trailer}{t('{n} scenes', { n: s.scenes })} · {t('{n} s per scene', { n: s.turnSeconds })}{:else}{s.maxCast >= 8 ? t('everyone plays') : t('{n} people', { n: s.maxCast })} · {s.mode === 'blind'
                ? t('{n} turns', { n: s.maxLines })
                : t('{n} lines', { n: s.maxLines })} · {t('{n} s per line', { n: s.turnSeconds })}{/if}</summary
          >
          <div class="rule-grid">
            {#if !trailer}
            <label
              >{t('People per round')}
              <select value={s.maxCast} onchange={(e) => set({ maxCast: Number(e.currentTarget.value) })}>
                <option value={8}>{t('Everyone')}</option>
                {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={n}>{t('{n} people', { n })}</option>{/each}
              </select></label
            >
            <label
              >{s.mode === 'blind' ? t('Turns') : t('Lines')}
              <select value={s.maxLines} onchange={(e) => set({ maxLines: Number(e.currentTarget.value) })}>
                {#each [4, 8, 12, 20, 40] as n (n)}<option value={n}>{n}</option>{/each}
              </select></label
            >
            {/if}
            {#if trailer}
              <label
                >{t('Scenes')}
                <select id="scenes" value={s.scenes} onchange={(e) => set({ scenes: Number(e.currentTarget.value) })}>
                  {#each [2, 4, 6, 8, 12] as n (n)}<option value={n}>{n}</option>{/each}
                </select></label
              >
            {/if}
            <label
              >{trailer ? t('Time per scene') : t('Time per line')}
              <select value={s.turnSeconds} onchange={(e) => set({ turnSeconds: Number(e.currentTarget.value) })}>
                {#each [20, 40, 60, 90] as n (n)}<option value={n}>{t('{n} s', { n })}</option>{/each}
              </select></label
            >
            {#if !trailer}
            <label
              >{t('Scene length')}
              <select value={s.sliceSeconds} onchange={(e) => set({ sliceSeconds: Number(e.currentTarget.value) })}>
                {#each [30, 45, 60, 90, 600] as n (n)}<option value={n}>{n >= 600 ? t('Whole clip') : t('{n} s', { n })}</option>{/each}
              </select></label
            >
            {#if s.mode !== 'blind'}
              <label
                >{t('Order')}
                <select value={s.order} onchange={(e) => set({ order: e.currentTarget.value === 'shuffle' ? 'shuffle' : 'scene' })}>
                  <option value="scene">{t('Scene order')}</option>
                  <option value="shuffle">{t('Shuffled')}</option>
                </select></label
              >
            {/if}
            {/if}
          </div>
        </details>
        <a class="test-phones" href={`/play/grid.html?room=${room.code}&n=4`} target="_blank" rel="noopener">{t('Test with phones on this computer')}</a>
      </div>
    </div>
    {#snippet actions()}
      <button class="ghost" onclick={() => (host.step = 'game')}>{t('Back')}</button>
      <button class="primary big-btn" id="cast" disabled={host.connected < needed} onclick={() => host.send({ type: 'cast' })}>
        {host.connected >= needed ? t('Start the round') : t('Waiting for players')}
      </button>
    {/snippet}
  </StepScreen>
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(220px, 32vh) minmax(0, 1fr);
    gap: 2.5rem;
    align-items: start;
  }
  .qr-side {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .qr-box {
    padding: 0.6rem;
    background: #ebe9e4;
    border-radius: 6px;
  }
  .code-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  .code {
    font-family: var(--mono);
    font-size: 2.6rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--cue);
  }
  .dim {
    color: var(--dim);
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .join-steps {
    margin: 0;
    padding-left: 1.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 1.25rem;
  }
  h2 {
    margin: 0.6rem 0 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .rules summary {
    cursor: pointer;
    color: var(--dim);
  }
  .rule-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.2rem;
    margin-top: 0.6rem;
  }
  .rule-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    color: var(--dim);
    font-size: 0.9rem;
  }
  .test-phones {
    color: var(--dim);
    font-size: 0.9rem;
  }
  @media (max-width: 999px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .qr-side {
      max-width: 320px;
    }
  }
</style>
