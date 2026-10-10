// node onsets.js <audio> <bpm...>: chronological strong onsets + how well each bpm grid explains them
const { spawnSync } = require('child_process');
const FF = process.env.FFMPEG || 'ffmpeg';
const [file, ...bpms] = process.argv.slice(2), SR = 22050, HOP = 256;
const raw = spawnSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), fr = Math.floor(x.length / HOP), fps = SR / HOP;
const e = new Float32Array(fr); for (let i = 0; i < fr; i++) { let s = 0; for (let k = 0; k < HOP; k++) s += x[i * HOP + k] ** 2; e[i] = Math.log1p(Math.sqrt(s / HOP) * 100); }
const on = e.map((v, i) => (i ? Math.max(0, v - e[i - 1]) : 0)); const mx = Math.max(...on);
const pk = []; for (let i = 2; i < fr - 2; i++) if (on[i] > 0.22 * mx && on[i] === Math.max(...on.slice(i - 3, i + 4))) pk.push([+(i / fps).toFixed(3), +(on[i] / mx).toFixed(2)]);
console.log(pk.map((p) => p.join(':')).join('  '));
for (const bpm of bpms) { const P = 60 / bpm; let best = [1e9, 0]; for (let ph = 0; ph < P; ph += 0.005) { let err = 0; for (const [t, w] of pk) { const d = ((t - ph) / P) % 0.5; err += w * Math.min(d, 0.5 - d) ** 2; } if (err < best[0]) best = [err, ph]; } console.log(bpm, 'err', best[0].toFixed(4), 'phase', best[1].toFixed(3)); }
