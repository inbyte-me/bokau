<!-- What happens when you record: the count-in, its beeps, and whether the original plays meanwhile. -->
<script lang="ts">
  import type { Project } from '@doblaje/core';
  import { t } from '@doblaje/ui/i18n';
  import { store } from '../../../store.svelte.ts';

  const s = $derived(store.read(['settings'], (p) => ({ ...p.settings }), null));
  const set = (label: string, fn: (p: Project) => void) => store.commit(label, fn, ['settings']);
</script>

{#if s}
  <div class="box" id="rec-box">
    <h4>{t('Recording setup')}</h4>
    <div class="slider">
      <label for="preroll">{t('Count-in')}</label>
      <input
        id="preroll"
        type="range"
        min="0"
        max="5"
        step="1"
        value={s.preRoll}
        onchange={(e) => {
          const v = Number(e.currentTarget.value);
          set('Pre-roll', (p) => {
p.settings.preRoll = v;
});
        }}
      />
      <span class="v">{s.preRoll ? `${s.preRoll} s` : t('off')}</span>
    </div>
    <label class="row small"
      ><input
        id="beep"
        type="checkbox"
        checked={s.preRollBeep}
        onchange={(e) => {
          const on = e.currentTarget.checked;
          set('Beep', (p) => {
p.settings.preRollBeep = on;
});
        }}
      />{t('Audible 3-2-1-BEEP')}</label
    >
    <label class="row small"
      ><input
        id="mute-orig-rec"
        type="checkbox"
        checked={s.muteOriginalWhileRecording}
        onchange={(e) => {
          const on = e.currentTarget.checked;
          set('Mute original', (p) => {
p.settings.muteOriginalWhileRecording = on;
});
        }}
      />{t('Mute original audio while recording')}</label
    >
  </div>
{/if}
