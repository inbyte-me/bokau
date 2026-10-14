// The phone's audio for one round: the recorder, loaded as soon as the phone is cast (the scene downloads while
// others play), plus whether the player said "headphones on" (which also asks for the microphone).
import { t } from '@doblaje/ui/i18n';
import { PhoneRecorder } from './recorder.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class RoundAudio {
  readonly recorder: PhoneRecorder;
  loaded = $state(false);
  ready = $state(false);
  error = $state('');

  constructor(code: string, token: string) {
    this.recorder = new PhoneRecorder(code, token);
    this.recorder
      .load()
      .then(() => {
        this.loaded = true;
      })
      .catch((e: unknown) => {
        this.error = message(e);
      });
  }

  /** The tap that unlocks audio and asks for the microphone, before the first turn. */
  async getReady(): Promise<void> {
    this.ready = true;
    try {
      await this.recorder.openMic();
    } catch (e) {
      this.error = t('Allow the microphone to record your lines. ({error})', { error: message(e) });
      this.ready = false;
    }
  }

  dispose(): void {
    this.recorder.dispose();
  }
}

declare global {
  interface Window {
    /** the round's audio on this phone (debugging, e2e tests) */
    __phone: RoundAudio | null;
  }
}
