<script lang="ts">
  import Modal from '@doblaje/ui/components/Modal.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { SHORTCUTS } from './studio.svelte.ts';

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();
  // "⌘/Ctrl + 1…9" → keys, with the joining words left as text
  const parts = (k: string) => k.split(' ').map((x) => ({ text: x, key: !/^[+/…−]$|^or$/.test(x) }));
</script>

<Modal title={t('Keyboard shortcuts')} id="shortcuts" {onclose}>
  <div class="col">
    {#each SHORTCUTS as [k, d] (k)}
      <div class="row">
        <div class="keys">
          {#each parts(k) as p, i (i)}{#if p.key}<kbd>{p.text}</kbd>{:else}{` ${p.text} `}{/if}{/each}
        </div>
        <div class="dim">{t(d)}</div>
      </div>
    {/each}
  </div>
  {#snippet actions()}
    <button class="primary" onclick={onclose}>{t('Close')}</button>
  {/snippet}
</Modal>

<style>
  .keys {
    min-width: 11em;
  }
</style>
