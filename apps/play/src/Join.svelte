<script lang="ts">
  import { CODE_ALPHABET, CODE_LENGTH } from '@doblaje/party';
  import { t } from '@doblaje/ui/i18n';
  import { untrack } from 'svelte';

  interface Props {
    code: string;
    name: string;
    error: string;
    onjoin: (code: string, name: string) => void;
    /** open a room of my own (I will be its host) */
    oncreate: (name: string) => void;
    /** hosting needs a sign-in on this server */
    loginRequired?: boolean;
    person?: { id: string; name: string } | null;
  }
  let { code, name, error, onjoin, oncreate, loginRequired = false, person = null }: Props = $props();
  // editable copies, seeded once from the props
  let roomCode = $state(untrack(() => code));
  let myName = $state(untrack(() => name));
  const named = $derived(myName.trim().length > 0);
  const valid = $derived(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(roomCode.toUpperCase()) && named);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (valid) onjoin(roomCode.toUpperCase(), myName.trim());
  }
</script>

<form class="screen join" onsubmit={submit}>
  <header>
    <span class="brand"><span class="dot"></span>Doblaje</span>
    <h1>{t('Join the party')}</h1>
    <p class="lead">{t('Grab your headphones. You will record your lines on this phone.')}</p>
  </header>
  <label>
    <span>{t('Room code')}</span>
    <input
      id="room-code"
      bind:value={roomCode}
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      maxlength={CODE_LENGTH}
      inputmode="text"
      placeholder="ABCD"
      class="code"
    />
  </label>
  <label>
    <span>{t('Your name')}</span>
    <input id="player-name" bind:value={myName} autocomplete="nickname" maxlength="24" placeholder={t('Name')} />
  </label>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <button id="join" class="primary big" type="submit" disabled={!valid}>{t('Join')}</button>
  <p class="or">{t('or')}</p>
  <button id="create-room" class="big" type="button" disabled={!named && !(loginRequired && !person)} onclick={() => oncreate(myName.trim())}>
    {loginRequired && !person ? t('Sign in to create a room') : t('Create a room')}
  </button>
  <p class="hint">{t('You will host it from this phone and play too. Share the link with your friends.')}</p>
  {#if person}<p class="hint">{t('Signed in as {name}.', { name: person.name })} <a href="/auth/logout">{t('Sign out')}</a></p>{/if}
</form>

<style>
  /* the welcome stacks: brand, title, then what to expect (the shared .screen header is the in-room top bar) */
  .join header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .join h1 {
    font-size: 2.6rem;
    line-height: 1;
    margin: 0.4rem 0 0;
  }
  .join .lead {
    margin: 0;
  }
  .or,
  .hint {
    margin: 0;
    text-align: center;
    color: var(--faint);
  }
</style>
