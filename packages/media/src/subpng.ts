import fs from 'node:fs';
import path from 'node:path';
import type { SubCue } from '@doblaje/core';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

// The ffmpeg build here has no libass/drawtext, so burned-in subtitles and watermarks are rasterized
// to transparent PNGs with a canvas and composited with the `overlay` filter.

function wrap(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export function renderSubtitlePng(text: string, width: number, height: number, { fontPx, character }: { fontPx?: number; character?: string } = {}): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const size = fontPx || Math.round(height * 0.3);
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const lines = wrap(ctx, (character ? `${character}: ` : '') + text, width * 0.9).slice(-3);
  const lh = size * 1.2;
  let y = height - 10 - (lines.length - 1) * lh;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 7);
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.fillStyle = '#fff';
  for (const l of lines) {
    ctx.strokeText(l, width / 2, y);
    ctx.fillText(l, width / 2, y);
    y += lh;
  }
  return canvas.toBuffer('image/png');
}

export const blankPng = (width: number, height: number): Buffer => createCanvas(width, height).toBuffer('image/png');

export function renderWatermarkPng(text: string, fontPx: number, opacity = 0.6): { png: Buffer; w: number; h: number } {
  const c0 = createCanvas(10, 10).getContext('2d');
  c0.font = `700 ${fontPx}px sans-serif`;
  const w = Math.ceil(c0.measureText(text).width) + 16;
  const h = Math.ceil(fontPx * 1.5);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.font = `700 ${fontPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = opacity;
  ctx.lineWidth = Math.max(2, fontPx / 8);
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.fillStyle = '#fff';
  ctx.strokeText(text, 8, h / 2);
  ctx.fillText(text, 8, h / 2);
  return { png: canvas.toBuffer('image/png'), w, h };
}

/** Builds a concat-demuxer list that yields a full-timeline transparent video of subtitle strips. */
export function buildSubtitleTrack(
  dir: string,
  cues: SubCue[],
  { width, height, duration, fontPx }: { width: number; height: number; duration: number; fontPx?: number },
) {
  const stripH = Math.round(height * 0.2);
  fs.mkdirSync(dir, { recursive: true });
  const blank = path.join(dir, 'blank.png');
  fs.writeFileSync(blank, blankPng(width, stripH));
  const lines: string[] = [];
  let t = 0;
  const sorted = [...cues].filter((c) => c.text?.trim()).sort((a, b) => a.start - b.start);
  const push = (file: string, d: number) => {
    if (d > 0.0005) lines.push(`file '${file}'`, `duration ${d.toFixed(4)}`);
  };
  sorted.forEach((c, i) => {
    const s = Math.max(c.start, t);
    const e = Math.min(c.end, duration);
    if (e <= s) return;
    push(blank, s - t);
    const f = path.join(dir, `s${i}.png`);
    fs.writeFileSync(f, renderSubtitlePng(c.text, width, stripH, { fontPx: fontPx || Math.round(stripH * 0.32), character: c.character }));
    push(f, e - s);
    t = e;
  });
  push(blank, Math.max(0.04, duration - t));
  lines.push(`file '${blank}'`); // concat quirk: the last file needs repeating
  const listFile = path.join(dir, 'subs.txt');
  fs.writeFileSync(listFile, lines.join('\n'));
  return { listFile, w: width, h: stripH };
}
