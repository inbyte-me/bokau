// One coherent line-icon set (16px grid, 1.5px strokes). Replaces emoji so every control reads the same on every machine.
const P = {
  play: ['M4.5 3l8 5-8 5z', 'fill'], pause: ['M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z', 'fill'], stop: ['M4 4h8v8H4z', 'fill'], rec: ['M8 3.2a4.8 4.8 0 100 9.6 4.8 4.8 0 000-9.6z', 'fill'],
  start: ['M3.5 3v10M13 3L6 8l7 5z', 'mix'], stepBack: ['M11.5 3L5 8l6.5 5z', 'fill'], stepFwd: ['M4.5 3L11 8l-6.5 5z', 'fill'],
  loop: ['M3 7.5V7a2.5 2.5 0 012.5-2.5H12M10 2.5l2 2-2 2M13 8.5V9a2.5 2.5 0 01-2.5 2.5H4M6 9.5l-2 2 2 2'],
  split: ['M8 1.5v13M4 5.5h3M9 10.5h3'], trash: ['M2.5 4.5h11M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9'], plus: ['M8 3v10M3 8h10'], minus: ['M3 8h10'],
  fit: ['M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10'],
  mic: ['M6 2.5h4a1 1 0 011 1V8a3 3 0 01-6 0V3.5a1 1 0 011-1zM3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5'],
  headphones: ['M2.5 10V8a5.5 5.5 0 0111 0v2M2.5 10h2.2v3.5H2.5zM11.3 10h2.2v3.5h-2.2z'],
  tv: ['M2 3.5h12v8H2zM5.5 14h5'], undo: ['M5.5 6H10a3 3 0 010 6H6M5.5 6L8 3.5M5.5 6L8 8.5'], redo: ['M10.5 6H6a3 3 0 000 6h4M10.5 6L8 3.5M10.5 6L8 8.5'],
  export: ['M8 10.5V2.5M5 5.5l3-3 3 3M3 10v3.5h10V10'], download: ['M8 2.5V11M5 8l3 3 3-3M3 13.5h10'],
  keys: ['M1.5 4h13v8h-13zM4 6.5h1M7.5 6.5h1M11 6.5h1M4 9.5h8'], refresh: ['M13 8a5 5 0 11-1.6-3.7M13 2.5v3h-3'], flag: ['M4 14.5V2M4 2.5h8l-2 2.75 2 2.75H4'],
  close: ['M4 4l8 8M12 4l-8 8'], check: ['M3 8.5l3.5 3.5L13 4.5'], sliders: ['M2.5 5h11M2.5 11h11M6 3v4M10 9v4'], file: ['M4 1.5h5l3 3v10H4zM9 1.5v3h3'],
  wave: ['M1.5 8h2l1.5-4 2 8 2-10 2 6h3.5'], clock: ['M8 2a6 6 0 100 12A6 6 0 008 2zM8 4.5V8l2.5 1.5'], back: ['M10 3L5 8l5 5'], home: ['M2.5 8L8 3l5.5 5M4 7v6.5h3V10h2v3.5h3V7'],
  scissors: ['M8 1.5v13M4 5.5h3M9 10.5h3'], up: ['M8 13V3M4 7l4-4 4 4'], gear: ['M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4'],
};
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 16) {
  const [d, mode] = P[name] || P.close;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('ic');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d);
  if (mode === 'fill') { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
  else { path.setAttribute('fill', mode === 'mix' ? 'currentColor' : 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); }
  svg.append(path); return svg;
}
/** icon + text label as one inline node */
export function lbl(name, text, size = 15) { const s = document.createElement('span'); s.className = 'lbl'; s.append(icon(name, size), document.createTextNode(text)); return s; }
