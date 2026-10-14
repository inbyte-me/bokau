<!-- Seconds left until a server-clock deadline. Used by the TV and the phones (same clock skew handling). -->
<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Props {
    /** epoch ms, server clock */
    deadline: number;
    /** server clock minus this clock, ms */
    skew?: number;
    /** under this many seconds the number turns signal red */
    urgent?: number;
  }
  let { deadline, skew = 0, urgent = 10 }: Props = $props();
  let now = $state(Date.now());
  const timer = setInterval(() => {
    now = Date.now();
  }, 250);
  onDestroy(() => clearInterval(timer));
  const left = $derived(Math.max(0, Math.ceil((deadline - (now + skew)) / 1000)));
</script>

<span class={['countdown', left <= urgent && 'urgent']} role="timer" aria-live="off">{left}</span>

<style>
  .countdown {
    font-variant-numeric: tabular-nums;
    font-family: var(--mono);
    color: var(--dim);
  }
  .urgent {
    color: var(--signal-text);
  }
</style>
