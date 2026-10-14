<!-- AI tab: translate (syllable-matched, lip-aware) or rewrite the cues in a genre; review each line, then apply. -->
<script lang="ts">
  import { type AiTask, errorMessage, type RewrittenLine } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import { t } from '@doblaje/ui/i18n';
  import { aiStatus, getModel, rewriteCues, setModel } from '../../../ai.ts';
  import type { AiInfo, RewriteResponse } from '../../../api.ts';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';

  const LANGS = [
    ['en', 'English'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['pt', 'Português'],
    ['de', 'Deutsch'],
    ['it', 'Italiano'],
  ];
  const TASKS = [
    ['translate', t('Translate (syllable-matched)')],
    ['genre:noir', t('Genre: Noir detective')],
    ['genre:pirate', t('Genre: Pirate')],
    ['genre:corporate', t('Genre: Bad corporate speak')],
    ['genre:action80s', t('Genre: 80s action movie')],
    ['telenovela', t('Telenovela overdrive')],
  ];

  let info = $state.raw<AiInfo | null>(null);
  let infoFailed = $state(false);
  let task = $state('translate');
  let from = $state('');
  let to = $state(document.documentElement.lang === 'es' ? 'en' : 'es');
  let extra = $state('');
  let scope = $state<'all' | 'sel'>('all');
  let model = $state(getModel() ?? '');
  let busy = $state(false);
  let result = $state.raw<RewriteResponse | null>(null);
  let failed = $state('');

  const refresh = () =>
    aiStatus()
      .then((s) => {
        info = s;
        if (!model) model = s.model;
      })
      .catch(() => (infoFailed = true));
  void refresh();

  const status = $derived(
    infoFailed
      ? t('AI status unavailable')
      : !info
        ? '…'
        : info.configured
          ? `OpenRouter · ${t('spent')} $${info.spentUsd.toFixed(4)} / $${info.capUsd} ${t('local cap')} · ${info.calls} ${t('calls')}`
          : t('No API key: translation is unavailable, party tasks use the offline fun-generator.'),
  );
  /** the cue text before the rewrite, for comparing */
  const original = $derived(store.read(['cues'], (p) => new Map(p.cues.map((c) => [c.id, c.orig ?? c.text])), new Map<string, string>()));

  async function run() {
    const cues = scope === 'sel' ? store.project.cues.filter((c) => c.id === app.sel.cueId) : store.project.cues;
    if (!cues.length) return toast(t('Add or import some cues first'), 'error');
    const [kind, genre] = task.split(':') as [AiTask, string | undefined];
    busy = true;
    result = null;
    failed = '';
    try {
      result = await rewriteCues(kind, cues, {
        fromLang: from || undefined,
        outLang: kind === 'translate' ? to : from || undefined,
        genre,
        extra: extra || undefined,
      });
      void refresh();
    } catch (e) {
      failed = errorMessage(e);
    } finally {
      busy = false;
    }
  }
  function apply(lines: RewrittenLine[]) {
    store.commit(
      'AI rewrite',
      (p) => {
        for (const l of lines) {
          const cue = p.cues.find((c) => c.id === l.id);
          if (!cue) continue;
          cue.orig ??= cue.text;
          cue.text = l.text;
          if (l.character && !cue.character) cue.character = l.character;
          if (l.direction) cue.direction = l.direction;
        }
      },
      ['cues'],
    );
  }
</script>

<div class="box">
  <h4>{t('Translation & localization assistant')}</h4>
  <div class="field">
    <label for="ai-task">{t('Task')}</label>
    <select id="ai-task" bind:value={task}>{#each TASKS as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
  </div>
  <div class="row">
    <div class="field grow">
      <label for="ai-from">{t('From')}</label>
      <select id="ai-from" bind:value={from}>
        <option value="">{t('Auto-detect')}</option>
        {#each LANGS as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </div>
    <div class="field grow">
      <label for="ai-to">{t('To')}</label>
      <select id="ai-to" bind:value={to}>{#each LANGS as [v, l] (v)}<option value={v}>{l}</option>{/each}</select>
    </div>
  </div>
  <textarea
    id="ai-extra"
    rows="3"
    bind:value={extra}
    placeholder={t(
      'Extra instructions, e.g. "Translate into English matching the original 7 syllables, with M/B/P where the character closes their lips" or "keep it formal"',
    )}
  ></textarea>
  <div class="row">
    <div class="field grow">
      <label for="ai-scope">{t('Apply to')}</label>
      <select id="ai-scope" bind:value={scope}>
        <option value="all">{t('All cues')}</option>
        <option value="sel">{t('Selected cue only')}</option>
      </select>
    </div>
    <div class="field grow">
      <label for="ai-model">{t('Model')}</label>
      <select id="ai-model" bind:value={model} onchange={() => setModel(model)}>
        {#each info?.models ?? [] as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </div>
  </div>
  <button class="primary" id="ai-go" disabled={busy} onclick={run}>{t('Generate')}</button>
  <div class="hint" id="ai-status">{status}</div>
  <div class="hint">{t('Each line is fitted to the original syllable count and to where the lips close (M, B, P), so the dub matches the mouth.')}</div>
</div>

<div class="col" id="ai-results">
  {#if busy}
    <div class="hint">{t('Thinking…')}</div>
  {:else if failed}
    <div class="hint warn">{failed}</div>
  {:else if result}
    {@const r = result}
    <div class="hint">
      {r.source === 'ai' ? r.model || '' : t('offline generator')}{r.costUsd ? ` · $${r.costUsd.toFixed(5)}` : ''}{r.notice ? ` · ${r.notice}` : ''}
    </div>
    <div class="row">
      <button
        class="primary"
        id="ai-apply-all"
        onclick={() => {
          apply(r.lines.filter((l) => l.changed));
          toast(t('Applied'), 'ok');
        }}>{t('Apply all')}</button
      >
      <button onclick={() => (result = null)}>{t('Discard')}</button>
    </div>
    {#each r.lines as l (l.id)}
      {@const diff = Math.abs(l.syllables - l.target)}
      <div class="cue">
        <div class="small dim">{original.get(l.id) ?? ''}</div>
        <div class="line">{l.text}</div>
        {#if l.direction}<div class="small dim">{l.direction}</div>{/if}
        <div class="row">
          <span class={['syl', diff > 2 ? 'bad' : diff > 0 && 'off']}>{l.syllables}/{l.target} syl</span>
          <div class="spacer"></div>
          <button onclick={() => apply([l])}>{t('Use this line')}</button>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .line {
    font-weight: 600;
  }
</style>
