<!-- "We will speak": the language the players use in this session (not necessarily the clip's). -->
<script lang="ts">
  import type { PartyLanguage } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { LANGUAGES } from '../languages.ts';

  interface Props {
    value: PartyLanguage;
    onchange: (language: PartyLanguage) => void;
    /** what it changes for this game, under the field */
    help?: string;
  }
  let { value, onchange, help = '' }: Props = $props();
</script>

<label class="field">
  {t('We will speak')}
  <select id="language" {value} onchange={(e) => onchange(e.currentTarget.value as PartyLanguage)}>
    {#each LANGUAGES as [v, l] (v)}<option value={v}>{l}</option>{/each}
  </select>
  {#if help}<span class="help">{help}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: var(--dim);
  }
  .help {
    font-size: 0.85em;
    color: var(--faint);
  }
</style>
