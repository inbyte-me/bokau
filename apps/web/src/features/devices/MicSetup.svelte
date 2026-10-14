<!-- Microphone / audio interface: which input, which channel of a 2-in interface, trim, a live meter, and a mic check
     that listens to silence then speech and says what to fix. -->
<script lang="ts">
  import { type InputChannel, type MicAdvice, type MicCheck } from '@doblaje/audio';
  import { clamp, errorMessage } from '@doblaje/core';
  import { toast } from '@doblaje/ui';
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { onMount } from 'svelte';
  import { app } from '../../app.svelte.ts';
  import { listDevices, mic, openMic } from '../../shell/mic.svelte.ts';

  interface Props {
    /** open the mic as soon as the dialog shows, so the meter answers right away */
    autoOpen?: boolean;
  }
  let { autoOpen = false }: Props = $props();

  const ADVICE: Record<MicAdvice, ['ok' | 'warn' | 'bad', string]> = {
    good: ['ok', t('Your mic level and noise floor look good.')],
    silent: ['bad', t('Nothing came through. Check the mic/interface is plugged in, the right input is selected, and the gain knob on the interface is up.')],
    clipping: ['bad', t('Too loud — it is clipping. Turn the gain knob on the interface down (or the trim slider here) and stay ~15 cm from the mic.')],
    'too-quiet': ['warn', t('Very quiet. Raise the interface gain knob first (best), then the trim slider here.')],
    quiet: ['warn', t('A bit quiet. Raise the gain a little; use the suggested trim below.')],
    noisy: ['warn', t('Background noise is high. Move closer to the mic, turn off fans, and enable "Clean up" on the track.')],
    'low-snr': ['warn', t('Voice is not much louder than the noise. Get closer to the mic or add trim.')],
  };

  let inputs = $state.raw<MediaDeviceInfo[]>([]);
  let labelled = $state(true);
  let deviceId = $state(app.mic.settings.deviceId);
  let channel = $state<InputChannel>(app.mic.settings.channel);
  let gain = $state(app.mic.settings.gainDb);
  let checking = $state(false);
  let checkSay = $state('');
  let check = $state.raw<MicCheck | null>(null);

  async function rescan() {
    const d = await listDevices();
    inputs = d.inputs;
    labelled = d.labelled;
    if (app.mic.isOpen) deviceId = app.mic.settings.deviceId;
  }
  // only built-in or virtual inputs: probably a charge-only cable or an unpowered interface
  const noInterface = $derived(labelled && !inputs.some((i) => !/built-in|integrad|virtual|zoom|predeterminado|default/i.test(i.label)));

  async function open() {
    if (await openMic({ deviceId: deviceId || 'default', channel, gainDb: gain })) await rescan();
  }
  function setGain(v: number) {
    gain = v;
    app.mic.setGainDb(v);
  }
  async function runCheck() {
    if (!app.mic.isOpen) await open();
    if (!app.mic.isOpen) return;
    checking = true;
    check = null;
    try {
      check = await app.mic.check({
        onPhase: (ph) => {
          checkSay = ph === 'silence' ? t('Stay quiet for 2 seconds…') : t('Now speak normally for 3 seconds (e.g. "testing one two three")…');
        },
      });
      checkSay = '';
    } catch (e) {
      checkSay = errorMessage(e);
    } finally {
      checking = false;
    }
  }
  function applyTrim(r: MicCheck) {
    const v = clamp(Math.round((app.mic.settings.gainDb + r.suggestedGainDb) * 2) / 2, -12, 36);
    setGain(v);
    toast(t('Trim set to {v} dB', { v }), 'ok');
  }

  // the meter: level, a slowly falling peak tick, the numbers
  const reading = $derived(mic.reading);
  let held = 0; // the last peak tick position (memory of the derived below, not state)
  const peakHold = $derived.by(() => {
    held = Math.max(mic.level, held - 0.01);
    return held;
  });
  const db = (v: number | undefined, digits: number) => ((v ?? -120) > -90 ? (v ?? 0).toFixed(digits) : '-∞');

  onMount(() => {
    void rescan();
    if (autoOpen && !app.mic.isOpen) void open();
    const onChange = () => void rescan();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  });
  const fmtGain = (v: number) => `${v >= 0 ? '+' : ''}${v} dB`;
</script>

<div class="box">
  <h4>{t('Microphone / audio interface')}</h4>
  <div class="field">
    <label for="mic-device">{t('Input device')}</label>
    <div class="row">
      <select
        id="mic-device"
        bind:value={deviceId}
        onchange={() => {
          if (app.mic.isOpen) void open();
        }}
      >
        {#each inputs as i (i.deviceId)}<option value={i.deviceId}>{i.label || `${t('Microphone')} ${i.deviceId.slice(0, 4)}`}</option>{/each}
      </select>
      <button class="icon" id="rescan" title={t('Rescan devices')} onclick={rescan}><Icon name="refresh" /></button>
    </div>
  </div>
  {#if noInterface}
    <div class="hint warn" id="no-interface-hint">
      {t(
        'Only built-in or virtual inputs are visible. If you expected a USB audio interface, check that its cable carries data (not charge-only), try another port, then press Rescan.',
      )}
    </div>
  {/if}
  <div class="field">
    <label for="mic-channel">{t('Interface channel')}</label>
    <select id="mic-channel" bind:value={channel} disabled={mic.open && !mic.stereo} onchange={() => app.mic.setChannel(channel)}>
      <option value="auto">{t('Auto')}</option>
      <option value="left">{t('Input 1 / Left')}</option>
      <option value="right">{t('Input 2 / Right')}</option>
      <option value="mix">{t('Mix both')}</option>
    </select>
  </div>
  <div class="slider">
    <label for="mic-gain">{t('Input trim')}</label>
    <input id="mic-gain" type="range" min="-12" max="36" step="0.5" value={gain} oninput={(e) => setGain(Number(e.currentTarget.value))} />
    <span class="v">{fmtGain(gain)}</span>
  </div>
  <div class="meter big" id="mic-meter"><i style:width={`${mic.level * 100}%`}></i><b style:left={`${peakHold * 100}%`}></b></div>
  <div class="small mono dim" id="mic-db" style:color={reading.clipped ? 'var(--signal-text)' : undefined}>
    {db(reading.peakDb, 1)} dB peak · {db(reading.rmsDb, 0)} dB rms{reading.clipped ? ' · CLIP!' : ''}
  </div>
  <div class="hint" id="mic-info">{mic.open ? mic.details : labelled ? '' : t('Click "Open mic" to allow microphone access — device names appear after that.')}</div>
  <div class="row">
    <button class={['primary', mic.open && 'on']} id="mic-open" onclick={open}><Icon name="mic" />{mic.open ? t('Mic open') : t('Open mic')}</button>
    <button id="mic-check" disabled={checking} onclick={runCheck}><Icon name="sliders" />{t('Mic check')}</button>
  </div>
  <div class="col" id="mic-check-out">
    {#if checkSay}<div class="hint">{checkSay}</div>{/if}
    {#if check}
      {@const r = check}
      {#each r.advice as a (a)}<div class={['hint', ADVICE[a][0] !== 'ok' && 'warn']}>{ADVICE[a][1]}</div>{/each}
      <div class="small mono dim">
        {t('noise floor')} {r.noiseDb.toFixed(0)} dB · {t('speech')} {r.speechDb.toFixed(0)} dB · {t('peak')} {r.peakDb.toFixed(0)} dB · SNR {r.snr.toFixed(0)} dB
      </div>
      {#if Math.abs(r.suggestedGainDb) > 2 && !r.advice.includes('silent')}
        <button id="apply-trim" onclick={() => applyTrim(r)}
          >{t('Apply suggested trim ({v} dB)', { v: `${r.suggestedGainDb > 0 ? '+' : ''}${r.suggestedGainDb.toFixed(0)}` })}</button
        >
      {/if}
    {/if}
  </div>
</div>
