<!-- A character's name with its colour, as on the studio's tracks and lanes. -->
<script lang="ts">
  interface Props {
    name: string;
    color: string;
    size?: 'normal' | 'big';
  }
  let { name, color, size = 'normal' }: Props = $props();
</script>

<span class="tag {size}" style:--c={color}><span class="dot"></span>{name}</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.45em;
    font-weight: 600;
  }
  .dot {
    width: 0.7em;
    height: 0.7em;
    border-radius: 50%;
    background: var(--c);
    flex: none;
  }
  .big {
    font-family: var(--display);
    font-size: 2rem;
    letter-spacing: 0.01em;
  }
</style>
