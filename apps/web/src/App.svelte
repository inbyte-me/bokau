<!-- The app: top bar + the screen for the current route, and the dialogs any screen can open (devices, export).
     Changing the language re-renders everything (t() is plain, not reactive). -->
<script lang="ts">
  import { getLang, setLang, t, toast } from '@doblaje/ui';
  import Overlays from '@doblaje/ui/components/Overlays.svelte';
  import DevicesDialog from './features/devices/DevicesDialog.svelte';
  import { devicesDialog } from './features/devices/devices.svelte.ts';
  import ExportDialog from './features/export/ExportDialog.svelte';
  import { exporting } from './features/export/export.svelte.ts';
  import Library from './features/library/Library.svelte';
  import ProjectScreen from './features/ProjectScreen.svelte';
  import PartyHost from './features/party/host/PartyHost.svelte';
  import { go, router } from './router.svelte.ts';
  import Topbar from './shell/Topbar.svelte';
  import { store } from './store.svelte.ts';

  let lang = $state(getLang());
  const route = $derived(router.current);
  // the open project belongs to its screen: any other screen starts with none
  router.beforeChange((next) => {
    exporting.open = false;
    if (next.name !== 'project') store.close();
  });
  const projectOpen = $derived(store.read(['open'], () => true, false));
  /** an error shows on the route it happened on; navigating away clears it */
  let failure = $state<{ path: string; message: string } | null>(null);
  const failed = $derived(failure?.path === route.path ? failure.message : '');

  function changeLang(l: string) {
    setLang(l);
    lang = getLang();
  }

  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    failure = { path: route.path, message };
    toast(message, 'error');
  };
</script>

{#key `${lang}|${route.path}`}
  <Topbar {lang} onlang={changeLang} />
  <div class="screen-host">
    {#if failed}
      <div class="empty" style="margin: 2rem">
        {failed}
        <div><button onclick={() => go('/')}>{t('Back to projects')}</button></div>
      </div>
    {:else if route.name === 'party'}
      <PartyHost clip={route.clip} />
    {:else if route.name === 'project'}
      <ProjectScreen id={route.id} studio={route.studio} onerror={fail} />
    {:else}
      <Library newProject={route.newProject} />
    {/if}
  </div>
{/key}

{#if devicesDialog.open}<DevicesDialog />{/if}
<Overlays />
{#if exporting.open && projectOpen}<ExportDialog />{/if}

<style>
  .screen-host {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
