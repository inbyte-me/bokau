<!-- Always on screen during a party: where we are, and how to join (code, address, a small QR), like a TV show's
     on-screen bug. Before a round it also shows the setup steps. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import { getHost, type SetupStep } from './host.svelte.ts';
  import QrCode from './QrCode.svelte';

  const host = getHost();
  const room = $derived(host.room);
  const joinUrl = $derived(host.view?.joinUrl ?? '');
  // shown as "192.168.0.35:5178/play" without the scheme and the query
  const shortUrl = $derived(joinUrl.replace(/^https?:\/\//, '').replace(/\/?\?.*$/, ''));
  const STEPS: [SetupStep, string][] = [
    ['scene', t('Scene')],
    ['game', t('Game')],
    ['players', t('Players')],
  ];
  const order = (s: SetupStep) => STEPS.findIndex(([k]) => k === s);
  const reachable = (s: SetupStep) => s === 'scene' || !!room?.clip;
</script>

<header class="room-header">
  <div class="where">
    <span class="title">{t('Party room')}</span>
    {#if room?.phase === 'lobby'}
      <ol class="steps" aria-label={t('Setup')}>
        {#each STEPS as [id, label], i (id)}
          <li>
            <button
              class={['step', host.step === id && 'cur', order(host.step) > i && 'done']}
              aria-current={host.step === id ? 'step' : undefined}
              disabled={!reachable(id)}
              onclick={() => (host.step = id)}><span class="n">{i + 1}</span>{label}</button
            >
          </li>
        {/each}
      </ol>
    {/if}
  </div>
  {#if room}
    <div class="join">
      <div class="how">
        <div class="small dim">{t('Join on your phone')}</div>
        <div class="url mono" id="join-url" title={joinUrl}>{shortUrl}</div>
      </div>
      <div class="count" title={room.players.map((p) => p.name).join(', ')}>
        <span class="n" id="player-count">{room.players.filter((p) => p.connected).length}</span>
        <span class="small dim">{t('players')}</span>
      </div>
      <div class="code" id="room-code" aria-label={t('Room code')}>{room.code}</div>
      {#if joinUrl}<div class="mini-qr"><QrCode url={joinUrl} label={t('QR code to join')} /></div>{/if}
    </div>
  {/if}
</header>

<style>
  .room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.8rem 3rem;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    flex-wrap: wrap;
  }
  .title {
    font-family: var(--display);
    font-size: 1.6rem;
    font-weight: 700;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.3rem;
  }
  .step {
    background: transparent;
    border: 1px solid transparent;
    color: var(--dim);
    font-size: 1rem;
    gap: 0.5rem;
  }
  .step .n {
    width: 1.5em;
    height: 1.5em;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--line2);
    font-size: 0.85em;
  }
  .step.cur {
    color: var(--text);
    border-color: var(--line2);
  }
  .step.cur .n {
    background: var(--signal);
    border-color: var(--signal);
    color: #fff;
  }
  .step.done .n {
    border-color: var(--ok);
    color: var(--ok);
  }
  .join {
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }
  .how {
    text-align: right;
  }
  .url {
    font-size: 1.05rem;
  }
  .code {
    font-family: var(--mono);
    font-size: 2.4rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: var(--cue);
    line-height: 1;
  }
  .count {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }
  .count .n {
    font-family: var(--display);
    font-size: 1.8rem;
    font-weight: 700;
  }
  .mini-qr {
    width: 64px;
  }
  :global(html.tv) .room-header {
    padding: 1rem 5%;
  }
</style>
