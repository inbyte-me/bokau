// What right-click offers in the studio, element by element (policy and full table: docs/design.md#context-menus).
// Only actions that make sense on that exact thing; anything not listed here shows no menu.
import { applyTake } from '@doblaje/audio';
import { type Cue, carveClips, MIN_PASSAGE, newCue, newId, type TimeRange } from '@doblaje/core';
import { type MenuItem, registerMenu, t } from '@doblaje/ui';
import { app } from '../app.ts';
import {
  assignPassage,
  clearRange,
  deleteClip,
  deleteCue,
  denoiseClip,
  playCue,
  playFrom,
  setLoop,
  splitClipAt,
  splitCueAt,
  splitPassageAt,
} from './actions.ts';
import type { Timeline } from './timeline.ts';

export interface StudioMenuCtx {
  tl: Timeline;
  record(target: { start: number; end: number | null; loop?: boolean }): void;
  setMark(n: number, at: number): void;
  jumpMark(n: number): void;
  deleteMark(n: number): void;
  toggleBanner(): void;
  toggleTv(): void;
}

/** Register every studio context menu; returns the function that removes them. */
export function registerStudioMenus(ctx: StudioMenuCtx): () => void {
  const { engine, store } = app;
  const nextFreeMark = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !store.project.markers.some((m) => m.n === n)) ?? null;

  const rangeItems = (): MenuItem[] => {
    const r = app.sel.region;
    if (!r) return [];
    return [
      'separator',
      { label: t('Loop this range'), icon: 'loop', shortcut: 'L', run: () => setLoop(r) },
      { label: t('Re-record this range (punch in)'), icon: 'rec', run: () => ctx.record({ start: r.start, end: r.end }) },
      { label: t('Clear range'), icon: 'close', run: clearRange },
    ];
  };
  const cueItems = (cue: Cue, at?: number): MenuItem[] => [
    ...(at != null && at - cue.start > 0.1 && cue.end - at > 0.1
      ? [{ label: t('Split cue here'), icon: 'split', run: () => void splitCueAt(cue.id, at) } as MenuItem, 'separator' as const]
      : []),
    { label: t('Play this cue'), icon: 'play', run: () => void playCue(cue) },
    { label: t('Record this cue (punch)'), icon: 'rec', run: () => app.emit('record-cue', cue) },
    { label: t('Loop-record this cue until you nail it'), icon: 'loop', run: () => app.emit('record-cue', cue, true) },
    {
      label: t('Edit text'),
      icon: 'file',
      run: () => {
        app.select({ cueId: cue.id });
        app.emit('show-tab', 'cues');
        app.emit('focus-cue', cue.id);
      },
    },
    { label: t('Delete cue'), icon: 'trash', danger: true, run: () => deleteCue(cue.id) },
  ];

  const offs = [
    // ---- the timeline canvas: depends on the lane and on what is under the pointer
    registerMenu('canvas.tl', (_el, at) => {
      const pk = ctx.tl.pick(at.x, at.y);
      if (!pk) return null;
      const here = pk.t;
      switch (pk.lane) {
        case 'ruler':
        case 'thumbs': {
          if (pk.marker) {
            const n = pk.marker.n;
            return [
              { label: t('Jump to mark {n}', { n }), icon: 'flag', shortcut: `⌥${n}`, run: () => ctx.jumpMark(n) },
              { label: t('Delete mark {n}', { n }), icon: 'trash', danger: true, run: () => ctx.deleteMark(n) },
            ];
          }
          const n = nextFreeMark();
          return [
            { label: t('Play from here'), icon: 'play', run: () => playFrom(here) },
            {
              label: n ? t('Set mark {n} here', { n }) : t('All nine marks are set'),
              icon: 'flag',
              disabled: !n,
              run: () => {
                if (n) ctx.setMark(n, here);
              },
            },
            ...rangeItems(),
          ];
        }
        case 'orig':
          return [{ label: t('Play from here'), icon: 'play', run: () => playFrom(here) }, ...rangeItems()];
        case 'speakers': {
          if (pk.segIdx == null) return null;
          const idx = pk.segIdx;
          const seg = store.project.speakers.segments[idx];
          const who = store.project.speakers.list.find((s) => s.id === seg.speaker);
          const canSplit = here - seg.start >= MIN_PASSAGE && seg.end - here >= MIN_PASSAGE;
          return [
            { label: t('Split passage here'), icon: 'split', shortcut: 'S', disabled: !canSplit, run: () => void splitPassageAt(idx, here) },
            'separator',
            { label: t('Listen to this passage'), icon: 'play', run: () => void engine.playRange(seg.start, seg.end) },
            who
              ? {
                  label: who.muted ? t('Turn {name} back on', { name: who.name }) : t('Silence {name} (to dub it)', { name: who.name }),
                  icon: 'mic',
                  run: () => {
                    store.commit(
                      'Voice setting',
                      (p) => {
                        const s = p.speakers.list.find((x) => x.id === who.id);
                        if (s) s.muted = !s.muted;
                      },
                      ['speakers'],
                    );
                    void engine.refresh();
                  },
                }
              : 'separator',
            'separator',
            ...store.project.speakers.list
              .filter((s) => s.id !== seg.speaker)
              .map(
                (s): MenuItem => ({
                  label: t('This passage is {name}', { name: s.name }),
                  run: () => assignPassage(idx, s.id),
                }),
              ),
          ];
        }
        case 'cues': {
          if (pk.hit.cue) return cueItems(pk.hit.cue, here);
          return [
            {
              label: t('Add a cue here'),
              icon: 'plus',
              run: () => {
                const cue = newCue({ start: here, end: Math.min(engine.duration, here + 1.8), text: t('New line') });
                store.commit(
                  'Add cue',
                  (p) => {
                    p.cues.push(cue);
                    p.cues.sort((a, b) => a.start - b.start);
                  },
                  ['cues'],
                );
                app.select({ cueId: cue.id });
                app.emit('show-tab', 'cues');
                app.emit('focus-cue', cue.id);
              },
            },
            ...rangeItems(),
          ];
        }
        case 'flaps': {
          const flap = pk.hit.flap;
          if (flap) {
            return [
              {
                label: t('Delete this mouth-open marker'),
                icon: 'trash',
                danger: true,
                run: () =>
                  store.commit(
                    'Remove lip flap',
                    (p) => {
                      p.lipFlaps = p.lipFlaps.filter((f) => !(f.start === flap.start && f.end === flap.end));
                    },
                    ['flaps'],
                  ),
              },
            ];
          }
          return [
            {
              label: t('Add a mouth-open marker here'),
              icon: 'plus',
              run: () =>
                store.commit(
                  'Add lip flap',
                  (p) => {
                    p.lipFlaps.push({ start: here, end: Math.min(engine.duration, here + 0.25) });
                    p.lipFlaps.sort((a, b) => a.start - b.start);
                  },
                  ['flaps'],
                ),
            },
          ];
        }
        case 'track': {
          const tr = pk.hit.tr;
          if (!tr) return null;
          const clip = pk.hit.clip;
          if (clip) {
            const now = engine.time;
            const cs = clip.start;
            const inside = now > cs + 0.02 && now < cs + clip.duration - 0.02;
            return [
              { label: t('Play from the start of this clip'), icon: 'play', run: () => playFrom(cs) },
              {
                label: t('Split clip here'),
                icon: 'split',
                disabled: !(here > cs + 0.02 && here < cs + clip.duration - 0.02),
                run: () => void splitClipAt(tr.id, clip.id, here),
              },
              {
                label: t('Split at the playhead'),
                icon: 'split',
                shortcut: 'S',
                disabled: !inside,
                run: () => {
                  app.select({ trackId: tr.id, clipId: clip.id });
                  ctx.tl.splitAtPlayhead();
                },
              },
              { label: t('Denoise this clip (server)'), icon: 'wave', run: () => void denoiseClip(clip) },
              {
                label: t('Reset clip gain'),
                disabled: (clip.gain ?? 1) === 1,
                run: () => {
                  store.commit('Clip gain', () => {
                    clip.gain = 1;
                  }, ['tracks']);
                  void engine.refresh();
                },
              },
              ...rangeItems(),
              { label: t('Delete clip'), icon: 'trash', shortcut: 'Del', danger: true, run: () => deleteClip(clip.id) },
            ];
          }
          return [
            {
              label: t('Record on “{track}” from here', { track: tr.name }),
              icon: 'rec',
              run: () => {
                app.select({ trackId: tr.id });
                ctx.record({ start: here, end: null });
              },
            },
            { label: t('Play from here'), icon: 'play', run: () => playFrom(here) },
            ...rangeItems(),
          ];
        }
      }
      return null;
    }),

    // ---- marks in the timeline toolbar
    registerMenu('.chip.mark', (el) => {
      const n = Number((el as HTMLElement).dataset.n);
      return [
        { label: t('Jump to mark {n}', { n }), icon: 'flag', shortcut: `⌥${n}`, run: () => ctx.jumpMark(n) },
        { label: t('Move mark {n} to the playhead', { n }), run: () => ctx.setMark(n, engine.time) },
        { label: t('Delete mark {n}', { n }), icon: 'trash', danger: true, run: () => ctx.deleteMark(n) },
      ];
    }),

    // ---- track headers
    registerMenu('.tl-head[data-track]', (el) => {
      const tr = store.project.tracks.find((x) => x.id === (el as HTMLElement).dataset.track);
      if (!tr) return null;
      const toggle = (key: 'mute' | 'solo') => {
        store.commit('Mute/Solo', () => {
          tr[key] = !tr[key];
        }, ['levels', 'tracks']);
        void engine.refresh();
      };
      return [
        {
          label: t('Record on this track'),
          icon: 'rec',
          run: () => {
            app.select({ trackId: tr.id });
            ctx.record({ start: engine.time, end: null });
          },
        },
        { label: t('Rename'), run: () => el.querySelector<HTMLInputElement>('input.nm')?.select() },
        { label: tr.mute ? t('Unmute') : t('Mute'), run: () => toggle('mute') },
        { label: tr.solo ? t('Unsolo') : t('Solo'), run: () => toggle('solo') },
        {
          label: t('Remove track'),
          icon: 'trash',
          danger: true,
          disabled: store.project.tracks.length < 2,
          run: () => {
            if (!tr.clips.length || confirm(t('Remove this track and its clips?'))) {
              store.commit(
                'Remove track',
                (p) => {
                  p.tracks = p.tracks.filter((x) => x.id !== tr.id);
                },
                ['tracks'],
              );
            }
          },
        },
      ];
    }),

    // ---- cue rows in the Cues panel
    registerMenu('.cue-list .cue[data-id]', (el) => {
      const cue = store.project.cues.find((c) => c.id === (el as HTMLElement).dataset.id);
      if (!cue) return null;
      return [{ label: t('Go to cue'), icon: 'start', run: () => engine.seek(cue.start) }, ...cueItems(cue)];
    }),

    // ---- takes in the Takes panel
    registerMenu('.take[data-take]', (el) => {
      const tr = app.track;
      const take = tr.takes.find((k) => k.id === (el as HTMLElement).dataset.take);
      if (!take) return null;
      return [
        { label: t('Audition'), icon: 'play', run: () => void engine.playRange(Math.max(0, take.start - 0.3), take.start + take.duration + 0.2) },
        {
          label: t('Use this take'),
          icon: 'check',
          run: () => {
            applyTake(store, tr.id, take.id);
            void engine.refresh();
          },
        },
        {
          label: t('Use only the part inside the range'),
          disabled: !app.sel.region,
          run: () => {
            const r = app.sel.region as TimeRange;
            const s = Math.max(r.start, take.start);
            const e = Math.min(r.end, take.start + take.duration);
            if (e - s < 0.05) return;
            store.commit(
              'Use take part',
              (p) => {
                const t2 = p.tracks.find((x) => x.id === tr.id);
                if (!t2) return;
                t2.clips = [
                  ...carveClips(t2.clips, s, e),
                  { id: newId('c'), file: take.file, takeId: take.id, start: s, offset: s - take.start, duration: e - s, gain: 1 },
                ].sort((a, b) => a.start - b.start);
              },
              ['tracks'],
            );
            void engine.refresh();
          },
        },
        {
          label: t('Remove from list'),
          icon: 'close',
          danger: true,
          run: () =>
            store.commit('Remove take', () => {
              tr.takes = tr.takes.filter((x) => x.id !== take.id);
            }, ['tracks']),
        },
      ];
    }),

    // ---- the picture
    registerMenu('.studio .stage', () => [
      { label: engine.playing ? t('Pause') : t('Play'), icon: engine.playing ? 'pause' : 'play', shortcut: 'Space', run: () => engine.toggle() },
      { label: t('Show or hide subtitles on the video'), run: ctx.toggleBanner },
      { label: t('TV mode (big UI, fullscreen)'), icon: 'tv', shortcut: 'F', run: ctx.toggleTv },
    ]),

    // ---- identified voices in the Mix panel
    registerMenu('.voice-row[data-speaker], .tl-head[data-speaker]', (el) => {
      const sp = store.project.speakers.list.find((s) => s.id === (el as HTMLElement).dataset.speaker);
      if (!sp) return null;
      const first = store.project.speakers.segments.find((g) => g.speaker === sp.id);
      const set = (patch: { muted?: boolean; solo?: boolean }) => {
        store.commit('Voice setting', () => {
          Object.assign(sp, patch);
        }, ['speakers']);
        void engine.refresh();
      };
      return [
        {
          label: t('Listen to this character'),
          icon: 'play',
          disabled: !first,
          run: () => {
            if (first) void engine.playRange(first.start, Math.min(first.end, first.start + 6));
          },
        },
        {
          label: sp.muted ? t('Turn {name} back on', { name: sp.name }) : t('Silence {name} (to dub it)', { name: sp.name }),
          icon: 'mic',
          run: () => set({ muted: !sp.muted }),
        },
        { label: sp.solo ? t('Hear everyone') : t('Hear only {name}', { name: sp.name }), run: () => set({ solo: !sp.solo }) },
      ];
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
