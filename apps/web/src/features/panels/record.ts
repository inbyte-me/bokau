import { h, icon, t } from '@doblaje/ui';
import { app } from '../../app.ts';
import { openDevices } from '../devices.ts';
import { mountTakes } from './takes.ts';
import { mountVoice } from './voice.ts';

/** Record tab: what happens while recording, the selected track's voice, and its takes. Devices live in their own dialog. */
export function mountRecord(root: HTMLElement): { destroy(): void } {
  const status = h('div.row#record-devices');
  const sync = () => {
    status.replaceChildren(
      app.mic.isOpen ? h('span.small.dim', `${t('Microphone')}: ${app.mic.info?.label || ''}`) : h('span.hint.warn', t('No microphone open yet.')),
      h('div.spacer'),
      h('button#record-devices-btn', { onclick: () => openDevices() }, icon('mic'), t('Devices')),
    );
  };
  sync();
  root.append(status);
  const voice = mountVoice(root, { sections: ['recording', 'fx'] });
  const takes = mountTakes(root);
  const offs = [app.on('mic', sync), app.on('devices-closed', sync)];
  return {
    destroy: () => {
      voice.destroy();
      takes.destroy();
      for (const off of offs) off();
    },
  };
}
