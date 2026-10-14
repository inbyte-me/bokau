<!-- /play/grid.html?room=ABCD&n=4 : several phones on one computer, each frame its own player (seat). For trying a
     game without real phones; every frame records from this computer's microphone. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';

  const params = new URLSearchParams(location.search);
  let room = $state((params.get('room') ?? '').toUpperCase());
  let n = $state(Math.min(8, Math.max(1, Number(params.get('n')) || 4)));
  const seats = $derived(Array.from({ length: n }, (_, i) => i + 1));
</script>

<div class="grid-page">
  <header>
    <span class="brand"><span class="dot"></span>{t('Test phones')}</span>
    <label>{t('Room')} <input bind:value={room} maxlength="4" class="code small" /></label>
    <label>{t('Phones')} <input type="number" min="1" max="8" bind:value={n} class="small" /></label>
  </header>
  <div class="frames">
    {#each seats as seat (seat)}
      <iframe title={t('Phone {n}', { n: seat })} src={`/play/?room=${room}&seat=${seat}`} allow="microphone; autoplay"></iframe>
    {/each}
  </div>
</div>
