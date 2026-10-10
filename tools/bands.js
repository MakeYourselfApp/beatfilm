// node bands.js <audio>: per-band onset peaks (hat >7 kHz, mid 300-2k, low <150 Hz) with precise times, for cutting on every hit.
const { spawnSync } = require('child_process');
const FF = process.env.FFMPEG || 'ffmpeg';
const file = process.argv[2], SR = 44100, HOP = 128;
const raw = spawnSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), fps = SR / HOP, fr = Math.floor(x.length / HOP);
function biquad(type, f0, Q) {
  const w = 2 * Math.PI * f0 / SR, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
  let b = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [al, 0, -al];
  const a = [1 + al, -2 * c, 1 - al]; b = b.map((v) => v / a[0]); const a1 = a[1] / a[0], a2 = a[2] / a[0];
  return (inp) => { const o = new Float32Array(inp.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const y = b[0] * inp[i] + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = y; o[i] = y; } return o; };
}
function env(sig) { const e = new Float32Array(fr); for (let i = 0; i < fr; i++) { let s = 0; for (let k = 0; k < HOP; k++) s += sig[i * HOP + k] ** 2; e[i] = 10 * Math.log10(s / HOP + 1e-12); } return e; }
function peaks(e, thr, gap) {
  const d = e.map((v, i) => (i > 2 ? Math.max(0, v - Math.min(e[i - 1], e[i - 2], e[i - 3])) : 0)); const out = [];
  for (let i = 3; i < fr - 3; i++) if (d[i] > thr && d[i] >= Math.max(...d.slice(Math.max(0, i - gap), i + gap + 1))) out.push(`${(i / fps).toFixed(3)}(${d[i].toFixed(0)}dB,${e[i].toFixed(0)})`);
  return out;
}
const hp = biquad('hp', 7000, 0.7), lp = biquad('lp', 150, 0.7), bp = biquad('bp', 800, 0.6);
const hat = env(hp(hp(x))), low = env(lp(lp(x))), mid = env(bp(x));
const g = Math.round(0.06 * fps);
console.log('HAT ', peaks(hat, +(process.argv[3] || 8), g).join(' '));
console.log('MID ', peaks(mid, +(process.argv[4] || 5), g).join(' '));
console.log('LOW ', peaks(low, +(process.argv[5] || 4), g).join(' '));
