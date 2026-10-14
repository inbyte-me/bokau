<!-- The whole recording as a waveform: click to move, drag the amber handles to trim; chapter flags on top. -->
<script lang="ts">
  import { drawWave } from '@doblaje/audio';
  import { type Chapter, clamp, type TimeRange } from '@doblaje/core';
  import { app } from '../../app.svelte.ts';
  import { transport } from '../../transport.svelte.ts';

  interface Props {
    duration: number;
    trim: TimeRange | null;
    chapters: Chapter[];
    ontrim: (patch: { start?: number; end?: number }) => void;
  }
  let { duration, trim, chapters, ontrim }: Props = $props();
  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  let drag: 'start' | 'end' | 'seek' | null = null;

  function draw(cv: HTMLCanvasElement, W: number, now: number) {
    const dpr = window.devicePixelRatio || 1;
    const H = cv.clientHeight;
    if (!W) return;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const c = cv.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b0b0a';
    c.fillRect(0, 0, W, H);
    const x = (tt: number) => (tt / duration) * W;
    drawWave(c, app.engine.assets?.peaks.get('orig'), { x0: 0, x1: W, y: 14, h: H - 24, t0: 0, t1: duration, color: '#7f8a96' });
    if (trim) {
      c.fillStyle = 'rgba(0,0,0,.6)';
      c.fillRect(0, 0, x(trim.start), H);
      c.fillRect(x(trim.end), 0, W - x(trim.end), H);
      c.fillStyle = '#e3b04b';
      c.fillRect(x(trim.start) - 1, 0, 3, H);
      c.fillRect(x(trim.end) - 2, 0, 3, H);
    }
    c.font = 'bold 10px ui-monospace, Menlo, monospace';
    for (const [i, ch] of chapters.entries()) {
      const cx = x(ch.t);
      c.fillStyle = 'rgba(227,176,75,.6)';
      c.fillRect(cx, 0, 1, H);
      c.fillStyle = '#e3b04b';
      c.fillRect(cx, 0, 14, 12);
      c.fillStyle = '#1a1405';
      c.fillText(String(i + 1), cx + 3, 9);
    }
    c.fillStyle = '#e8473a';
    c.fillRect(x(now) - 0.75, 0, 1.5, H);
  }
  // redraw when the size, the playhead, the trim or the chapters change (drawing only; no state is written)
  $effect(() => {
    if (canvas) draw(canvas, width, transport.time);
  });

  const at = (e: PointerEvent, cv: HTMLCanvasElement) => clamp(((e.clientX - cv.getBoundingClientRect().left) / cv.clientWidth) * duration, 0, duration);
  function down(e: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    const cv = e.currentTarget;
    cv.setPointerCapture(e.pointerId);
    const tt = at(e, cv);
    const near = (v: number) => Math.abs(((tt - v) / duration) * cv.clientWidth) < 8;
    if (trim && near(trim.start)) drag = 'start';
    else if (trim && near(trim.end)) drag = 'end';
    else {
      drag = 'seek';
      app.engine.seek(tt);
    }
  }
  function move(e: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    if (!drag) return;
    const tt = at(e, e.currentTarget);
    if (drag === 'seek') app.engine.seek(tt);
    else ontrim({ [drag]: tt });
  }
</script>

<canvas id="wave" bind:this={canvas} bind:clientWidth={width} onpointerdown={down} onpointermove={move} onpointerup={() => (drag = null)}></canvas>

<style>
  canvas {
    width: 100%;
    height: 110px;
    display: block;
    background: #0b0b0a;
    border: 1px solid var(--line);
    cursor: pointer;
  }
</style>
