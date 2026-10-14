<!-- Latency compensation for the open project: takes are placed earlier by the round trip, so the voice lines up with
     what you saw and heard. Auto-calibrate plays clicks and listens for them. -->
<script lang="ts">
  import { calibrateLatency } from '@doblaje/audio';
  import { errorMessage } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../app.svelte.ts';
  import { openMic } from '../../shell/mic.svelte.ts';
  import { store } from '../../store.svelte.ts';

  const saved = $derived(store.read(['settings'], (p) => p.latencyMs, null));
  let busy = $state(false);
  let say = $state('');

  /** live while dragging (no undo step), one undo step on release */
  function drag(ms: number) {
    store.silent(
      (p) => {
        p.latencyMs = ms;
      },
      ['settings'],
    );
  }
  async function calibrate() {
    if (!app.mic.isOpen && !(await openMic())) return;
    busy = true;
    say = t('Playing test clicks… keep the room quiet. The mic must be able to hear the speakers/headphones.');
    try {
      const r = await calibrateLatency(app.engine, app.mic);
      if (r.ms == null || !r.ok) {
        say = t('Could not hear the clicks reliably. Turn the volume up, put the headphones next to the mic (or use speakers) and try again.');
        return;
      }
      const ms = Math.round(r.ms);
      store.commit(
        'Latency',
        (p) => {
          p.latencyMs = ms;
        },
        ['settings'],
      );
      say = t('Measured round-trip latency: {ms} ms (applied).', { ms });
    } catch (e) {
      say = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if saved !== null}
  <div class="box">
    <h4>{t('Latency compensation')}</h4>
    <div class="slider">
      <label for="latency">{t('Round trip')}</label>
      <input
        id="latency"
        type="range"
        min="0"
        max="600"
        step="1"
        value={saved}
        oninput={(e) => drag(Number(e.currentTarget.value))}
        onchange={() => store.commit('Latency', () => {}, ['settings'], { merge: true })}
      />
      <span class="v" id="lat-val">{saved} ms</span>
    </div>
    <div class="row"><button id="calibrate" disabled={busy} onclick={calibrate}><Icon name="clock" />{t('Auto-calibrate')}</button></div>
    <div class="hint" id="cal-out">{say}</div>
    <div class="hint">
      {t(
        'Recorded clips are placed earlier by this amount so your voice lines up with what you saw and heard. USB interfaces ≈ 15–40 ms, Bluetooth headphones 150–300 ms.',
      )}
    </div>
  </div>
{/if}
