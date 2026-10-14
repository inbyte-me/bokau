<!-- Step 2: which game, with how a turn goes, and the game's own options (premise, genre, language, suggestions). -->
<script lang="ts">
  import type { RoomSettings } from '@doblaje/party';
  import LanguageSelect from '@doblaje/party-ui/components/LanguageSelect.svelte';
  import { GAMES } from '@doblaje/party-ui/games';
  import { t } from '@doblaje/ui/i18n';
  import { getHost } from './host.svelte.ts';
  import StepScreen from './StepScreen.svelte';

  const host = getHost();
  const s = $derived(host.room?.settings ?? null);
  const set = (settings: Partial<RoomSettings>) => host.send({ type: 'settings', settings });
  const games = GAMES();
  const game = $derived(games.find((g) => g.mode === s?.mode) ?? games[0]);
  const PREMISES = [
    t('two people arguing about lost cheese'),
    t('a cooking show where everything catches fire'),
    t('a dramatic breakup over a WiFi password'),
    t('two spies who forgot the secret code'),
    t('a nature documentary about a very lazy cat'),
  ];
  const GENRES: [string, string][] = [
    ['noir', t('Noir Detective')],
    ['pirate', t('Pirate Swashbuckler')],
    ['corporate', t('Bad Corporate Speak')],
    ['action80s', t('80s Action Movie')],
  ];
  let premise = $derived(s?.premise ?? '');
  const lead = $derived(host.room?.clip ? t('Scene: {name}', { name: host.room.clip.name }) : '');
  const written = $derived(s?.mode === 'badlip' || s?.mode === 'telenovela' || s?.mode === 'genre');

  /** Up/Down moves between games (presenter clicker friendly) */
  function keys(e: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = games.findIndex((g) => g.mode === s?.mode) + (e.key === 'ArrowDown' ? 1 : -1);
    const next = games[(i + games.length) % games.length];
    set({ mode: next.mode });
    e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next.mode}"]`)?.focus();
  }
</script>

{#if s}
  <StepScreen title={t('Choose the game')} {lead}>
    <div class="layout">
      <!-- svelte-ignore a11y_interactive_supports_focus: the radio buttons inside take focus -->
      <div class="games" role="radiogroup" aria-label={t('Game')} tabindex="-1" onkeydown={keys}>
        {#each games as g (g.mode)}
          <button class={['game', s.mode === g.mode && 'sel']} data-mode={g.mode} role="radio" aria-checked={s.mode === g.mode} onclick={() => set({ mode: g.mode })}>
            <span class="k">{g.key}</span>
            <span class="text">
              <span class="title">{g.title}</span>
              <span class="pitch">{g.pitch}</span>
            </span>
          </button>
        {/each}
      </div>
      <div class="detail">
        <h2>{t('How it plays')}</h2>
        <ol class="how">
          {#each game.how as line, i (i)}<li>{line}</li>{/each}
        </ol>
        <LanguageSelect
          value={s.language}
          onchange={(language) => set({ language })}
          help={written
            ? t('The lines are written in it, and the phones hear what each player said in it.')
            : s.mode === 'trailer'
              ? t('The title cards and the AI’s ideas are written in it, and the phones hear what each player said in it.')
              : t('The phones hear what each player said in it, whatever the language of the scene.')}
        />
        {#if s.mode === 'badlip'}
          <label class="field"
            >{t('What are they really talking about?')}
            <input id="premise" type="text" bind:value={premise} onchange={() => set({ premise })} maxlength="160" /></label
          >
          <div class="chips">
            {#each PREMISES as p (p)}<button class={['chip', s.premise === p && 'on']} onclick={() => set({ premise: p })}>{p}</button>{/each}
          </div>
        {:else if s.mode === 'genre'}
          <div class="chips" role="radiogroup" aria-label={t('Genre')}>
            {#each GENRES as [v, l] (v)}
              <button class={['chip', s.genre === v && 'on']} role="radio" aria-checked={s.genre === v} data-genre={v} onclick={() => set({ genre: v })}>{l}</button>
            {/each}
          </div>
        {/if}
        {#if s.mode !== 'blind' && s.mode !== 'trailer'}
          <label class="check"
            ><input id="cards" type="checkbox" checked={s.cards} onchange={(e) => set({ cards: e.currentTarget.checked })} />
            {t('Describe the characters first')}</label
          >
          <span class="small dim">{t('Each player writes a character’s voice and personality before the cast is revealed, and the card follows the character.')}</span>
        {/if}
        {#if s.mode === 'dub'}
          <label class="check"
            ><input type="checkbox" checked={s.suggestions} onchange={(e) => set({ suggestions: e.currentTarget.checked })} />
            {t('Suggest funny lines (AI)')}</label
          >
        {/if}
      </div>
    </div>
    {#snippet actions()}
      <button class="ghost" onclick={() => (host.step = 'scene')}>{t('Back')}</button>
      <button class="primary big-btn" id="to-players" onclick={() => (host.step = 'players')}>{t('Next: invite players')}</button>
    {/snippet}
  </StepScreen>
{/if}


<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 2rem;
    align-items: start;
  }
  .games {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line2);
  }
  .game {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
    gap: 1rem;
    text-align: left;
    padding: 0.9rem 0.6rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line2);
    border-radius: 0;
    min-height: 0;
  }
  .game:hover {
    background: var(--panel);
  }
  .game.sel {
    background: var(--panel2);
    box-shadow: inset 6px 0 0 var(--signal);
  }
  .k {
    font-family: var(--display);
    font-size: 2rem;
    font-weight: 700;
    color: var(--faint);
    width: 1.4em;
    line-height: 1;
  }
  .game.sel .k {
    color: var(--signal-text);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .title {
    font-family: var(--display);
    font-size: 1.6rem;
    font-weight: 700;
  }
  .pitch {
    color: var(--dim);
    font-size: 1rem;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1.2rem 1.4rem;
    border: 1px solid var(--line2);
    border-radius: 4px;
    background: var(--panel);
  }
  h2 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
  }
  .how {
    margin: 0;
    padding-left: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 1.15rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: var(--dim);
  }
  .field input {
    color: var(--text);
    font-size: 1.1rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip.on {
    border-color: var(--signal);
    color: var(--text);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  @media (max-width: 999px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
