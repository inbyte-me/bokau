<!-- Top bar: AI spend against the local cap (or "AI offline"). Refreshes when the desktop app's key changes. -->
<script lang="ts">
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
  import { api, type SystemInfo } from '../api.ts';
  import { app } from '../app.svelte.ts';

  let system = $state.raw<SystemInfo | null>(null);
  let failed = $state(false);
  const load = () =>
    api
      .system()
      .then((s) => {
        app.system = s;
        system = s;
        failed = false;
      })
      .catch(() => {
        failed = true;
      });
  onMount(() => {
    void load();
    // File → OpenRouter Key… in the desktop app
    window.addEventListener('doblaje:ai-changed', load);
    return () => window.removeEventListener('doblaje:ai-changed', load);
  });
</script>

<span
  class={['chip', system && (system.ai.configured ? 'ok' : 'warn')]}
  id="ai-chip"
  title={t('OpenRouter usage (hard-capped locally)')}
>
  {#if failed}{t('server?')}{:else if !system}…{:else if system.ai.configured}AI ${system.ai.spentUsd.toFixed(3)} / ${system.ai.capUsd}{:else}{t('AI offline')}{/if}
</span>
