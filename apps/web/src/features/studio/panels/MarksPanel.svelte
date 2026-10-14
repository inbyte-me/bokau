<!-- Marks: up to nine numbered positions (⌘/Ctrl+n sets, ⌥/Option+n jumps, [ and ] step through them), with their
     time and an optional name. Click a row to jump; jumping while recording keeps recording. -->
<script lang="ts">
  import { fmtClock } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { store } from '../../../store.svelte.ts';
  import { transport } from '../../../transport.svelte.ts';
  import { getStudio } from '../studio.svelte.ts';

  const studio = getStudio();
  const marks = $derived(store.read(['markers'], (p) => [...p.markers].sort((a, b) => a.t - b.t).map((m) => ({ ...m })), []));
  const free = $derived([1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !marks.some((m) => m.n === n)) ?? null);
  // the mark under a paused playhead is highlighted
  const here = $derived(transport.playing ? null : transport.time);

  function rename(n: number, name: string) {
    store.commit(
      'Rename mark',
      (p) => {
        const x = p.markers.find((y) => y.n === n);
        if (x) x.name = name.trim() || undefined;
      },
      ['markers'],
    );
  }
</script>

<div class="box">
  <h4>{t('Marks')}</h4>
  <div class="row">
    <button class="primary" id="mark-add" disabled={free == null} onclick={() => free && studio.setMark(free)}><Icon name="flag" />{t('Add mark at the playhead')}</button>
  </div>
  <div class="col" id="marks-list">
    {#each marks as m (m.n)}
      <div class={['mark-row', here != null && Math.abs(m.t - here) < 0.05 && 'cur']} data-n={m.n}>
        <button class="mark-n" title={t('Jump to mark {n}', { n: m.n })} onclick={() => studio.jumpMark(m.n)}>{m.n}</button>
        <button class="ghost mono mark-t" title={t('Jump to mark {n}', { n: m.n })} onclick={() => studio.jumpMark(m.n)}>{fmtClock(m.t, { ms: true })}</button>
        <input class="grow mark-name" type="text" value={m.name ?? ''} placeholder={t('Name (optional)')} onchange={(e) => rename(m.n, e.currentTarget.value)} />
        <button class="ghost icon" title={t('Move mark {n} to the playhead', { n: m.n })} onclick={() => studio.setMark(m.n)}><Icon name="flag" size={13} /></button>
        <button class="ghost icon" title={t('Delete mark {n}', { n: m.n })} onclick={() => studio.deleteMark(m.n)}><Icon name="close" size={12} /></button>
      </div>
    {:else}
      <div class="hint">{t('No marks yet. Press ⌘/Ctrl+1 at a spot you want to come back to.')}</div>
    {/each}
  </div>
  <div class="hint">
    {t('⌘/Ctrl+1…9 set a mark · ⌥/Option+1…9 jump · [ and ] go to the previous / next mark. Jumping while recording keeps recording.')}
  </div>
</div>
