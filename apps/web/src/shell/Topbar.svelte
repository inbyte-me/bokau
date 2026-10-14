<!-- The bar on every screen. A screen adds its own controls with screenBar.show(snippet). -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { go } from '../router.svelte.ts';
  import { store } from '../store.svelte.ts';
  import { toggleTv } from '../tv.ts';
  import AiChip from './AiChip.svelte';
  import { screenBar } from './bar.svelte.ts';
  import DevicesChip from './DevicesChip.svelte';
  import FileMenu from './FileMenu.svelte';
  import SaveControls from './SaveControls.svelte';

  interface Props {
    lang: string;
    onlang: (lang: string) => void;
  }
  let { lang, onlang }: Props = $props();
  const open = $derived(store.read(['open'], () => true, false));
</script>

<div class="topbar">
  <button class="brand" onclick={() => go('/')}><span class="dot"></span>Doblaje Studio</button>
  <FileMenu />
  {@render screenBar.content?.()}
  {#if open}<SaveControls />{/if}
  <div class="spacer"></div>
  <DevicesChip />
  <AiChip />
  <select id="lang" title="Language" value={lang} onchange={(e) => onlang(e.currentTarget.value)}>
    <option value="en">English</option>
    <option value="es">Español</option>
  </select>
  <button class="icon" id="tv-btn" title={t('TV mode (big UI, fullscreen)')} onclick={() => toggleTv()}><Icon name="tv" /></button>
</div>
