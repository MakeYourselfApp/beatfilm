// Sound design for a film: synthesises every cue in <film>/cues.js and writes <film>/audio.wav.
// node tools/sound.js <film-folder>
const fs = require('fs');
const path = require('path');
const FILM_DIR = path.resolve(process.argv[2]);
const { BPM, BEATS, CUES } = require(path.join(FILM_DIR, 'cues.js'));
const B = 60 / BPM;
const SR = 44100;
const beatS = (b) => Math.round(b * B * SR);
const TOTAL = beatS(BEATS) + SR;
function writeWav(file, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}

// ------------------------------------------------------------ dsp
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rand() * 2 - 1;
// Topology-preserving SVF; returns {lp, bp, hp}
function svf() {
  let ic1 = 0, ic2 = 0;
  return (x, fc, q = 0.707) => {
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  };
}
const SFX_L = new Float32Array(TOTAL), SFX_R = new Float32Array(TOTAL);
const SEND_L = new Float32Array(TOTAL), SEND_R = new Float32Array(TOTAL);
// write a mono generator into the sfx bus with pan (-1..1) and reverb send
function put(start, len, gen, { pan = 0, send = 0.2, gain = 1 } = {}) {
  for (let i = 0; i < len; i++) {
    const j = start + i; if (j < 0 || j >= TOTAL) continue;
    const t = i / SR, v = gen(t, i) * gain;
    const p = typeof pan === 'function' ? pan(t) : pan;
    const gl = Math.cos((p + 1) * Math.PI / 4), gr = Math.sin((p + 1) * Math.PI / 4);
    SFX_L[j] += v * gl; SFX_R[j] += v * gr; SEND_L[j] += v * gl * send; SEND_R[j] += v * gr * send;
  }
}
const sat = (x, d = 1.5) => Math.tanh(x * d) / Math.tanh(d);

// ------------------------------------------------------------ instruments
const I = {
  impact(c) {
    const a = c.amp;
    let ph = 0;
    put(beatS(c.b), SR * 1.6, (t) => { // sub body with pitch drop
      const f = 42 + 95 * Math.exp(-t * 22); ph += 2 * Math.PI * f / SR;
      return sat(Math.sin(ph) * Math.exp(-t * 2.6) * Math.min(1, t * 900), 2.2) * 0.9;
    }, { gain: a, send: 0.08 });
    const f1 = svf();
    put(beatS(c.b), SR * 0.5, (t) => f1(noise(), 180 + 2200 * Math.exp(-t * 30), 0.8).lp * Math.exp(-t * 16) * 0.9, { gain: a, send: 0.35 });
    const f2 = svf();
    put(beatS(c.b), SR * 0.25, (t) => f2(noise(), 3500).hp * Math.exp(-t * 45) * 0.45, { gain: a, send: 0.5, pan: 0 });
    // stereo crack tails
    const f3 = svf(), f4 = svf();
    put(beatS(c.b) + 220, SR * 0.9, (t) => f3(noise(), 1400, 0.6).bp * Math.exp(-t * 6) * 0.22, { gain: a, pan: -0.7, send: 0.6 });
    put(beatS(c.b) + 470, SR * 0.9, (t) => f4(noise(), 1700, 0.6).bp * Math.exp(-t * 6) * 0.22, { gain: a, pan: 0.7, send: 0.6 });
  },
  sub(c) {
    let ph = 0;
    put(beatS(c.b), SR * 2.2, (t) => { const f = 30 + 55 * Math.exp(-t * 2.2); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * Math.exp(-t * 1.6) * Math.min(1, t * 200) * 0.75; }, { gain: c.amp, send: 0 });
  },
  hit(c) {
    let ph = 0; const f = svf();
    put(beatS(c.b), SR * 0.5, (t) => { const fr = 55 + 140 * Math.exp(-t * 35); ph += 2 * Math.PI * fr / SR; return sat(Math.sin(ph) * Math.exp(-t * 9), 1.8) * 0.8 + f(noise(), 2500, 0.7).bp * Math.exp(-t * 60) * 0.5; }, { gain: c.amp, send: 0.18 });
  },
  whoosh(c) {
    const dur = c.dur * B * 1.0 + 0.25, len = Math.round(dur * SR), peak = 0.72;
    const f = svf(), g = svf();
    put(beatS(c.b) - Math.round(dur * peak * SR), len, (t) => {
      const u = t / dur, env = u < peak ? (u / peak) ** 2.2 : Math.exp(-(u - peak) / (1 - peak) * 4);
      const fc = c.dir > 0 ? 250 + 3200 * env : 3400 - 2600 * u;
      const n = noise();
      return (f(n, fc, 1.6).bp * 1.1 + g(n, 500).lp * 0.35) * env;
    }, { gain: c.amp * 0.9, pan: (t) => (c.dir || 1) * (t / dur * 1.2 - 0.6), send: 0.3 });
  },
  whip(c) {
    const dur = 0.24, f = svf();
    put(beatS(c.b) - Math.round(dur * 0.55 * SR), Math.round(dur * SR), (t) => {
      const u = t / dur, env = Math.sin(Math.PI * Math.min(1, u)) ** 2;
      return f(noise(), 700 + 5000 * env, 2.2).bp * env * 1.3;
    }, { gain: c.amp, pan: (t) => (c.dir || 1) * (t / dur * 1.6 - 0.8), send: 0.2 });
  },
  zip(c) {
    const dur = 0.5, f = svf();
    put(beatS(c.b) - Math.round(0.1 * SR), Math.round(dur * SR), (t) => {
      const u = t / dur, env = Math.min(1, u * 12) * Math.exp(-u * 4);
      return f(noise(), 6000 * Math.exp(-u * 2.5) + 500, 3).bp * env * 1.2;
    }, { gain: c.amp, pan: (t) => 0.9 - t / dur * 1.8, send: 0.25 });
  },
  riser(c) {
    const start = beatS(c.from), len = beatS(c.b) - start, dur = len / SR;
    const f = svf(); let ph = 0;
    put(start, len, (t) => {
      const u = t / dur, bt = t / B + c.from;
      const gate = 0.55 + 0.45 * Math.cos(2 * Math.PI * (bt * (u < 0.5 ? 4 : 8)));
      const fr = 180 * Math.pow(7, u); ph += 2 * Math.PI * fr / SR;
      return (f(noise(), 300 * Math.pow(25, u), 1.2).hp * 0.7 + Math.sin(ph) * 0.12 + Math.sin(ph * 1.5) * 0.06) * u ** 2.4 * gate;
    }, { gain: c.amp, send: 0.35, pan: (t) => 0.3 * Math.sin(t * 9) });
  },
  swell(c) {
    const start = beatS(c.from), len = beatS(c.b) - start, dur = len / SR, f = svf();
    put(start, len, (t) => f(noise(), 5000, 0.9).hp * Math.pow(t / dur, 3.5) * 0.8, { gain: c.amp, send: 0.3 });
  },
  swish(c) {
    const dur = 0.22, f = svf();
    put(beatS(c.b) - Math.round(0.08 * SR), Math.round(dur * SR), (t) => {
      const u = t / dur, env = Math.sin(Math.PI * u) ** 1.5;
      return f(noise(), 2500 + 6000 * u, 1.3).bp * env * 0.9;
    }, { gain: c.amp, pan: (t) => -0.5 + t / dur, send: 0.25 });
  },
  pop(c) {
    let ph = 0, ph2 = 0;
    put(beatS(c.b), SR * 0.7, (t) => {
      const fr = c.note * (1 + 1.2 * Math.exp(-t * 90)); ph += 2 * Math.PI * fr / SR; ph2 += 2 * Math.PI * fr * 2 / SR;
      return (Math.sin(ph) * 0.8 + Math.sin(ph2) * 0.18 * Math.exp(-t * 20)) * Math.exp(-t * 11) * Math.min(1, t * 2000) * 0.55;
    }, { gain: c.amp, send: 0.4, pan: (rand() - 0.5) * 0.5 });
  },
  click(c) {
    const f = svf(); let ph = 0;
    put(beatS(c.b), SR * 0.12, (t) => { ph += 2 * Math.PI * 2100 / SR; return f(noise(), 4200, 1.5).bp * Math.exp(-t * 300) * 0.9 + Math.sin(ph) * Math.exp(-t * 90) * 0.35; }, { gain: c.amp, send: 0.15 });
    let p2 = 0;
    put(beatS(c.b) + Math.round(0.07 * SR), SR * 0.1, (t) => { p2 += 2 * Math.PI * 1500 / SR; return Math.sin(p2) * Math.exp(-t * 110) * 0.22; }, { gain: c.amp, send: 0.2 });
  },
  tickAt(b, freq, amp, pan = 0) {
    let ph = 0; const f = svf();
    put(beatS(b), Math.round(SR * 0.06), (t) => { ph += 2 * Math.PI * freq / SR; return (Math.sin(ph) * 0.5 + f(noise(), freq * 2, 2).bp * 0.6) * Math.exp(-t * 160); }, { gain: amp, pan, send: 0.12 });
  },
  type(c) {
    for (let i = 0; i < c.n; i++) I.tickAt(c.b + (i / c.n) * c.span + (rand() - 0.5) * 0.02, 2600 + rand() * 1600, c.amp * (0.6 + rand() * 0.4), (rand() - 0.5) * 0.6);
  },
  count(c) {
    const n = 18;
    for (let i = 0; i < n; i++) { const u = i / (n - 1); const bb = c.b + c.span * (1 - Math.pow(1 - u, 0.45)) ; I.tickAt(bb, 1800 + u * 1400, c.amp * (0.5 + 0.5 * u), 0); }
  },
  scatter(c) {
    for (let i = 0; i < 26; i++) {
      const b = c.b + rand() * c.span, fr = 3000 + rand() * 6000, f = svf();
      put(beatS(b), Math.round(SR * 0.04), (t) => f(noise(), fr, 4).bp * Math.exp(-t * 180) * 1.4, { gain: c.amp * (0.4 + rand() * 0.6), pan: rand() * 2 - 1, send: 0.4 });
    }
  },
  shimmer(c) {
    const notes = [1244.51, 1864.66, 2489.02, 2793.83, 3729.31];
    notes.forEach((fr, k) => { let ph = 0; put(beatS(c.b) + Math.round(k * 0.035 * SR), SR * 1.6, (t) => { ph += 2 * Math.PI * fr / SR; return Math.sin(ph) * Math.exp(-t * 3.5) * Math.min(1, t * 300) * 0.12; }, { gain: c.amp, pan: (k / 4) * 1.4 - 0.7, send: 0.7 }); });
  },
  ping(c) {
    let ph = 0, p3 = 0;
    put(beatS(c.b), SR * 2.5, (t) => { ph += 2 * Math.PI * c.note / SR; p3 += 2 * Math.PI * c.note * 3 / SR; return (Math.sin(ph) + Math.sin(p3) * 0.15 * Math.exp(-t * 4)) * Math.exp(-t * 1.9) * Math.min(1, t * 400) * 0.35; }, { gain: c.amp, send: 0.8 });
  },
  lock(c) {
    // metal latch: two sharp clacks and a low body thunk
    [0, 0.045].forEach((dt, k) => { const f = svf(); put(beatS(c.b) + Math.round(dt * SR), Math.round(SR * 0.09), (t) => f(noise(), 3200 - k * 900, 6).bp * Math.exp(-t * 90) * 2.2, { gain: c.amp, pan: k ? 0.15 : -0.15, send: 0.25 }); });
    let ph = 0; put(beatS(c.b), Math.round(SR * 0.3), (t) => { ph += 2 * Math.PI * (160 * Math.exp(-t * 20) + 70) / SR; return Math.sin(ph) * Math.exp(-t * 18) * 0.7; }, { gain: c.amp, send: 0.1 });
  },
  tick(c) { I.tickAt(c.b, 2200 + rand() * 600, c.amp, (rand() - 0.5) * 0.4); },
  glitch(c) {
    // stuttered, bit-crushed bursts on 32nd notes
    const steps = Math.round(c.span * 8);
    for (let k = 0; k < steps; k++) {
      if (rand() < 0.25) continue;
      const fr = 200 + rand() * 3000, f = svf(); let hold = 0, cnt = 0; const crush = 6 + Math.floor(rand() * 18);
      put(beatS(c.b + k / 8), Math.round(SR * B / 8 * 0.9), (t) => { if (cnt++ % crush === 0) hold = f(noise(), fr, 3).bp * 2.5 + Math.sign(Math.sin(t * fr * 6.283)) * 0.25; return hold * Math.exp(-t * 12); }, { gain: c.amp, pan: rand() * 1.4 - 0.7, send: 0.15 });
    }
  },
};

// ------------------------------------------------------------ cinematic beds
// band-limited saw by additive synthesis: fine for the low notes used here
const saw = (ph, nh) => { let s = 0; for (let k = 1; k <= nh; k++) s += Math.sin(ph * k) / k; return s * 0.55; };
const ROOT = 38.89; // D#1 — the key of the drone and the braams
I.drone = (c) => {
  const start = beatS(c.b), len = beatS(c.to) - start, dur = len / SR;
  const voices = [[ROOT, -0.4], [ROOT * 1.004, 0.4], [ROOT * 2, -0.2], [ROOT * 3.003, 0.3], [ROOT * 4.76, 0]]; // root, octave, fifth, minor third above
  voices.forEach(([fr, pan], k) => {
    let ph = 0; const f = svf();
    put(start, len, (t) => {
      ph += 2 * Math.PI * fr * (1 + 0.002 * Math.sin(t * 0.7 + k)) / SR;
      const fc = 180 + 160 * (0.5 + 0.5 * Math.sin(t * 0.45 + k)) + 90 * k;
      const env = Math.min(1, t / 1.2) * Math.min(1, (dur - t) / 1.5);
      return f(saw(ph, 14), fc, 0.9).lp * env * (k > 2 ? 0.35 : 0.6);
    }, { gain: c.amp, pan, send: 0.45 });
  });
};
I.braam = (c) => {
  const dur = c.dur * B + 1.2, len = Math.round(dur * SR);
  [[ROOT, 0], [ROOT * 1.006, -0.5], [ROOT * 2, 0.5], [ROOT * 3, -0.3], [ROOT * 4.002, 0.3]].forEach(([fr, pan], k) => {
    let ph = 0; const f = svf();
    put(beatS(c.b), len, (t) => {
      ph += 2 * Math.PI * fr / SR;
      const u = t / dur, fc = 140 + 2200 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.6)), 1.5) * Math.exp(-u * 1.5);
      const env = Math.min(1, t * 25) * Math.exp(-u * 2.2);
      return sat(f(saw(ph, 24), fc, 1.1).lp * 1.6, 2) * env * 0.5;
    }, { gain: c.amp, pan, send: 0.4 });
  });
  I.sub({ b: c.b, amp: c.amp * 0.8 });
};
I.tone = (c) => { // soft sine bed note, for pauses
  let ph = 0; const dur = (c.to - c.b) * B;
  put(beatS(c.b), Math.round(dur * SR), (t) => { ph += 2 * Math.PI * c.note / SR; return Math.sin(ph) * Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.6) * 0.3; }, { gain: c.amp, send: 0.7 });
};

for (const c of CUES) I[c.type](c);

// ------------------------------------------------------------ reverb on the send bus (Freeverb-style)
function reverb(inL, inR) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const make = (spread) => {
    const cb = combs.map((d) => ({ buf: new Float32Array(d + spread), i: 0, st: 0 }));
    const ab = aps.map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    return (x) => {
      let out = 0;
      for (const c of cb) { const y = c.buf[c.i]; c.st = y * 0.72 + c.st * 0.28; c.buf[c.i] = x * 0.015 + c.st * 0.86; c.i = (c.i + 1) % c.buf.length; out += y; }
      for (const a of ab) { const y = a.buf[a.i]; a.buf[a.i] = out + y * 0.5; a.i = (a.i + 1) % a.buf.length; out = y - out; }
      return out;
    };
  };
  const rl = make(0), rr = make(23), oL = new Float32Array(inL.length), oR = new Float32Array(inR.length);
  for (let i = 0; i < inL.length; i++) { const m = inL[i] + inR[i]; oL[i] = rl(m); oR[i] = rr(m); }
  return [oL, oR];
}
const [RL, RR] = reverb(SEND_L, SEND_R);
const OL = new Float32Array(TOTAL), OR = new Float32Array(TOTAL);
let env = 0;
for (let i = 0; i < TOTAL; i++) {
  const l = (SFX_L[i] + RL[i] * 1.6) * 0.5, r = (SFX_R[i] + RR[i] * 1.6) * 0.5;
  const pk = Math.max(Math.abs(l), Math.abs(r));
  env = pk > env ? pk : env * 0.9997 + pk * 0.0003;
  const g = env > 0.92 ? 0.92 / env : 1;
  OL[i] = sat(l * g, 1.1) * 0.97; OR[i] = sat(r * g, 1.1) * 0.97;
}
const FILM = beatS(BEATS);
const cut = (a) => { const o = a.slice(0, FILM); for (let i = 0; i < 4410; i++) o[FILM - 1 - i] *= i / 4410; return o; };
writeWav(path.join(FILM_DIR, 'audio.wav'), cut(OL), cut(OR));
console.log('audio written', (FILM / SR).toFixed(3) + 's', CUES.length, 'cues');
