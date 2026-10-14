<!-- A dialog on the native <dialog> element: the browser traps focus, Escape closes, it sits above everything.
     Render it only while open: {#if open}<Modal …>{/if}. Clicking the backdrop closes it too. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    /** id of the dialog box (tests and contracts use it) */
    id?: string;
    onclose: () => void;
    children: Snippet;
    /** buttons, right-aligned at the bottom */
    actions?: Snippet;
    width?: string;
  }
  let { title, id, onclose, children, actions, width = 'min(720px, 94vw)' }: Props = $props();

  function show(d: HTMLDialogElement) {
    d.showModal();
    return () => d.close();
  }
</script>

<dialog
  class="modal-dialog"
  aria-label={title}
  {@attach show}
  oncancel={(e) => {
    e.preventDefault(); // Escape: close through the owner, so its state stays the truth
    onclose();
  }}
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="modal" {id} style:width>
    <h2>{title}</h2>
    {@render children()}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</dialog>

<style>
  .modal-dialog {
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    max-width: none;
    max-height: none;
    overflow: visible;
  }
  .modal-dialog::backdrop {
    background: rgb(0 0 0 / 0.72);
  }
  .modal {
    background: var(--panel);
    border: 1px solid var(--line2);
    border-radius: 4px;
    max-width: 94vw;
    max-height: 90vh;
    overflow-x: hidden;
    overflow-y: auto; /* scroll */
    overscroll-behavior: contain;
    padding: 1.2rem 1.4rem;
  }
  h2 {
    margin: 0 0 1rem;
    font-size: 1.15rem;
    font-weight: 650;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.2rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--line);
  }
</style>
