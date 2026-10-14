// The microphone as Svelte sees it: open or not, its name and details, the live level (meters), and opening it
// with the user's choices. The Mic itself stays a plain class in @doblaje/audio.
import { type InputChannel, type Level, Mic } from '@doblaje/audio';
import { errorMessage } from '@doblaje/core';
import { t, toast } from '@doblaje/ui';
import { createSubscriber } from 'svelte/reactivity';
import { app } from '../app.svelte.ts';

class MicStatus {
  #level = createSubscriber((update) => app.mic.on('level', update));
  #state = createSubscriber((update) => {
    const offs = [app.on('mic', update), app.on('devices-closed', update), app.mic.on('auto-channel', update)];
    return () => {
      for (const off of offs) off();
    };
  });

  get open(): boolean {
    this.#state();
    return app.mic.isOpen;
  }
  get name(): string {
    this.#state();
    return app.mic.info?.label?.replace(/\s*\(.*\)$/, '') ?? '';
  }
  /** label · channels · sample rate (after opening) */
  get details(): string {
    this.#state();
    const i = app.mic.info;
    if (!i) return '';
    const auto = app.mic.autoChannel;
    const base = `${i.label} · ${i.channelCount || '?'} ch · ${Math.round((i.sampleRate || 48000) / 1000)} kHz${(i.channelCount || 1) > 1 ? '' : ` · ${t('mono input')}`}`;
    if (app.mic.settings.channel !== 'auto' || !auto) return base;
    return `${i.label} · ${t('Auto')}: ${
      auto === 'mix'
        ? t('both inputs carry signal')
        : auto === 'left'
          ? t('using Input 1 / Left (the other input is silent)')
          : t('using Input 2 / Right (the other input is silent)')
    }`;
  }
  get stereo(): boolean {
    this.#state();
    return (app.mic.info?.channelCount || 1) > 1;
  }
  /** 0..1 on a 60 dB scale */
  get level(): number {
    this.#level();
    const db = app.mic.last.peakDb ?? -120;
    return Math.min(1, Math.max(0, (Math.max(-60, db) + 60) / 60));
  }
  /** the last level reading (peak/RMS in dB, clipping) */
  get reading(): Level {
    this.#level();
    return app.mic.last;
  }
}
export const mic = new MicStatus();

let opening: { key: string; done: Promise<boolean> } | null = null;

/**
 * Open (or reopen) the microphone with the given choices. Reports failures to the user; returns whether it opened.
 * A second call while the same open is still in progress joins it (reopening would restart channel detection).
 */
export function openMic(choice: { deviceId?: string; channel?: InputChannel; gainDb?: number } = {}): Promise<boolean> {
  const key = JSON.stringify([choice.deviceId || app.mic.settings.deviceId || 'default', choice.channel ?? app.mic.settings.channel]);
  if (opening?.key === key) return opening.done;
  const done = reallyOpen(choice).finally(() => {
    if (opening?.done === done) opening = null;
  });
  opening = { key, done };
  return done;
}

async function reallyOpen(choice: { deviceId?: string; channel?: InputChannel; gainDb?: number }): Promise<boolean> {
  try {
    await app.engine.init();
    await app.engine.resume();
    await app.mic.open({ deviceId: choice.deviceId || app.mic.settings.deviceId || 'default', ...choice });
    app.emit('mic', true);
    return true;
  } catch (e) {
    toast(t('Microphone error: {m}', { m: errorMessage(e) }), 'error');
    return false;
  }
}

/** Inputs and outputs the browser can see (names appear once the mic has been allowed). */
export const listDevices = (): ReturnType<typeof Mic.devices> => Mic.devices();
