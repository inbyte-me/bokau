<!-- The current line, karaoke style: words light up as their syllable time arrives. Over the picture in the studio,
     the podcast review and the party showing. -->
<script lang="ts" module>
  import type { Cue } from '@doblaje/core';
  /** a line to show: timing and text, optionally who says it and how */
  export type KaraokeCue = Pick<Cue, 'start' | 'end' | 'text'> & Partial<Pick<Cue, 'id' | 'character' | 'direction'>>;
</script>

<script lang="ts">
  import { detectLang, wordTimings } from '@doblaje/core';

  interface Props {
    cues: readonly KaraokeCue[];
    /** playhead, seconds */
    time: number;
    /** seconds before a cue starts that it is shown, and after it ends */
    lead?: number;
    tail?: number;
    showWho?: boolean;
    showDirection?: boolean;
    /** shown when no line is active (otherwise nothing) */
    idle?: string | null;
  }
  let { cues, time, lead = 1.2, tail = 0.5, showWho = true, showDirection = true, idle = null }: Props = $props();

  const cue = $derived(cues.find((c) => time >= c.start - lead && time < c.end + tail && c.text) ?? null);
  // words are timed once per line, not every frame
  const words = $derived(cue ? wordTimings(cue, detectLang(cue.text)) : []);
</script>

{#if cue}
  <div class="cue-banner" id="cue-banner">
    {#if showWho && cue.character}<span class="who">{cue.character}</span>{/if}
    {#each words as w, i (i)}
      <span class={['w', time >= w.end ? 'done' : time >= w.start && 'cur']}>{w.text}</span>
    {/each}
    {#if showDirection && cue.direction}<span class="direction">{cue.direction}</span>{/if}
  </div>
{:else if idle}
  <div class="cue-banner"><span class="w">{idle}</span></div>
{/if}
