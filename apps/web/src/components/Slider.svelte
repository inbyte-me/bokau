<!-- A labelled range input with its value shown. `oninput` while dragging (live, no undo step), `onchange` on
     release (the moment to commit). -->
<script lang="ts">
  interface Props {
    label: string;
    id: string;
    min: number;
    max: number;
    step: number;
    value: number;
    format?: (v: number) => string;
    oninput?: (v: number) => void;
    onchange?: (v: number) => void;
  }
  let { label, id, min, max, step, value, format = (v) => String(v), oninput, onchange }: Props = $props();
  let shown = $derived(value); // follows the prop, overridden while dragging
</script>

<div class="slider">
  <label for={id}>{label}</label>
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={(e) => {
      shown = +e.currentTarget.value;
      oninput?.(shown);
    }}
    onchange={(e) => onchange?.(+e.currentTarget.value)}
  />
  <span class="v">{format(shown)}</span>
</div>
