<!-- Mix tab: the original audio's level and source, auto-ducking, the ghost guide in the headphones, lip-flap markers,
     and display settings (band speed, karaoke line, picture delay). Sliders update live and commit on release. -->
<script lang="ts">
  import { detectFlaps, rmsEnvelope } from '@doblaje/audio';
  import type { Project } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../../app.svelte.ts';
  import Slider from '../../../components/Slider.svelte';
  import { store } from '../../../store.svelte.ts';
  import { getStudio } from '../studio.svelte.ts';

  const studio = getStudio();
  const mix = $derived(
    store.read(['levels', 'media'], (p) => ({ original: structuredClone(p.original), ducking: { ...p.ducking }, ready: p.stems.status === 'ready' }), null),
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const ms = (v: number) => `${Math.round(v * 1000)} ms`;

  /** a committed change of the mix (one undo step), then the graph is rebuilt */
  function change(label: string, fn: (p: Project) => void, rebuild = true) {
    store.commit(label, fn, ['levels']);
    if (rebuild) void app.engine.refresh();
    else app.engine.applyLevels();
  }
  /** while dragging: change the live level only (no undo step yet) */
  function live(fn: (p: Project) => void) {
    fn(store.project);
    app.engine.applyLevels();
  }

  function autoFlaps() {
    const A = app.engine.assets;
    const buf = A?.dialogue || A?.orig;
    if (!A || !buf) return;
    const flaps = detectFlaps(rmsEnvelope(buf, 100));
    if (!flaps.length) return toast(t('No speech found to derive mouth movements from'), 'error');
    store.commit(
      'Auto lip flaps',
      (p) => {
        p.lipFlaps = flaps;
      },
      ['flaps'],
    );
    toast(t('{n} mouth-open markers', { n: flaps.length }) + (A.dialogue ? '' : ` · ${t('tip: separate dialogue first for a cleaner result')}`), 'ok');
  }
</script>

{#if mix}
  <div class="col">
    <div class="box">
      <h4>{t('Original audio')}</h4>
      <Slider
        label={t('Volume')}
        id="orig-vol"
        min={0}
        max={1.5}
        step={0.01}
        value={mix.original.volume}
        format={pct}
        oninput={(v) => live((p) => {
p.original.volume = v;
})}
        onchange={(v) => change('Original volume', (p) => {
p.original.volume = v;
}, false)}
      />
      <div class="field">
        <label for="orig-source">{t('Play')}</label>
        <select
          id="orig-source"
          disabled={!mix.ready}
          value={mix.original.source}
          onchange={(e) => {
            const v = e.currentTarget.value as Project['original']['source'];
            change('Original source', (p) => {
p.original.source = v;
});
          }}
        >
          <option value="full">{t('Full mix')}</option>
          <option value="bg">{t('Music + SFX only (actors silenced)')}</option>
          <option value="dialogue">{t('Dialogue only')}</option>
        </select>
      </div>
    </div>

    <div class="box">
      <h4>{t('Auto-ducking')}</h4>
      <label class="row"
        ><input
          id="duck-on"
          type="checkbox"
          checked={mix.ducking.enabled}
          onchange={(e) => {
            const on = e.currentTarget.checked;
            change('Ducking', (p) => {
p.ducking.enabled = on;
});
          }}
        />{t('Lower the background when I speak')}</label
      >
      <Slider
        label={t('Reduction')}
        id="duck-db"
        min={-30}
        max={-3}
        step={1}
        value={mix.ducking.db}
        format={(v) => `${v} dB`}
        onchange={(v) => change('Ducking depth', (p) => {
p.ducking.db = v;
})}
      />
      <Slider
        label={t('Attack')}
        id="duck-atk"
        min={0.01}
        max={0.3}
        step={0.01}
        value={mix.ducking.attack}
        format={ms}
        onchange={(v) => change('Ducking attack', (p) => {
p.ducking.attack = v;
})}
      />
      <Slider
        label={t('Release')}
        id="duck-rel"
        min={0.05}
        max={1.5}
        step={0.05}
        value={mix.ducking.release}
        format={ms}
        onchange={(v) => change('Ducking release', (p) => {
p.ducking.release = v;
})}
      />
      <div class="hint">{t('The green line on the original-audio lane shows the ducking envelope.')}</div>
    </div>

    <div class="box">
      <h4>{t('Ghost audio guide')}</h4>
      <label class="row"
        ><input
          id="ghost-on"
          type="checkbox"
          checked={mix.original.ghost.enabled}
          onchange={(e) => {
            const on = e.currentTarget.checked;
            change('Ghost guide', (p) => {
p.original.ghost.enabled = on;
});
          }}
        />{t('Play the original dialogue in my headphones')}</label
      >
      <Slider
        label={t('Level')}
        id="ghost-level"
        min={0}
        max={1}
        step={0.01}
        value={mix.original.ghost.level}
        format={pct}
        oninput={(v) => live((p) => {
p.original.ghost.level = v;
})}
        onchange={(v) => change('Ghost level', (p) => {
p.original.ghost.level = v;
}, false)}
      />
      <div class="field">
        <label for="ghost-pan">{t('Ear')}</label>
        <select
          id="ghost-pan"
          value={String(mix.original.ghost.pan)}
          onchange={(e) => {
            const v = Number(e.currentTarget.value);
            change('Ghost pan', (p) => {
p.original.ghost.pan = v;
}, false);
          }}
        >
          <option value="-1">{t('Left ear only')}</option>
          <option value="1">{t('Right ear only')}</option>
          <option value="0">{t('Both ears')}</option>
        </select>
      </div>
      <div class="hint">
        {t('Headphones only. The guide is never part of the export. With separated stems the music bed plays normally and the dialogue is the ghost.')}
      </div>
    </div>

    <div class="box">
      <h4>{t('Lip-flap markers')}</h4>
      <div class="row">
        <button id="flaps-auto" onclick={autoFlaps}><Icon name="wave" />{t('Auto-detect from dialogue')}</button>
        <button id="flaps-clear" onclick={() => store.commit('Clear flaps', (p) => {
p.lipFlaps = [];
}, ['flaps'])}>{t('Clear')}</button>
      </div>
      <div class="hint">
        {t("Manual: hold the M key while the character's mouth is open (while playing). Or drag in the Lip flaps lane. Pink bars show when to speak; red line = now.")}
      </div>
    </div>

    <div class="box">
      <h4>{t('Display')}</h4>
      {#if studio.band}
        {@const band = studio.band}
        <Slider label={t('Band speed')} id="band-speed" min={80} max={420} step={10} value={band.pps} format={(v) => `${v} px/s`} oninput={(v) => band.setSpeed(v)} />
      {/if}
      <label class="row"
        ><input id="banner-on" type="checkbox" checked={studio.banner} onchange={(e) => studio.toggleBanner(e.currentTarget.checked)} />{t(
          'Show karaoke subtitles on the video',
        )}</label
      >
      <Slider
        label={t('Picture delay')}
        id="av-offset"
        min={-200}
        max={400}
        step={5}
        value={Math.round(app.engine.avOffset * 1000)}
        format={(v) => `${v} ms`}
        oninput={(v) => (app.engine.avOffset = v / 1000)}
      />
      <div class="hint">{t('If the TV adds lag (HDMI/Bluetooth), nudge the picture delay until lips match the sound.')}</div>
    </div>
  </div>
{/if}
