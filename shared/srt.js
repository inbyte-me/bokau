// SRT / VTT parsing and serialization, shared by server and browser.

export function parseTime(s) {
  const m = /^\s*(?:(\d+):)?(\d+):(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(s);
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0);
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function fmtTime(sec, sep = ',') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

const stripTags = (t) => t.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\{\\[^}]*\}/g, '');

/** Parse SRT or WebVTT text into [{start,end,text,character}] */
export function parseSubs(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l, i) => !(i === 0 && /^(WEBVTT|NOTE|STYLE)/.test(l)));
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, rest] = lines[ti].split('-->');
    const start = parseTime(a.trim());
    const end = parseTime(rest.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    let body = stripTags(lines.slice(ti + 1).join('\n')).trim();
    let character = '';
    const sp = /^\[?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ .'-]{0,24})\]?:\s+(.*)$/s.exec(body);
    if (sp && sp[1] === sp[1].toUpperCase()) { character = sp[1].trim(); body = sp[2]; }
    cues.push({ start, end: Math.max(end, start + 0.05), text: body.replace(/\n+/g, ' ').trim(), character });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function toSrt(cues, { withCharacter = true } = {}) {
  return cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${withCharacter && c.character ? `${c.character.toUpperCase()}: ` : ''}${c.text}\n`).join('\n');
}
export function toVtt(cues) {
  return 'WEBVTT\n\n' + cues.map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.character ? `<v ${c.character}>` : ''}${c.text}\n`).join('\n');
}
export function toJson(cues, meta = {}) {
  return JSON.stringify({ ...meta, cues: cues.map((c, i) => ({ index: i + 1, start: round3(c.start), end: round3(c.end), character: c.character || '', text: c.text })) }, null, 2);
}
const round3 = (n) => Math.round(n * 1000) / 1000;
