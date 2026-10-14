// What the current screen shows in the top bar (between File and the save state). A screen sets it while mounted.
import type { Snippet } from 'svelte';

class ScreenBar {
  content = $state.raw<Snippet | null>(null);
  /** show `s` in the top bar; returns the function that removes it (call it in onDestroy) */
  show(s: Snippet): () => void {
    this.content = s;
    return () => {
      if (this.content === s) this.content = null;
    };
  }
}
export const screenBar = new ScreenBar();
