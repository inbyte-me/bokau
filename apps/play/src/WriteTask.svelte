<!-- One short text to write and send: a pitch, a direction, a title, a review. Can be sent again until the stage ends. -->
<script lang="ts">
  import { MAX_ENTRY_CHARS } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { untrack } from 'svelte';

  interface Props {
    /** what the server already has from me */
    saved: string;
    placeholder: string;
    onsend: (text: string) => void;
  }
  let { saved, placeholder, onsend }: Props = $props();
  let text = $state(untrack(() => saved));
  const clean = $derived(text.trim());
  const sent = $derived(!!saved && clean === saved);
</script>

<form
  class="write"
  onsubmit={(e) => {
    e.preventDefault();
    if (clean && !sent) onsend(clean);
  }}
>
  <textarea bind:value={text} {placeholder} maxlength={MAX_ENTRY_CHARS} rows="3" aria-label={placeholder} enterkeyhint="send"></textarea>
  <div class="row">
    <span class="count" aria-hidden="true">{MAX_ENTRY_CHARS - text.length}</span>
    <button class={['big', !sent && 'primary']} type="submit" disabled={!clean || sent}>{sent ? t('Sent') : saved ? t('Send the change') : t('Send')}</button>
  </div>
</form>

<style>
  .write {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  textarea {
    font: inherit;
    font-size: 1.15rem;
    color: inherit;
    background: var(--panel2);
    border: 1px solid var(--line2);
    border-radius: 10px;
    padding: 14px;
    resize: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .count {
    flex: none;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    min-width: 2.5em;
  }
  .row button {
    flex: 1;
  }
</style>
