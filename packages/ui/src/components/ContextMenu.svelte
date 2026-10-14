<!-- The open context menu: keyboard accessible (arrows, Home/End, Escape, Tab closes), kept inside the window, closed
     by a click outside, scrolling, resizing or leaving the window. -->
<script lang="ts">
  import { type MenuAction, overlays } from '../overlays.svelte.ts';
  import Icon from './Icon.svelte';

  const menu = $derived(overlays.menu);
  let box = $state<HTMLElement | null>(null);
  let width = $state(0);
  let height = $state(0);
  const left = $derived(menu ? Math.max(4, Math.min(menu.x, innerWidth - width - 4)) : 0);
  const top = $derived(menu ? Math.max(4, Math.min(menu.y, innerHeight - height - 4)) : 0);

  const enabled = () => [...(box?.querySelectorAll<HTMLButtonElement>('.ctxitem:not(:disabled)') ?? [])];
  function focusAt(i: number) {
    const list = enabled();
    if (list.length) list[(i + list.length) % list.length].focus();
  }
  /** the first enabled item has focus when a menu opens */
  function autofocus(_el: HTMLElement) {
    if (menu) queueMicrotask(() => focusAt(0));
  }
  function keys(e: KeyboardEvent) {
    if (!menu) return;
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      overlays.closeMenu();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(i < 0 ? -1 : i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(-1);
    } else if (e.key === 'Tab') overlays.closeMenu();
    e.stopPropagation(); // the studio's single-key shortcuts must not fire while the menu is open
  }
  function outside(e: Event) {
    if (menu && box && !box.contains(e.target as Node)) overlays.closeMenu();
  }
  function run(item: MenuAction) {
    overlays.closeMenu();
    void item.run();
  }
  const close = () => {
    if (menu) overlays.closeMenu();
  };
</script>

<svelte:window onkeydowncapture={keys} onpointerdowncapture={outside} onblur={close} onresize={close} onwheelcapture={close} />

{#if menu}
  {#key menu}
    <div
      class="ctxmenu"
      role="menu"
      aria-label={menu.label}
      tabindex="-1"
      bind:this={box}
      bind:clientWidth={width}
      bind:clientHeight={height}
      style:left={`${left}px`}
      style:top={`${top}px`}
      {@attach autofocus}
    >
      {#each menu.items as item, i (i)}
        {#if item === 'separator'}
          <div class="ctxsep" role="separator"></div>
        {:else}
          <button class={['ctxitem', item.danger && 'danger']} role="menuitem" disabled={!!item.disabled} onclick={() => run(item)}>
            {#if item.icon}<Icon name={item.icon} size={14} />{:else}<span class="ctxicon"></span>{/if}
            <span class="ctxlabel">{item.label}</span>
            {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/key}
{/if}
