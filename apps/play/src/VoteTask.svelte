<!-- Vote for one of the texts (never your own: the server leaves it out). The vote can be changed until the stage ends. -->
<script lang="ts">
  interface Props {
    options: { id: string; text: string }[];
    voted: string | null;
    onvote: (id: string) => void;
  }
  let { options, voted, onvote }: Props = $props();
</script>

<ul class="options" role="radiogroup">
  {#each options as o (o.id)}
    <li>
      <button class={['option', voted === o.id && 'on']} role="radio" aria-checked={voted === o.id} onclick={() => onvote(o.id)}>{o.text}</button>
    </li>
  {/each}
</ul>

<style>
  .options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .option {
    width: 100%;
    min-height: 56px;
    text-align: left;
    font-size: 1.1rem;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .option.on {
    border-color: var(--signal);
    box-shadow: inset 6px 0 0 var(--signal);
  }
</style>
