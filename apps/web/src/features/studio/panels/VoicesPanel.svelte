<!-- Voices tab: prepare the clip, separate dialogue from music, and who speaks when (each voice can be renamed,
     silenced to dub it, soloed or auditioned; a selected passage can be given to another voice). -->
<script lang="ts">
  import { errorMessage, type Speaker } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { api } from '../../../api.ts';
  import { app } from '../../../app.svelte.ts';
  import { store } from '../../../store.svelte.ts';
  import { assignPassage, removeCharacter } from '../../actions.ts';
  import { identifyVoices } from '../../prepare.svelte.ts';
  import PrepareChecklist from './PrepareChecklist.svelte';

  // neural separation needs the separator installed on this computer
  let neural = $state(!!app.system?.neuralSeparation);
  if (!app.system)
    void api
      .system()
      .then((s) => {
        app.system = s;
        neural = !!s.neuralSeparation;
      })
      .catch(() => {});

  const stems = $derived(store.read(['media'], (p) => ({ ...p.stems }), null));
  const ready = $derived(stems?.status === 'ready');
  const speakers = $derived(
    store.read(
      ['speakers', 'cues'],
      (p) => {
        const dur = (id: string) => p.speakers.segments.filter((g) => g.speaker === id).reduce((a, g) => a + g.end - g.start, 0);
        return p.speakers.list.map((s) => ({ ...s, seconds: Math.round(dur(s.id)) }));
      },
      [],
    ),
  );
  // the passage selected in the Voices lane, to give it to someone else
  const passage = $derived.by(() => {
    const i = app.sel.segIdx;
    return store.read(['speakers'], (p) => (i != null && p.speakers.segments[i] ? { idx: i, ...p.speakers.segments[i] } : null), null);
  });

  let separating = $state(false);
  let stemStatus = $state('');
  async function separate(method: 'auto' | 'neural') {
    const id = store.project.id;
    separating = true;
    const t0 = Date.now();
    stemStatus = t('Separating…');
    try {
      const { job } = await api.startJob(`/api/projects/${id}/stems`, { method });
      await api.waitJob(
        job,
        (j) => {
          stemStatus = `${j.message || t('Separating')} ${Math.round(j.progress * 100)}% · ${Math.round((Date.now() - t0) / 1000)} s`;
        },
        { intervalMs: 800 },
      );
      const fresh = await api.project(id);
      store.refreshServerParts(fresh);
      if (fresh.stems.status === 'ready') {
        await app.engine.assets?.loadStems();
        store.commit(
          'Stems',
          (p) => {
            p.original.source = 'bg';
          },
          ['levels'],
        );
        toast(t('Stems ready: dialogue muted, music + SFX kept'), 'ok');
        void app.engine.refresh();
      } else
        toast(
          fresh.stems.neuralAvailable
            ? t('This clip is mono, so phase separation cannot split it. Use “Best quality (neural)”.')
            : t('This clip is mono. Install the neural separator (pnpm setup:separation) or use ducking.'),
          'error',
          7000,
        );
    } catch (e) {
      toast(errorMessage(e), 'error', 8000);
    } finally {
      separating = false;
      stemStatus = '';
    }
  }

  let identifying = $state(false);
  let voicesStatus = $state('');
  let voiceCount = $state(
    (() => {
      try {
        return localStorage.getItem('voiceCount') || '';
      } catch {
        return '';
      }
    })(),
  );
  async function identify() {
    identifying = true;
    voicesStatus = t('Starting…');
    try {
      const n = await identifyVoices((m) => (voicesStatus = m));
      toast(t('{n} voices found', { n }), 'ok');
      voicesStatus = '';
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      identifying = false;
    }
  }
  function set(id: string, patch: Partial<Speaker>) {
    store.commit(
      'Voice setting',
      (p) => {
        const s = p.speakers.list.find((x) => x.id === id);
        if (s) Object.assign(s, patch);
      },
      ['speakers'],
    );
    void app.engine.refresh();
  }
  function rename(id: string, name: string) {
    store.commit(
      'Rename voice',
      (p) => {
        const x = p.speakers.list.find((q) => q.id === id);
        if (!x || !name.trim()) return;
        const old = x.name;
        x.name = name.trim();
        for (const c of p.cues) if (c.character === old) c.character = x.name;
      },
      ['speakers', 'cues'],
    );
  }
  function listen(id: string) {
    const g = store.project.speakers.segments.find((x) => x.speaker === id);
    if (g) void app.engine.playRange(Math.max(0, g.start - 0.2), Math.min(g.end + 0.2, g.start + 6));
  }
  const method = (m: string | null | undefined) =>
    m === 'surround-center'
      ? t('from the 5.1 centre channel — clean')
      : m === 'neural-demucs'
        ? t('neural separation (Demucs)')
        : t('centre-channel extraction — good for dialogue panned to the middle, imperfect on busy mixes');
</script>

<div class="col">
  <PrepareChecklist />

  <div class="box" id="separation-box">
    <h4>{t('Separate dialogue from music')}</h4>
    <div class="row">
      <button id="stems-go" disabled={separating} onclick={() => separate('auto')}><Icon name="wave" />{ready ? t('Re-separate') : t('Separate dialogue / music')}</button>
      <button id="stems-neural" disabled={separating || !neural} title={neural ? '' : t('Not installed. Run: pnpm setup:separation')} onclick={() => separate('neural')}
        ><Icon name="wave" />{t('Best quality (neural)')}</button
      >
    </div>
    <div class="hint" id="stem-status" role="status">{stemStatus}</div>
    {#if ready}
      <div class="hint">{t('Stems ready')} ({method(stems?.method)})</div>
    {:else if stems?.status === 'unsupported'}
      <div class="hint warn">
        {neural
          ? t('This clip is mono, so phase separation cannot split it. Use “Best quality (neural)”: it takes about as long as the clip.')
          : t('This clip is mono. Install the neural separator (pnpm setup:separation) or use the volume and ducking controls.')}
      </div>
    {:else}
      <div class="hint">
        {t(
          'Splits the clip audio into Original Dialogue and Background (music + sound effects) so you can silence the actors but keep the score, gunshots and ambience. “Best quality (neural)” also works on mono clips, takes about as long as the clip, and runs on this computer.',
        )}
      </div>
    {/if}
  </div>

  <div class="box" id="voices-box">
    <h4>{t('Voices (who is speaking)')}</h4>
    <div class="row">
      <button id="voices-go" disabled={!ready || identifying} onclick={identify}><Icon name="mic" />{speakers.length ? t('Identify again') : t('Identify voices')}</button>
      <select
        id="voice-count"
        title={t('Number of voices')}
        bind:value={voiceCount}
        onchange={() => {
          try {
            localStorage.setItem('voiceCount', voiceCount);
          } catch {}
        }}
      >
        <option value="">{t('Auto')}</option>
        {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={String(n)}>{n} {n === 1 ? t('voice') : t('voices')}</option>{/each}
      </select>
    </div>
    <div class="hint" id="voices-status" role="status">{voicesStatus}</div>
    {#if !ready}
      <div class="hint">{t('Separate the dialogue first: voices are identified on the clean dialogue track.')}</div>
    {/if}
    {#if speakers.length}
      <div class="col">
        {#each speakers as sp (sp.id)}
          <div class="row voice-row" data-speaker={sp.id}>
            <span class="swatch" style:background={sp.color}></span>
            <input class="grow" type="text" value={sp.name} aria-label={t('Character name')} onchange={(e) => rename(sp.id, e.currentTarget.value)} />
            <span class="small dim mono">{sp.seconds} s</span>
            <button class={['voice-mute', sp.muted && 'on']} title={t('Silence this character in the original audio, so you can dub it')} onclick={() => set(sp.id, { muted: !sp.muted })}
              >{sp.muted ? t('Off') : t('On')}</button
            >
            <button class={['voice-solo', sp.solo && 'on']} title={t('Hear only this character')} onclick={() => set(sp.id, { solo: !sp.solo })}>S</button>
            <button class="icon" title={t('Listen to this character')} onclick={() => listen(sp.id)}><Icon name="play" size={13} /></button>
            <button class="icon voice-remove" title={t('Remove this character')} onclick={() => removeCharacter(sp.id)}><Icon name="trash" size={13} /></button>
          </div>
        {/each}
        {#if passage}
          <div class="row">
            <span class="small dim">{t('Selected passage')} {passage.start.toFixed(1)}–{passage.end.toFixed(1)} s</span>
            <select id="seg-assign" value={passage.speaker} onchange={(e) => assignPassage(passage.idx, e.currentTarget.value)}>
              {#each speakers as sp (sp.id)}<option value={sp.id}>{sp.name}</option>{/each}
            </select>
          </div>
        {/if}
        <div class="hint">
          {t(
            'Turn a character Off to hear the clip without that voice, then record your own over it. Click a coloured block in the Voices lane to check or correct who is speaking.',
          )}
        </div>
      </div>
    {:else if ready}
      <div class="hint">{t('Finds each distinct voice in the clip so you can silence one character at a time. Runs on this computer.')}</div>
    {/if}
  </div>
</div>

<style>
  .swatch {
    width: 0.8em;
    height: 0.8em;
  }
</style>
