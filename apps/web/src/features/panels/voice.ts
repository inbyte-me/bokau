import { calibrateLatency, FX_INFO, type InputChannel, Mic, type MicAdvice } from '@doblaje/audio';
import { clamp, errorMessage, type FxPreset, type Track } from '@doblaje/core';
import { clear, h, icon, t, toast } from '@doblaje/ui';
import { app } from '../../app.ts';
import { denoiseClip } from '../actions.ts';

const ADVICE: Record<MicAdvice, ['ok' | 'warn' | 'bad', string]> = {
  good: ['ok', 'Your mic level and noise floor look good.'],
  silent: ['bad', 'Nothing came through. Check the mic/interface is plugged in, the right input is selected, and the gain knob on the interface is up.'],
  clipping: ['bad', 'Too loud — it is clipping. Turn the gain knob on the interface down (or the trim slider here) and stay ~15 cm from the mic.'],
  'too-quiet': ['warn', 'Very quiet. Raise the interface gain knob first (best), then the trim slider here.'],
  quiet: ['warn', 'A bit quiet. Raise the gain a little; use the suggested trim below.'],
  noisy: ['warn', 'Background noise is high. Move closer to the mic, turn off fans, and enable "Clean up" on the track.'],
  'low-snr': ['warn', 'Voice is not much louder than the noise. Get closer to the mic or add trim.'],
};

export type VoiceSection = 'devices' | 'recording' | 'fx';

/**
 * Microphone, listening and recording controls. `devices` = mic, headphones/speakers, latency (the Devices dialog);
 * `recording` = count-in and what plays while recording; `fx` = the selected track's voice effect (the Record tab).
 */
export function mountVoice(
  root: HTMLElement,
  { sections = ['devices', 'recording', 'fx'], autoOpen = false }: { sections?: VoiceSection[]; autoOpen?: boolean } = {},
): { destroy(): void } {
  const has = (sec: VoiceSection) => sections.includes(sec);
  const p = () => app.project;
  const mic = app.mic;
  const s = () => p().settings;
  const meterFill = h('i');
  const peakTick = h('b');
  const meter = h('div.meter.big#mic-meter', meterFill, peakTick);
  const meterTxt = h('div.small.mono.dim#mic-db', '— dB');
  const inSel = h('select#mic-device');
  const outSel = h('select#out-device');
  const chSel = h(
    'select#mic-channel',
    ...[
      ['auto', t('Auto')],
      ['left', t('Input 1 / Left')],
      ['right', t('Input 2 / Right')],
      ['mix', t('Mix both')],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const info = h('div.hint#mic-info');
  const hint = h('div.hint.warn#no-interface-hint');
  let peakHold = 0;

  async function fillDevices() {
    const d = await Mic.devices();
    clear(inSel);
    clear(outSel);
    for (const i of d.inputs)
      inSel.append(
        h('option', { value: i.deviceId, selected: i.deviceId === mic.settings.deviceId }, i.label || `${t('Microphone')} ${i.deviceId.slice(0, 4)}`),
      );
    for (const o of d.outputs) outSel.append(h('option', { value: o.deviceId }, o.label || `${t('Output')} ${o.deviceId.slice(0, 4)}`));
    if (!d.labelled) info.textContent = t('Click "Open mic" to allow microphone access — device names appear after that.');
    else {
      const external = d.inputs.filter((i) => !/built-in|integrad|virtual|zoom|predeterminado|default/i.test(i.label));
      hint.textContent = external.length
        ? ''
        : t(
            'Only built-in or virtual inputs are visible. If you expected a USB audio interface, check that its cable carries data (not charge-only), try another port, then press Rescan.',
          );
    }
  }
  const onDevices = () => void fillDevices();
  navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);

  async function openMic() {
    try {
      await app.engine.init();
      await app.engine.resume();
      const i = await mic.open({ deviceId: inSel.value || 'default', channel: chSel.value as InputChannel, gainDb: Number(gain.value) });
      await fillDevices();
      info.textContent = `${i.label} · ${i.channelCount || '?'} ch · ${Math.round((i.sampleRate || 48000) / 1000)} kHz${(i.channelCount || 1) > 1 ? '' : ` · ${t('mono input')}`}`;
      chSel.disabled = (i.channelCount || 1) < 2;
      openBtn.replaceChildren(icon('mic'), t('Mic open'));
      openBtn.classList.add('on');
      app.emit('mic', true);
    } catch (e) {
      toast(t('Microphone error: {m}', { m: errorMessage(e) }), 'error');
      info.textContent = errorMessage(e);
    }
  }
  const openBtn = h('button.primary#mic-open', { onclick: () => void openMic() }, icon('mic'), t('Open mic'));
  const fmtGain = (v: number) => `${v >= 0 ? '+' : ''}${v} dB`;
  const gv = h('span.v', fmtGain(mic.settings.gainDb));
  const setGain = (v: number) => {
    gain.value = String(v);
    mic.setGainDb(v);
    gv.textContent = fmtGain(v);
  };
  const gain = h('input#mic-gain', {
    type: 'range',
    min: '-12',
    max: '36',
    step: '0.5',
    value: String(mic.settings.gainDb),
    oninput: (e) => setGain(Number(e.target.value)),
  });
  inSel.onchange = () => {
    if (mic.isOpen) void openMic();
  };
  chSel.onchange = () => mic.setChannel(chSel.value as InputChannel);
  outSel.onchange = async () => {
    try {
      await app.engine.setOutputDevice(outSel.value);
      toast(t('Output switched'), 'ok');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const offs = [
    mic.on('auto-channel', (c) => {
      info.textContent = `${mic.info?.label || ''} · ${t('Auto')}: ${c === 'mix' ? t('both inputs carry signal') : c === 'left' ? t('using Input 1 / Left (the other input is silent)') : t('using Input 2 / Right (the other input is silent)')}`;
    }),
    mic.on('level', (l) => {
      const peakDb = l.peakDb ?? -120;
      const rmsDb = l.rmsDb ?? -120;
      const db = Math.max(-60, peakDb);
      const f = clamp((db + 60) / 60, 0, 1);
      meterFill.style.width = `${f * 100}%`;
      peakHold = Math.max(f, peakHold - 0.01);
      peakTick.style.left = `${peakHold * 100}%`;
      meterTxt.textContent = `${peakDb > -90 ? peakDb.toFixed(1) : '-∞'} dB peak · ${rmsDb > -90 ? rmsDb.toFixed(0) : '-∞'} dB rms${l.clipped ? ' · CLIP!' : ''}`;
      meterTxt.style.color = l.clipped ? 'var(--rec)' : '';
    }),
  ];

  // ---- mic check wizard ----
  const checkOut = h('div.col#mic-check-out');
  const checkBtn: HTMLButtonElement = h(
    'button#mic-check',
    {
      onclick: async () => {
        if (!mic.isOpen) await openMic();
        if (!mic.isOpen) return;
        checkBtn.disabled = true;
        clear(checkOut);
        const say = (m: string) => {
          clear(checkOut);
          checkOut.append(h('div.hint', m));
        };
        try {
          const r = await mic.check({
            onPhase: (ph) => say(ph === 'silence' ? t('Stay quiet for 2 seconds…') : t('Now speak normally for 3 seconds (e.g. "testing one two three")…')),
          });
          clear(checkOut);
          for (const a of r.advice) {
            const [k, msg] = ADVICE[a];
            checkOut.append(h(`div.hint${k === 'ok' ? '' : '.warn'}`, t(msg)));
          }
          checkOut.append(
            h(
              'div.small.mono.dim',
              `${t('noise floor')} ${r.noiseDb.toFixed(0)} dB · ${t('speech')} ${r.speechDb.toFixed(0)} dB · ${t('peak')} ${r.peakDb.toFixed(0)} dB · SNR ${r.snr.toFixed(0)} dB`,
            ),
          );
          if (Math.abs(r.suggestedGainDb) > 2 && !r.advice.includes('silent'))
            checkOut.append(
              h(
                'button#apply-trim',
                {
                  onclick: () => {
                    const v = clamp(Math.round((mic.settings.gainDb + r.suggestedGainDb) * 2) / 2, -12, 36);
                    setGain(v);
                    toast(t('Trim set to {v} dB', { v }), 'ok');
                  },
                },
                t('Apply suggested trim ({v} dB)', { v: `${r.suggestedGainDb > 0 ? '+' : ''}${r.suggestedGainDb.toFixed(0)}` }),
              ),
            );
        } catch (e) {
          say(errorMessage(e));
        } finally {
          checkBtn.disabled = false;
        }
      },
    },
    icon('sliders'),
    t('Mic check'),
  );

  // ---- latency ----
  const latNum = h('span.v#lat-val', `${p().latencyMs} ms`);
  const setLatency = (ms: number) => {
    latency.value = String(ms);
    app.store.silent(
      (pr) => {
        pr.latencyMs = ms;
      },
      ['settings'],
    );
    latNum.textContent = `${ms} ms`;
  };
  const latency = h('input#latency', {
    type: 'range',
    min: '0',
    max: '600',
    step: '1',
    value: String(p().latencyMs),
    oninput: (e) => setLatency(Number(e.target.value)),
    onchange: () => app.store.commit('Latency', () => {}, ['settings'], { merge: true }),
  });
  const calOut = h('div.hint#cal-out');
  const calBtn: HTMLButtonElement = h(
    'button#calibrate',
    {
      onclick: async () => {
        if (!mic.isOpen) await openMic();
        if (!mic.isOpen) return;
        calBtn.disabled = true;
        calOut.textContent = t('Playing test clicks… keep the room quiet. The mic must be able to hear the speakers/headphones.');
        try {
          const r = await calibrateLatency(app.engine, mic);
          if (r.ms == null || !r.ok)
            calOut.textContent = t(
              'Could not hear the clicks reliably. Turn the volume up, put the headphones next to the mic (or use speakers) and try again.',
            );
          else {
            const ms = Math.round(r.ms);
            setLatency(ms);
            app.store.commit('Latency', () => {}, ['settings']);
            calOut.textContent = t('Measured round-trip latency: {ms} ms (applied).', { ms });
          }
        } catch (e) {
          calOut.textContent = errorMessage(e);
        } finally {
          calBtn.disabled = false;
        }
      },
    },
    icon('clock'),
    t('Auto-calibrate'),
  );

  // ---- track fx ----
  const fxBox = h('div.box#fx-box');
  function renderFx() {
    clear(fxBox);
    const tr = app.track;
    if (!tr) return;
    const set = <K extends keyof Track>(k: K, v: Track[K]) => {
      app.store.commit('Voice setting', () => {
        tr[k] = v;
      }, ['tracks']);
      void app.engine.refresh();
    };
    const nudgeV = h('span.v', `${tr.nudgeMs} ms`);
    fxBox.append(
      h('h4', `${t('Voice effect')} — ${tr.name}`),
      h(
        'div.fxgrid',
        ...Object.entries(FX_INFO).map(([k, v]) =>
          h(`button.fxbtn${tr.fx === k ? '.sel' : ''}`, { dataset: { fx: k }, onclick: () => set('fx', k as FxPreset) }, t(v.label)),
        ),
      ),
      h(
        'div.slider',
        t('Effect amount'),
        h('input#fx-amount', {
          type: 'range',
          min: '0',
          max: '1',
          step: '0.01',
          value: String(tr.fxAmount),
          disabled: tr.fx === 'none',
          onchange: (e) => set('fxAmount', Number(e.target.value)),
        }),
        h('span.v', `${Math.round(tr.fxAmount * 100)}%`),
      ),
      h(
        'label.row.small',
        h('input#micfix', { type: 'checkbox', checked: tr.micFix, onchange: (e) => set('micFix', e.target.checked) }),
        t('Mic fix: rumble filter + gentle leveling (great for budget mics)'),
      ),
      h(
        'div.slider',
        t('Micro-nudge'),
        h('input#nudge', {
          type: 'range',
          min: '-250',
          max: '250',
          step: '1',
          value: String(tr.nudgeMs),
          oninput: (e) => {
            tr.nudgeMs = Number(e.target.value);
            nudgeV.textContent = `${e.target.value} ms`;
            app.store.silent(() => {}, ['tracks']);
          },
          onchange: () => {
            app.store.commit('Nudge track', () => {}, ['tracks'], { merge: true });
            void app.engine.refresh();
          },
        }),
        nudgeV,
      ),
      h('div.hint', t('Nudge shifts this whole track earlier (−) or later (+) after recording — fix small sync errors by ear.')),
    );
    const clip = tr.clips.find((c) => c.id === app.sel.clipId);
    if (clip)
      fxBox.append(
        h(
          'div.row',
          h('button#clean-take', { onclick: () => void denoiseClip(clip) }, icon('wave'), t('Denoise this clip (server)')),
          h(
            'div.slider',
            { style: { flex: 1 } },
            t('Clip gain'),
            h('input', {
              type: 'range',
              min: '0',
              max: '3',
              step: '0.01',
              value: String(clip.gain ?? 1),
              onchange: (e) => {
                app.store.commit('Clip gain', () => {
                  clip.gain = Number(e.target.value);
                }, ['tracks']);
                void app.engine.refresh();
              },
            }),
            h('span.v', `${(clip.gain ?? 1).toFixed(2)}×`),
          ),
        ),
      );
  }
  const outRadio = (v: 'headphones' | 'speakers', label: string) =>
    h(
      'label.row.small',
      h('input', {
        type: 'radio',
        name: 'outtype',
        value: v,
        checked: s().output === v,
        onchange: () => {
          app.store.commit(
            'Output type',
            (pr) => {
              pr.settings.output = v;
              if (v === 'speakers') pr.settings.muteOriginalWhileRecording = true;
            },
            ['settings'],
          );
          renderListen();
          renderRec();
        },
      }),
      label,
    );
  const testSound = () => {
    void app.engine.init().then(async () => {
      await app.engine.resume();
      app.engine.scheduleBeeps(app.engine.ctx.currentTime + 1.3, 1, { beep: true }); // one beep, then the higher GO beep
    });
  };
  const listenBox = h('div.box#listen-box');
  function renderListen() {
    clear(listenBox);
    const st = s();
    listenBox.append(
      h('h4', t('Listening')),
      h(
        'div.field',
        h('label', t('Output device (headphones / TV)')),
        h('div.row', outSel, h('button#test-sound', { title: t('Plays two short beeps') }, t('Test sound'))),
      ),
      h('div.lab', t('Are you wearing headphones?')),
      h('div.row', outRadio('headphones', t('Headphones')), outRadio('speakers', t('TV / speakers'))),
      st.output === 'speakers'
        ? h(
            'div.hint.warn',
            t(
              'On speakers the mic hears the video sound. The original audio is muted while recording (you will still see the cues and picture). Use headphones for ghost-guide and music beds.',
            ),
          )
        : h('div.hint', t('Headphones: no bleed into the mic, so you can hear the original or the ghost guide while recording.')),
      h(
        'label.row.small',
        h('input#monitor', { type: 'checkbox', checked: mic.settings.monitor, onchange: (e) => mic.setMonitor(e.target.checked, mic.settings.monitorPan) }),
        t('Hear myself (headphones only!)'),
      ),
      h(
        'label.row.small',
        h('input#aec', {
          type: 'checkbox',
          checked: mic.settings.aec,
          onchange: (e) => {
            mic.settings.aec = e.target.checked;
            if (mic.isOpen) void openMic();
          },
        }),
        t('Echo cancellation (for speakers; slightly degrades the voice)'),
      ),
    );
    listenBox.querySelector<HTMLButtonElement>('#test-sound')?.addEventListener('click', testSound);
  }
  const recBox = h('div.box#rec-box');
  function renderRec() {
    clear(recBox);
    const st = s();
    recBox.append(
      h('h4', t('Recording setup')),
      h(
        'div.slider',
        t('Count-in'),
        h('input#preroll', {
          type: 'range',
          min: '0',
          max: '5',
          step: '1',
          value: String(st.preRoll),
          onchange: (e) => {
            app.store.commit(
              'Pre-roll',
              (pr) => {
                pr.settings.preRoll = Number(e.target.value);
              },
              ['settings'],
            );
            renderRec();
          },
        }),
        h('span.v', st.preRoll ? `${st.preRoll} s` : t('off')),
      ),
      h(
        'label.row.small',
        h('input#beep', {
          type: 'checkbox',
          checked: st.preRollBeep,
          onchange: (e) =>
            app.store.commit(
              'Beep',
              (pr) => {
                pr.settings.preRollBeep = e.target.checked;
              },
              ['settings'],
            ),
        }),
        t('Audible 3-2-1-BEEP'),
      ),
      h(
        'label.row.small',
        h('input#mute-orig-rec', {
          type: 'checkbox',
          checked: st.muteOriginalWhileRecording,
          onchange: (e) =>
            app.store.commit(
              'Mute original',
              (pr) => {
                pr.settings.muteOriginalWhileRecording = e.target.checked;
              },
              ['settings'],
            ),
        }),
        t('Mute original audio while recording'),
      ),
    );
  }

  const micBox = h(
    'div.box',
    h('h4', t('Microphone / audio interface')),
    h(
      'div.field',
      h('label', t('Input device')),
      h('div.row', inSel, h('button.icon#rescan', { title: t('Rescan devices'), onclick: () => void fillDevices() }, icon('refresh'))),
    ),
    hint,
    h('div.field', h('label', t('Interface channel')), chSel),
    h('div.slider', t('Input trim'), gain, gv),
    meter,
    meterTxt,
    info,
    h('div.row', openBtn, checkBtn),
    checkOut,
  );
  const latencyBox = h(
    'div.box',
    h('h4', t('Latency compensation')),
    h('div.slider', t('Round trip'), latency, latNum),
    h('div.row', calBtn),
    calOut,
    h(
      'div.hint',
      t(
        'Recorded clips are placed earlier by this amount so your voice lines up with what you saw and heard. USB interfaces ≈ 15–40 ms, Bluetooth headphones 150–300 ms.',
      ),
    ),
  );
  if (has('devices')) root.append(micBox, listenBox, latencyBox);
  if (has('recording')) root.append(recBox);
  if (has('fx')) root.append(fxBox);
  renderListen();
  renderRec();
  renderFx();
  void fillDevices();
  // the Devices dialog listens right away, so the meter answers as soon as you speak
  if (autoOpen && !mic.isOpen) void openMic();
  offs.push(
    app.on('selection', renderFx),
    app.store.on('change', (k) => {
      if (k.has('tracks') || k.has('all')) renderFx();
    }),
  );
  return {
    destroy: () => {
      for (const f of offs) f();
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
    },
  };
}
