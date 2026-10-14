<!-- The library: prepared clips (templates), projects and party rounds, and background audio for party rooms. A file list, not a
     poster wall. Right-click a row for its actions. -->
<script lang="ts">
  import type { Mode, ProjectSummary } from '@doblaje/core';
  import { fmtClock, registerMenu, toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../../api.ts';
  import { go } from '../../router.svelte.ts';
  import Sounds from '../sounds/Sounds.svelte';
  import { deriveAndOpen, modeLabel } from './derive.ts';
  import NewProjectDialog from './NewProjectDialog.svelte';

  interface Props {
    /** open the New project dialog right away (#/new, File → New) */
    newProject?: boolean;
  }
  let { newProject = false }: Props = $props();

  let items = $state.raw<ProjectSummary[]>([]);
  // the dialog: none, a project, or a library clip (seeded from the route once)
  let dialog = $state<'project' | 'clip' | null>(null);
  if (untrack(() => newProject)) {
    dialog = 'project';
    history.replaceState(null, '', '#/'); // so File → New works again after cancelling
  }
  const clips = $derived(items.filter((p) => p.template));
  const projects = $derived(items.filter((p) => !p.template));
  const clipName = $derived(new Map(clips.map((c) => [c.id, c.name])));

  async function load() {
    try {
      items = await api.projects();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }
  void load();

  async function remove(item: ProjectSummary) {
    const msg = item.template ? t('Delete this clip? Projects made from it keep working.') : t('Delete this project and its recordings?');
    if (!confirm(msg)) return;
    await api.deleteProject(item.id);
    await load();
  }
  const open = (id: string) => go(`/p/${id}`);
  const byId = (el: Element) => items.find((p) => p.id === (el as HTMLElement).dataset.id);

  const offs = [
    // a project row: open or delete
    registerMenu('tr.card:not(.clip)[data-id]', (el) => {
      const p = byId(el);
      if (!p) return null;
      return [
        { label: t('Open'), icon: 'file', run: () => open(p.id) },
        { label: t('Delete project'), icon: 'trash', danger: true, run: () => void remove(p) },
      ];
    }),
    // a clip: prepare it, or start a project from it
    registerMenu('tr.clip[data-id]', (el) => {
      const c = byId(el);
      if (!c) return null;
      return [
        { label: t('Prepare this clip'), icon: 'sliders', run: () => open(c.id) },
        'separator',
        { label: t('New dubbing project from this clip'), icon: 'mic', run: () => void deriveAndOpen(c.id, 'pro', go) },
        { label: t('Play at a party'), icon: 'tv', disabled: !c.characters.length, run: () => go(`/party?clip=${c.id}`) },
        { label: t('New podcast project from this clip'), icon: 'wave', run: () => void deriveAndOpen(c.id, 'podcast', go) },
        { label: t('Delete clip'), icon: 'trash', danger: true, run: () => void remove(c) },
      ];
    }),
  ];
  onDestroy(() => {
    for (const off of offs) off();
  });
</script>

{#snippet thumb(p: ProjectSummary)}
  <td><span class="thumb" style:background-image={p.poster ? `url(${p.poster})` : undefined}></span></td>
{/snippet}
{#snippet del(p: ProjectSummary)}
  <td>
    <button
      class="del ghost icon"
      title={t('Delete')}
      onclick={(e) => {
        e.stopPropagation();
        void remove(p);
      }}><Icon name="trash" /></button
    >
  </td>
{/snippet}

<div class="library">
  <div class="hero">
    <div class="grow">
      <h1>{t('Library')}</h1>
      <div class="dim">{t('Clips and projects are stored on this computer.')}</div>
    </div>
    <button class="signal" id="party-room" onclick={() => go('/party')}><Icon name="tv" />{t('Party room')}</button>
    <button id="add-clip" onclick={() => (dialog = 'clip')}><Icon name="plus" />{t('Add clip')}</button>
    <button class="primary" id="new-project" onclick={() => (dialog = 'project')}><Icon name="plus" />{t('New project')}</button>
  </div>

  <section class="lib-section">
    <h2>{t('Clip library')}</h2>
    <div class="hint">
      {t('Prepare a clip once (dialogue, subtitles, characters), then play it at a party or start dubbing and podcast projects from it.')}
    </div>
    <div id="clips">
      {#if !clips.length}
        <div class="empty" id="no-clips">{t('No clips yet. Add a funny video or a movie scene, prepare it once, and play it as often as you like.')}</div>
      {:else}
        <table class="plist clips">
          <thead>
            <tr><th></th><th>{t('Clip')}</th><th class="r">{t('Length')}</th><th class="r">{t('Lines')}</th><th>{t('Start a project')}</th><th></th></tr>
          </thead>
          <tbody>
            {#each clips as c (c.id)}
              <tr class="card clip" tabindex="0" data-id={c.id} onclick={() => open(c.id)} onkeydown={(e) => e.key === 'Enter' && open(c.id)}>
                {@render thumb(c)}
                <td>
                  <div class="name">{c.name}</div>
                  {#if c.characters.length}
                    <div class="characters">{#each c.characters as n (n)}<span class="chip">{n}</span>{/each}</div>
                  {:else}
                    <div class="small dim">{c.ready ? t('Not prepared yet: open it and press Prepare all') : t('Importing…')}</div>
                  {/if}
                </td>
                <td class="num">{fmtClock(c.duration)}</td>
                <td class="num">{c.cues}</td>
                <td class="derive">
                  <button
                    class="small signal derive-party"
                    disabled={!c.ready || !c.characters.length}
                    title={c.characters.length ? t('Open a party room with this clip') : t('Prepare the clip first: it needs characters')}
                    onclick={(e) => {
                      e.stopPropagation();
                      go(`/party?clip=${c.id}`);
                    }}>{t('Play at a party')}</button
                  >
                  {#each ['pro', 'podcast'] as const as m (m)}
                    <button
                      class="small derive-{m}"
                      disabled={!c.ready}
                      title={t('New {mode} project from this clip', { mode: modeLabel(m as Mode) })}
                      onclick={(e) => {
                        e.stopPropagation();
                        void deriveAndOpen(c.id, m, go);
                      }}>{modeLabel(m)}</button
                    >
                  {/each}
                </td>
                {@render del(c)}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </section>

  <section class="lib-section">
    <h2>{t('Projects')}</h2>
    <div id="projects">
      {#if !projects.length}
        <div class="empty" id="empty">{t('No projects. Choose New project, then pick a video file.')}</div>
      {:else}
        <table class="plist">
          <thead>
            <tr>
              <th></th><th>{t('Name')}</th><th class="r">{t('Length')}</th><th class="r">{t('Cues')}</th><th class="r">{t('Takes')}</th><th class="r"
                >{t('Modified')}</th
              ><th></th>
            </tr>
          </thead>
          <tbody>
            {#each projects as p (p.id)}
              <tr class="card" tabindex="0" data-id={p.id} onclick={() => open(p.id)} onkeydown={(e) => e.key === 'Enter' && open(p.id)}>
                {@render thumb(p)}
                <td>
                  <div class="name">{p.name}</div>
                  <div class="badge">{modeLabel(p.mode)}</div>
                  {#if p.sourceTemplateId}
                    <span class="small dim from-clip">{t('from')} {clipName.get(p.sourceTemplateId) || t('a deleted clip')}</span>
                  {/if}
                </td>
                <td class="num">{fmtClock(p.duration)}</td>
                <td class="num">{p.cues}</td>
                <td class="num">{p.takes}</td>
                <td class="num">{new Date(p.updatedAt).toLocaleDateString()}</td>
                {@render del(p)}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </section>

  <section class="lib-section">
    <h2>{t('Background audio')}</h2>
    <div class="hint">{t('Played on the waiting phones during a party round, so nobody hears the lines before the show.')}</div>
    <Sounds />
  </section>
</div>

{#if dialog}
  <NewProjectDialog template={dialog === 'clip'} onclose={() => (dialog = null)} oncreated={(id) => go(`/p/${id}`)} />
{/if}

<style>
  .library {
    padding: 1.6rem 2rem;
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto; /* page */
    max-width: 70rem;
    width: 100%;
    margin: 0 auto;
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 650;
  }
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 1rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--line);
  }
  .lib-section {
    margin-top: 1.6rem;
  }
  .lib-section h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--dim);
    margin: 0 0 0.3rem;
  }
  .plist {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-size: 0.8em;
    font-weight: 600;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--line);
  }
  th.r {
    text-align: right;
  }
  td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  tr.card {
    cursor: pointer;
  }
  tr.card:hover td {
    background: var(--panel);
  }
  tr.card:focus-visible {
    outline-offset: -2px;
  }
  .thumb {
    width: 96px;
    height: 54px;
    background: #000 center / cover;
    display: block;
  }
  td.num {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--dim);
    text-align: right;
  }
  .name {
    font-weight: 600;
  }
  .characters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.2rem;
  }
  td.derive {
    white-space: nowrap;
  }
  td.derive button + button {
    margin-left: 0.3rem;
  }
</style>
