<!-- The host's hands during a round: more time, skip the turn, end the round. The TV and a phone host use the same buttons. -->
<script lang="ts">
  import type { HostCommand } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';

  interface Props {
    send: (command: HostCommand) => void;
    /** the pitch and the cards have no turn to skip */
    turns?: boolean;
  }
  let { send, turns = true }: Props = $props();
</script>

<div class="controls">
  {#if turns}
    <button onclick={() => send({ type: 'extend', seconds: 15 })}>{t('+15 s')}</button>
    <button id="skip-line" onclick={() => send({ type: 'skip' })}>{t('Skip this line')}</button>
  {/if}
  <button class="ghost" id="finish" onclick={() => send({ type: 'finish' })}>{t('Finish now')}</button>
</div>

<style>
  .controls {
    grid-area: ctl;
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
</style>
