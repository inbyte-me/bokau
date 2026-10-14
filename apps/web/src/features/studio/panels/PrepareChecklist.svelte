<!-- "Prepare this clip": separate dialogue → subtitles → speakers, all at once or one step at a time. -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { store } from '../../../store.svelte.ts';
  import { LANGS, prepare, STEPS, type StepState, stepDone } from '../../prepare.svelte.ts';

  let lang = $state('auto');
  if (prepare.projectId !== store.current?.id) prepare.reset();

  // a step done outside the checklist (a single button elsewhere, an undo) shows as done
  const done = $derived(
    store.read(['cues', 'speakers', 'media'], () => Object.fromEntries(STEPS.map((s) => [s.id, stepDone(s.id)])), {}) as Record<string, boolean>,
  );
  const steps = $derived(
    STEPS.map((s) => {
      const st = prepare.status[s.id];
      const state: StepState = st.state === 'todo' && done[s.id] ? 'done' : st.state;
      return { ...s, state, message: st.message };
    }),
  );
  const ICON: Record<StepState, string | null> = { todo: null, running: 'clock', done: 'check', skipped: 'minus', error: 'close' };
</script>

<div class="box" id="prepare-box">
  <h4>{t('Prepare this clip')}</h4>
  <ol class="prepare-steps">
    {#each steps as s (s.id)}
      <li class={['step', s.state]} data-step={s.id} data-state={s.state}>
        <span class="mark" aria-hidden="true">{#if ICON[s.state]}<Icon name={ICON[s.state] ?? ''} size={13} />{/if}</span>
        <div class="grow">
          <div>{t(s.label)}</div>
          <div class="small dim">{s.message || t(s.hint)}</div>
        </div>
        {#if s.state !== 'done' && !prepare.running}
          <button class="step-run" onclick={() => prepare.run([s.id], lang)}>{t('Run')}</button>
        {/if}
      </li>
    {/each}
  </ol>
  <div class="row">
    <button
      class="primary"
      id="prepare-all"
      disabled={prepare.running || steps.every((s) => s.state === 'done')}
      onclick={() => prepare.run(['separate', 'subtitles', 'speakers'], lang)}><Icon name="play" />{t('Prepare all')}</button
    >
    <select id="prepare-lang" title={t('Language of the dialogue')} bind:value={lang}>
      {#each LANGS as [v, l] (v)}<option value={v}>{t(l)}</option>{/each}
    </select>
  </div>
</div>
