// Beat analysis: node beats.js <audio> -> tempo, beat grid phase, strongest onsets, low-end hits.
// Decodes with ffmpeg to mono 22.05 kHz, builds a spectral-flux onset curve, autocorrelates for tempo.
const { spawnSync } = require('child_process');
const FF = process.env.FFMPEG || 'ffmpeg';
const file = process.argv[2];
const SR = 22050;
const raw = spawnSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const HOP = 256, N = 1024, frames = Math.floor((x.length - N) / HOP);
const fps = SR / HOP;
// simple DFT-free flux: band energies via one-pole filters on the signal
function bandEnv(lo, hi) {
  // biquad bandpass RBJ
  const f0 = Math.sqrt(lo * hi), Q = f0 / (hi - lo), w = 2 * Math.PI * f0 / SR, al = Math.sin(w) / (2 * Q);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; const e = new Float32Array(frames);
  let acc = 0, k = 0, fi = 0;
  for (let i = 0; i < x.length && fi < frames; i++) {
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    acc += y * y; if (++k === HOP) { e[fi++] = Math.sqrt(acc / HOP); acc = 0; k = 0; }
  }
  return e;
}
const bands = [[30, 120], [120, 400], [400, 2000], [2000, 8000]].map(([a, b]) => bandEnv(a, b));
const onset = new Float32Array(frames), low = new Float32Array(frames);
for (let i = 1; i < frames; i++) {
  let s = 0; for (const e of bands) s += Math.max(0, Math.log1p(e[i] * 100) - Math.log1p(e[i - 1] * 100));
  onset[i] = s; low[i] = Math.max(0, Math.log1p(bands[0][i] * 100) - Math.log1p(bands[0][i - 1] * 100));
}
// tempo via autocorrelation, 60..180 BPM
let best = 0, bestLag = 0; const ac = [];
for (let bpm = 60; bpm <= 180; bpm += 0.5) {
  const lag = (60 / bpm) * fps; let s = 0;
  for (let i = 0; i < frames - lag * 2; i++) { const j = i + lag, j0 = Math.floor(j), f = j - j0; s += onset[i] * (onset[j0] * (1 - f) + (onset[j0 + 1] || 0) * f); }
  s /= frames - lag; ac.push([bpm, s]); if (s > best) { best = s; bestLag = bpm; }
}
const top = ac.slice().sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b, s]) => `${b}(${(s / best).toFixed(2)})`);
// phase: offset that maximizes onset sum on the grid
const bpm = +(process.argv[3] || bestLag), period = (60 / bpm) * fps;
let bp = 0, bs = -1;
for (let ph = 0; ph < period; ph += 0.25) { let s = 0; for (let t = ph; t < frames; t += period) s += onset[Math.round(t)] || 0; if (s > bs) { bs = s; bp = ph; } }
// strongest onsets (peak picking)
const peaks = [];
for (let i = 2; i < frames - 2; i++) if (onset[i] > onset[i - 1] && onset[i] >= onset[i + 1] && onset[i] > 0.4) peaks.push([i / fps, onset[i], low[i]]);
peaks.sort((a, b) => b[1] - a[1]);
// loudness per half second
const rms = []; for (let t = 0; t < x.length / SR; t += 0.5) { let s = 0, n = 0; for (let i = Math.floor(t * SR); i < Math.min(x.length, (t + 0.5) * SR); i++) { s += x[i] * x[i]; n++; } rms.push((20 * Math.log10(Math.sqrt(s / n) + 1e-9)).toFixed(0)); }
console.log(JSON.stringify({
  dur: +(x.length / SR).toFixed(3), tempoTop: top, bpm, firstBeat: +(bp / fps).toFixed(3),
  strongest: peaks.slice(0, 16).map(([t, s, l]) => `${t.toFixed(2)}s ${s.toFixed(1)}${l > 0.8 ? ' LOW' : ''}`),
  lowHits: peaks.filter((p) => p[2] > 0.8).map((p) => +p[0].toFixed(2)).sort((a, b) => a - b),
  rmsPerHalfSec: rms.join(' '),
}, null, 1));
