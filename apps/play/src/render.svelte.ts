// The host phone's side of a finished round: the server asks for the mix (the shared graph can only run in a browser),
// this renders it from the round's project and takes, and sends it back. Everyone then plays the one file the server makes.
import { audioBufferToWav, Engine, renderStem } from '@doblaje/audio';
import type { Project } from '@doblaje/core';
import { partyMedia } from './media.ts';

export class MixRender {
  state = $state<'idle' | 'rendering' | 'error'>('idle');
  error = $state('');

  async run(code: string, token: string): Promise<void> {
    if (this.state === 'rendering') return;
    this.state = 'rendering';
    this.error = '';
    try {
      const headers = { 'x-party-token': token };
      const r = await fetch(`/api/party/rooms/${code}/project`, { headers });
      if (!r.ok) throw new Error(`project: ${r.status}`);
      const project = (await r.json()) as Project;
      const engine = new Engine();
      engine.mediaUrl = (_id, file) => partyMedia(code, token, file);
      await engine.load(project, null);
      if (!engine.assets) throw new Error('nothing to render');
      const mix = await renderStem(project, engine.assets, 'mix');
      const up = await fetch(`/api/party/rooms/${code}/mix`, { method: 'POST', headers, body: audioBufferToWav(mix, 16) });
      if (!up.ok) throw new Error(`mix: ${up.status}`);
      this.state = 'idle';
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.state = 'error';
    }
  }
}
