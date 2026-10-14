<!-- A QR code for a URL, drawn as SVG squares (dark on light, with a quiet zone). -->
<script lang="ts">
  import { encode } from 'uqr';

  interface Props {
    url: string;
    label: string;
    size?: string;
  }
  let { url, label, size = '100%' }: Props = $props();
  const qr = $derived(encode(url, { border: 2 }));
  const modules = $derived(qr.data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [{ x, y }] : []))));
</script>

<svg class="qr" viewBox="0 0 {qr.size} {qr.size}" role="img" aria-label={label} shape-rendering="crispEdges" style:width={size}>
  <rect width={qr.size} height={qr.size} fill="#ebe9e4" />
  {#each modules as m (m.y * qr.size + m.x)}<rect x={m.x} y={m.y} width="1" height="1" fill="#121211" />{/each}
</svg>

<style>
  .qr {
    display: block;
    height: auto;
    border-radius: 6px;
  }
</style>
