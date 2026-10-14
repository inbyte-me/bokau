<!-- One subtitle line: times, who says it, the text, syllables per second (how hard it is to say), and its actions. -->
<script lang="ts">
  import { type Cue, countText, detectLang, speechRate } from '@doblaje/core';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import { getStudio } from '../studio.svelte.ts';

  interface Props {
    cue: Cue;
    selected: boolean;
    /** the line under the playhead */
    active: boolean;
    /** scroll to it when it becomes active while playing */
    follow: boolean;
  }
  let { cue, selected, active, follow }: Props = $props();
  const studio = getStudio();

  const lang = $derived(detectLang(cue.text || ''));
  const syl = $derived(countText(cue.text || '', lang));
  const rate = $derived(speechRate(cue, lang));

  const num = (s: string) => {
    const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(s).trim());
    return m ? Number(m[1] || 0) * 60 + Number(m[2]) : Number.NaN;
  };
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
  };
  const edit = (label: string, fn: (c: Cue) => void, merge = false) =>
    store.commit(
      label,
      (p) => {
        const c = p.cues.find((x) => x.id === cue.id);
        if (c) fn(c);
      },
      ['cues'],
      { merge },
    );
  function setTime(k: 'start' | 'end', input: HTMLInputElement) {
    const v = num(input.value);
    if (!Number.isFinite(v)) {
      input.value = fmt(cue[k]);
      return;
    }
    edit('Edit cue time', (c) => {
      c[k] = Math.max(0, Math.min(app.engine.duration, v));
      if (c.end <= c.start) c.end = c.start + 0.2;
    });
  }
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  function scrollWhenActive(el: HTMLElement) {
    if (active && follow) el.scrollIntoView({ block: 'nearest' });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: the row's controls are the keyboard path; a click anywhere selects -->
<div class={['cue', selected && 'sel', active && 'active']} data-id={cue.id} onclick={() => app.select({ cueId: cue.id })} {@attach scrollWhenActive}>
  <div class="meta">
    <input class="mono" value={fmt(cue.start)} aria-label={t('Start')} onchange={(e) => setTime('start', e.currentTarget)} />
    →
    <input class="mono" value={fmt(cue.end)} aria-label={t('End')} onchange={(e) => setTime('end', e.currentTarget)} />
    <input
      class="who"
      value={cue.character || ''}
      placeholder={t('Character')}
      onchange={(e) => {
        const v = e.currentTarget.value;
        edit('Edit cue character', (c) => {
c.character = v;
});
      }}
    />
    <span class={['syl', rate > 9 ? 'bad' : rate > 7 && 'off']} title={t('syllables · syllables per second (above ~7/s is hard to say)')}
      >{syl} syl · {rate.toFixed(1)}/s</span
    >
  </div>
  <textarea
    rows="2"
    placeholder={t('Dialogue…')}
    value={cue.text}
    oninput={(e) => {
      const v = e.currentTarget.value;
      edit('Edit cue text', (c) => {
c.text = v;
}, true);
    }}
    onfocus={() => app.select({ cueId: cue.id })}
  ></textarea>
  <div class="row">
    <button class="icon" title={t('Go to cue')} onclick={stop(() => app.engine.seek(cue.start))}><Icon name="start" size={13} /></button>
    <button class="icon" title={t('Play this cue')} onclick={stop(() => void app.engine.playRange(Math.max(0, cue.start - 0.5), cue.end + 0.3))}
      ><Icon name="play" size={13} /></button
    >
    <button class="icon rec-cue" title={t('Record this cue (punch)')} onclick={stop(() => studio.recordCue(cue))}><Icon name="mic" size={13} /></button>
    <button class="icon" title={t('Loop-record this cue until you nail it')} onclick={stop(() => studio.recordCue(cue, true))}><Icon name="loop" size={13} /></button>
    <div class="spacer"></div>
    <button
      class="ghost"
      title={t('Delete')}
      onclick={stop(() =>
        store.commit(
          'Delete cue',
          (p) => {
            p.cues = p.cues.filter((x) => x.id !== cue.id);
          },
          ['cues'],
        ),
      )}><Icon name="close" size={12} /></button
    >
  </div>
</div>
