<!-- My line: watch the moment, record over it (3-2-1, my character silenced), listen back, send or redo.
     Kept to big buttons and one decision at a time: the whole turn should take well under a minute. -->
<script lang="ts">
  import type { LineView, PartyClient, PlayerView } from '@doblaje/party';
  import CharacterTag from '@doblaje/ui/components/CharacterTag.svelte';
  import Countdown from '@doblaje/ui/components/Countdown.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { PhoneRecorder } from './recorder.ts';

  interface Props {
    client: PartyClient<PlayerView>;
    recorder: PhoneRecorder;
    line: LineView;
    context: { before: LineView | null; after: LineView | null };
    turn: NonNullable<PlayerView['turn']>;
    skew: number;
    mode: PlayerView['mode'];
  }
  let { client, recorder, line, context, turn, skew, mode }: Props = $props();
  // blind dubbing and the trailer: improvise over a silent picture
  const silentScene = $derived(mode === 'blind' || mode === 'trailer');
  // blind dubbing only: first hear the last second of the previous take
  // a previous turn to pick up from: the turn opens on it (heard and, once transcribed, read), then the scene
  const previous = $derived(mode === 'blind' ? (context.before?.take ?? null) : null);
  /** the last words of the previous take: a hint of how it ended, not the whole take (the rest stays a mystery) */
  const lastWords = $derived.by(() => {
    const words = (context.before?.heard ?? '').split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    return (words.length > 8 ? '… ' : '') + words.slice(-8).join(' ');
  });
  let heardPrevious = $state(false);

  type Step = 'intro' | 'previous' | 'ready' | 'watching' | 'countdown' | 'recording' | 'review' | 'listening' | 'sending';
  let step = $state<Step>(untrack(() => (previous ? 'intro' : 'ready')));
  let count = $state(0);
  let error = $state('');
  const offs: (() => void)[] = [];

  onMount(() => {
    offs.push(
      recorder.session.on('countdown', (n: number) => {
        count = n;
      }),
      recorder.session.on('state', (s: string) => {
        if (s === 'countdown') step = 'countdown';
        if (s === 'recording') {
          step = 'recording';
          client.player({ type: 'status', turn: turn.n, status: 'recording' });
        }
      }),
    );
  });
  onDestroy(() => {
    for (const off of offs) off();
    recorder.stop();
  });

  /** The scene shows in this screen's video while the turn lasts (set up once: a new view must not seek again). */
  function scene(video: HTMLVideoElement) {
    untrack(() => {
      recorder.attachVideo(video);
      recorder.cue(line.start);
    });
    return () => recorder.detachVideo();
  }

  async function run(next: Step, fn: () => Promise<void>, after: Step) {
    error = '';
    step = next;
    try {
      await fn();
      step = after;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      step = recorder.take ? 'review' : 'ready';
    }
  }
  const watch = () =>
    run(
      'watching',
      () => {
        recorder.silent = silentScene;
        return recorder.watch(line);
      },
      recorder.take ? 'review' : 'ready',
    );
  /** Play the end of the previous take (on arrival, and again on request). */
  async function hearPrevious() {
    if (!previous) return;
    error = '';
    step = 'previous';
    try {
      await recorder.playPrevious(previous);
      heardPrevious = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    step = 'intro';
  }
  function introAttach() {
    untrack(() => void hearPrevious());
  }
  const record = () =>
    run(
      'countdown',
      async () => {
        recorder.silent = silentScene;
        await recorder.record(line);
        if (!recorder.take) throw new Error(t('Nothing was recorded. Check the microphone and try again.'));
        client.player({ type: 'status', turn: turn.n, status: 'reviewing' });
      },
      'review',
    );
  const listen = () => run('listening', () => recorder.listen(line), 'review');
  const send = () =>
    run(
      'sending',
      async () => {
        await recorder.submit(turn.n);
      },
      'sending',
    );
  function stop() {
    recorder.stop();
  }
  function pass() {
    recorder.stop();
    client.player({ type: 'pass', turn: turn.n });
  }
</script>

{#if step === 'intro' || step === 'previous'}
  <section class="screen turn intro" id="my-turn" data-step={step} data-heard={heardPrevious ? '' : undefined} {@attach introAttach}>
    <header>
      <CharacterTag name={line.characterName} color={line.color} />
      <span class="timer"><Countdown deadline={turn.deadline} {skew} /></span>
    </header>
    <p class="kicker">{t('Your turn')}</p>
    <h1>{t('How {name} ended', { name: context.before?.characterName ?? '' })}</h1>
    <div class={['ending', step === 'previous' && 'playing']} id="previous-ending" style:--c={context.before?.color}>
      {#if lastWords}
        <p class="words">“{lastWords}”</p>
      {:else}
        <p class="words dim">{step === 'previous' ? t('Listen…') : t('Their words are still being transcribed. Listen to how it ended.')}</p>
      {/if}
    </div>
    <p class="free">{t('Pick up from there. Next you see your silent stretch of the scene.')}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button id="hear-previous" class="big" disabled={step === 'previous'} onclick={hearPrevious}>{step === 'previous' ? t('Playing…') : t('Hear it again')}</button>
      <button id="ready-turn" class="primary big" onclick={() => (step = 'ready')}>{t('Ready')}</button>
    </div>
    <button id="pass" class="ghost" onclick={pass}>{t('Skip this line')}</button>
  </section>
{:else}
  <section class="screen turn" id="my-turn" data-step={step}>
    <header>
      <CharacterTag name={line.characterName} color={line.color} />
      <span class="timer"><Countdown deadline={turn.deadline} {skew} /></span>
    </header>

    <div class="stage">
      <video {@attach scene} playsinline muted preload="auto"></video>
      {#if step === 'countdown' && count > 0}<div class="count" aria-live="assertive">{count}</div>{/if}
      {#if step === 'recording'}<div class="rec" aria-live="polite"><span class="dot"></span>{t('Recording')}</div>{/if}
    </div>

    {#if line.card}<p class="persona" style:--c={line.color}><b>{line.characterName}</b> {line.card}</p>{/if}
    {#if mode === 'trailer'}
      <div class="script">
        <p class="other">{t('Direction from the room')}</p>
        <p class="mine" id="my-line" style:--c={line.color}>{line.direction ?? ''}</p>
        <p class="free">{t('The scene is silent. Say what you like: the room’s idea is only a hint.')}</p>
      </div>
    {:else if silentScene}
      <div class="script">
        <p class="mine" id="my-line" style:--c={line.color}>{t('Make up what they say. The scene is silent: it is all yours.')}</p>
        {#if context.before}
          <p class="other"><b>{context.before.characterName}:</b> {lastWords ? `“${lastWords}”` : t('pick up from where they ended.')}</p>
        {:else}
          <p class="free">{t('You start the story.')}</p>
        {/if}
      </div>
    {:else}
      <div class="script">
        {#if context.before}
          <p class="other">
            <b>{context.before.characterName}:</b>
            {#if context.before.heard}<span class="said" title={context.before.text}>“{context.before.heard}”</span>{:else}{context.before.text}{/if}
          </p>
        {/if}
        <p class="mine" id="my-line" style:--c={line.color}>{line.text}</p>
        {#if line.suggestion}
          <p class="suggestion" id="suggestion"><span class="tag">{t('Idea')}</span> {line.suggestion}</p>
        {/if}
        <p class="free">{t('Say the line, change it, or say anything you like.')}</p>
        {#if context.after}<p class="other"><b>{context.after.characterName}:</b> {context.after.text}</p>{/if}
      </div>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="actions">
      {#if step === 'ready'}
        <button id="watch" class="big" onclick={watch}>{t('Watch the scene')}</button>
        <button id="record" class="primary big rec-btn" onclick={record}>{t('Record')}</button>
      {:else if step === 'watching' || step === 'listening'}
        <button class="big" onclick={stop}>{t('Stop')}</button>
      {:else if step === 'countdown' || step === 'recording'}
        <button id="stop" class="primary big" onclick={stop}>{t('Stop')}</button>
      {:else if step === 'review'}
        <button id="listen" class="big" onclick={listen}>{t('Listen')}</button>
        <button id="redo" class="big" onclick={record}>{t('Record again')}</button>
        <button id="send" class="primary big" onclick={send}>{t('Send')}</button>
      {:else if step === 'sending'}
        <p class="lead" role="status">{t('Sending…')}</p>
      {/if}
    </div>
    {#if step === 'ready' || step === 'review'}
      <button id="pass" class="ghost" onclick={pass}>{t('Skip this line')}</button>
    {/if}
  </section>
{/if}
