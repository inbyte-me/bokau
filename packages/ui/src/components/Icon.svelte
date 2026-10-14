<!-- One icon of the shared line set (16px grid, 1.5px strokes). Decorative: give the button a label or title. -->
<script lang="ts">
  import { iconPath } from '../icons.ts';

  interface Props {
    name: string;
    size?: number;
  }
  let { name, size = 16 }: Props = $props();
  const p = $derived(iconPath(name));
</script>

<svg class="ic" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  {#if p.mode === 'fill'}
    <path d={p.d} fill="currentColor" stroke="none" />
  {:else}
    <path
      d={p.d}
      fill={p.mode === 'mix' ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {/if}
</svg>
