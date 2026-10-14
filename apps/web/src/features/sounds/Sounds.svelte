<!-- Background audio library: tracks the waiting phones play during a party round (loud, in headphones, so
     nobody hears the take before the show). Add, listen, rename (double-click), remove (right-click or ×). -->
<script lang="ts">
  import type { Sound } from '@doblaje/core';
  import { fmtClock, registerMenu, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy } from 'svelte';
  import { api } from '../../api.ts';

  let sounds = $state<Sound[]>([]);
  let busy = $state('');
  let playing = $state<string | null>(null);
  let renaming = $state<string | null>(null);
  const audio = new Audio();
  audio.onended = () => (playing = null);

  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const load = async () => {
    sounds = await api.get<Sound[]>('/api/sounds');
  };
  void load().catch((e: unknown) => toast(errMsg(e), 'error'));

  async function add(input: HTMLInputElement) {
    const files = [...(input.files ?? [])];
    input.value = ''; // the same file can be chosen again
    for (const f of files) {
      busy = t('Adding {name}…', { name: f.name });
      try {
        const { job } = await api.raw<{ job: string }>('/api/sounds', f, { 'x-filename': encodeURIComponent(f.name) });
        await api.waitJob(job);
      } catch (e) {
        toast(t('Could not add {name}: {error}', { name: f.name, error: errMsg(e) }), 'error', 6000);
      }
    }
    busy = '';
    await load();
  }
  function toggle(s: Sound) {
    if (playing === s.id) {
      audio.pause();
      playing = null;
      return;
    }
    audio.src = s.url;
    void audio.play();
    playing = s.id;
  }
  async function rename(s: Sound, name: string) {
    renaming = null;
    const n = name.trim();
    if (!n || n === s.name) return;
    await api.put(`/api/sounds/${s.id}`, { name: n }).catch((e: unknown) => toast(errMsg(e), 'error'));
    await load();
  }
  async function remove(s: Sound) {
    if (playing === s.id) audio.pause();
    await api.del(`/api/sounds/${s.id}`).catch((e: unknown) => toast(errMsg(e), 'error'));
    await load();
  }

  const off = registerMenu('#sounds li[data-sound]', (el) => {
    const s = sounds.find((x) => x.id === (el as HTMLElement).dataset.sound);
    if (!s) return null;
    return [
      { label: playing === s.id ? t('Stop') : t('Listen'), icon: 'play', run: () => toggle(s) },
      { label: t('Rename'), icon: 'edit', run: () => (renaming = s.id) },
      'separator',
      { label: t('Remove'), icon: 'trash', danger: true, run: () => void remove(s) },
    ];
  });
  onDestroy(() => {
    off();
    audio.pause();
  });
</script>

<div class="sounds" id="sounds">
  <div class="row">
    <label class={['button', busy && 'disabled']} id="add-sound">
      <Icon name="plus" />
      {t('Add background audio')}
      <input type="file" accept="audio/*,video/*" multiple disabled={!!busy} onchange={(e) => add(e.currentTarget)} />
    </label>
    {#if busy}<span class="dim" role="status">{busy}</span>{/if}
  </div>
  {#if sounds.length}
    <ul class="sound-list">
      {#each sounds as s (s.id)}
        <li data-sound={s.id}>
          <button class="icon" title={playing === s.id ? t('Stop') : t('Listen')} onclick={() => toggle(s)}><Icon name={playing === s.id ? 'stop' : 'play'} /></button>
          {#if renaming === s.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="rename" value={s.name} autofocus onblur={(e) => rename(s, e.currentTarget.value)} onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') renaming = null;
            }} />
          {:else}
            <span class="name" role="button" tabindex="0" ondblclick={() => (renaming = s.id)} onkeydown={(e) => e.key === 'F2' && (renaming = s.id)}>{s.name}</span>
          {/if}
          <span class="dim">{fmtClock(s.duration)}</span>
          <button class="icon" title={t('Remove')} onclick={() => remove(s)}><Icon name="trash" /></button>
        </li>
      {/each}
    </ul>
  {:else if !busy}
    <p class="hint">{t('No background audio yet. Add music or noise (any audio or video file): waiting phones play it in headphones while someone records.')}</p>
  {/if}
</div>

<style>
  .sounds {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .button {
    position: relative; /* holds the visually hidden file input */
  }
  .button input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .sound-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.4rem;
    border-radius: 4px;
  }
  li:hover {
    background: var(--panel2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rename {
    flex: 1;
  }
  .dim,
  .hint {
    color: var(--dim);
  }
</style>
