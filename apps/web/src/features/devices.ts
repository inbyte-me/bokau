// Devices: one place for microphone, headphones/speakers, camera and latency (a "green room" before recording),
// reachable from the top bar on every screen. The chip shows at a glance whether the mic is open and hearing you.
import { clamp, errorMessage } from '@doblaje/core';
import { clear, h, icon, t } from '@doblaje/ui';
import { app } from '../app.ts';
import { mountVoice } from './panels/voice.ts';

const CAMERA_KEY = 'cameraId';
export const savedCamera = (): string => {
  try {
    return localStorage.getItem(CAMERA_KEY) || '';
  } catch {
    return '';
  }
};

function cameraBox(): { el: HTMLElement; destroy(): void } {
  const sel = h('select#cam-pick');
  const video = h('video#cam-test', {
    muted: true,
    playsInline: true,
    autoplay: true,
    style: { width: '100%', maxHeight: '220px', background: '#000', transform: 'scaleX(-1)' },
  });
  const note = h('div.hint');
  let stream: MediaStream | null = null;
  const stop = () => {
    for (const tr of stream?.getTracks() || []) tr.stop();
    stream = null;
    video.srcObject = null;
  };
  const show = async () => {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: sel.value ? { exact: sel.value } : undefined }, audio: false });
      video.srcObject = stream;
      const cur = stream.getVideoTracks()[0]?.getSettings().deviceId || '';
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      clear(sel);
      for (const c of cams) sel.append(h('option', { value: c.deviceId, selected: c.deviceId === cur }, c.label || t('Camera')));
      try {
        localStorage.setItem(CAMERA_KEY, cur);
      } catch {}
      note.textContent = '';
    } catch (e) {
      note.textContent = t('Camera unavailable: {m}. You can still record audio only.', { m: errorMessage(e) });
    }
  };
  sel.onchange = () => void show();
  const start = h('button#cam-test-btn', { onclick: () => void show() }, icon('play'), t('Show camera'));
  const el = h(
    'div.box#camera-box',
    h('h4', t('Camera')),
    h('div.row', sel, start),
    video,
    note,
    h('div.hint', t('Used by podcast recordings. Dubbing does not need a camera.')),
  );
  return { el, destroy: stop };
}

/** The Devices dialog. */
export function openDevices(): { close: () => void } {
  const body = h('div.col');
  const voice = mountVoice(body, { sections: ['devices'], autoOpen: true });
  const cam = cameraBox();
  body.append(cam.el);
  const back: HTMLElement = h('div.modal-back', {
    onclick: (e) => {
      if (e.target === back) close();
    },
  });
  const close = () => {
    voice.destroy();
    cam.destroy();
    back.remove();
    app.emit('devices-closed');
  };
  back.append(
    h(
      'div.modal#devices',
      h('h2', t('Devices')),
      h('div.hint', t('Pick your microphone, check that the meter moves when you speak, and say whether you wear headphones.')),
      body,
      h('div.actions', h('button.primary#devices-done', { onclick: close }, t('Done'))),
    ),
  );
  document.body.append(back);
  return { close };
}

/** Top-bar status: mic state + live level; opens the Devices dialog. */
export function devicesChip(): { el: HTMLElement; destroy(): void } {
  const fill = h('i');
  const meter = h('span.chip-meter', fill);
  const label = h('span.chip-label');
  const el = h(
    'button.chip.devices#devices-btn',
    { title: t('Microphone, headphones, camera and latency'), onclick: () => openDevices() },
    icon('mic', 13),
    label,
    meter,
  );
  const sync = () => {
    const open = app.mic.isOpen;
    label.textContent = open ? app.mic.info?.label?.replace(/\s*\(.*\)$/, '') || t('Mic open') : t('Set up mic');
    el.classList.toggle('ok', open);
    el.classList.toggle('warn', !open);
    if (!open) fill.style.width = '0';
  };
  const offs = [
    app.mic.on('level', (l) => {
      fill.style.width = `${clamp((Math.max(-60, l.peakDb ?? -120) + 60) / 60, 0, 1) * 100}%`;
    }),
    app.on('mic', sync),
    app.on('devices-closed', sync),
  ];
  sync();
  return {
    el,
    destroy: () => {
      for (const off of offs) off();
    },
  };
}
