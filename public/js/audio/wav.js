/** Encode planar Float32 channels into a WAV Blob. bits: 16 (PCM) or 32 (float). */
export function encodeWav(channels, sampleRate, bits = 16) {
  const nCh = channels.length, n = channels[0].length, bytes = bits / 8;
  const buf = new ArrayBuffer(44 + n * nCh * bytes); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nCh * bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bytes, true); v.setUint16(32, nCh * bytes, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, n * nCh * bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = channels[c][i];
      if (bits === 32) { v.setFloat32(o, s, true); o += 4; }
      else { const x = Math.max(-1, Math.min(1, s)); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
export const audioBufferToWav = (buf, bits = 16) => encodeWav(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)), buf.sampleRate, bits);
