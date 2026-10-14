<!-- The trailer's cards on the TV: white type on the black gaps between scenes, fading in and out. The same cards are
     subtitles in the result's project, so the studio and exports show them too. -->
<script lang="ts">
  import type { TrailerCard } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';

  interface Props {
    cards: TrailerCard[];
    /** the show's time, seconds */
    time: number;
  }
  let { cards, time }: Props = $props();
  const FADE = 0.4;
  const card = $derived(cards.find((c) => time >= c.at && time < c.at + c.seconds));
  const opacity = $derived(card ? Math.max(0, Math.min(1, (time - card.at) / FADE, (card.at + card.seconds - time) / FADE)) : 0);
</script>

{#if card}
  <div class="card" data-kind={card.kind} style:opacity role="status">
    {#if card.kind === 'opening'}<p class="kicker">{t('This summer')}</p>{/if}
    {#if card.kind === 'critic'}
      <p class="quote">“{card.text}”</p>
      <p class="by">{[card.by, card.sub].filter(Boolean).join(' · ')}</p>
    {:else}
      <p class={['text', card.kind]}>{card.text}</p>
      {#if card.sub}<p class="tagline">{card.sub}</p>{/if}
      {#if card.kind === 'title'}<p class="soon">{t('Coming soon')}</p>{/if}
    {/if}
  </div>
{/if}

<style>
  .card {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    padding: 8%;
    text-align: center;
    color: #f4f1ea;
    pointer-events: none;
  }
  p {
    margin: 0;
  }
  .kicker,
  .soon,
  .by {
    text-transform: uppercase;
    letter-spacing: 0.3em;
    font-size: clamp(0.8rem, 1.6vw, 1.3rem);
    color: #b9b4a8;
  }
  .text {
    font: 700 clamp(1.8rem, 5vw, 4.2rem) / 1.1 var(--display);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .text.title {
    font-size: clamp(3rem, 9vw, 8rem);
    letter-spacing: 0.08em;
  }
  .tagline {
    font-size: clamp(1rem, 2.2vw, 1.8rem);
    font-style: italic;
    color: #d8d3c6;
  }
  .quote {
    font: italic 600 clamp(1.8rem, 4.6vw, 3.8rem) / 1.15 Georgia, 'Times New Roman', serif;
  }
</style>
