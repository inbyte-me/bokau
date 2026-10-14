<!-- Short messages in the corner (toast()); they never take layout space. -->
<script lang="ts">
  import { overlays } from '../overlays.svelte.ts';
</script>

<div id="toasts">
  {#each overlays.toasts as m (m.id)}
    <div class={['toast', m.kind, m.leaving && 'out']} role={m.kind === 'error' ? 'alert' : 'status'}>{m.text}</div>
  {/each}
</div>
