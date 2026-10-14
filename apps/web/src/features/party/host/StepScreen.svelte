<!-- The frame of a party screen: a big title, one line of explanation, the content, and the next step at the bottom. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    lead?: string;
    id?: string;
    children: Snippet;
    actions?: Snippet;
  }
  let { title, lead, id, children, actions }: Props = $props();
</script>

<section class="step-screen" {id}>
  <h1>{title}</h1>
  {#if lead}<p class="lead">{lead}</p>{/if}
  <div class="body">{@render children()}</div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</section>

<style>
  .step-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 100%;
  }
  h1 {
    margin: 0;
    font-family: var(--display);
    font-size: clamp(2.2rem, 4vw, 3.4rem);
    line-height: 1.02;
  }
  .lead {
    margin: 0;
    color: var(--dim);
    font-size: 1.15rem;
    max-width: 60rem;
  }
  .body {
    flex: 1;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    align-items: center;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }
  @media (prefers-reduced-motion: no-preference) {
    .step-screen {
      animation: enter 0.25s ease-out;
    }
    @keyframes enter {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
  }
</style>
