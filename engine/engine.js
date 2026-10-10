// beatfilm engine: canvas helpers + a film runner.
// Every pixel is a pure function of t (seconds), so tools/capture.js can render any frame deterministically.
// A film calls Film({ bpm, beats, draw(ctx, t, b), images, fonts }). Inside draw, t is seconds and b is beats.
(function () {
  const W = window.FILM_W || 1080, H = window.FILM_H || 1920; // set window.FILM_W / FILM_H before loading for another size
  const C = { bg: '#000', fg: '#f4f4f2', mute: '#8d8d8a', paper: '#f1f0ec', ink: '#0b0b0b', red: '#ff3b30' };

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const seg = (b, a, e) => clamp((b - a) / (e - a)); // 0..1 progress of b inside [a,e]
  const E = {
    lin: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inCubic: (p) => p * p * p,
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
    inOutExpo: (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    outBack: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    outQuint: (p) => 1 - Math.pow(1 - p, 5),
    // damped spring that overshoots once, settles at 1
    spring: (p) => (p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(9 * p)),
  };
  const ease = (b, a, e, fn = E.outExpo) => fn(seg(b, a, e));
  // deterministic pseudo-random
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ---------- fonts ----------
  const FONTS = [
    ['MYS', 'fonts/MakeYourselfSans-Regular.ttf', '400', 'normal'],
    ['MYS', 'fonts/MakeYourselfSans-Bold.ttf', '700', 'normal'],
  ];
  const ENGINE_DIR = (document.currentScript && document.currentScript.src.replace(/engine\.js.*$/, '')) || '../../engine/';
  // extra = [[family, url, weight, style], ...] with urls relative to the film page
  async function loadFonts(extra = []) {
    for (const [fam, file, weight, style] of [...FONTS.map((f) => [f[0], ENGINE_DIR + f[1], f[2], f[3]]), ...extra]) {
      const f = new FontFace(fam, `url(${file})`, { weight: weight || "400", style: style || "normal" });
      await f.load(); document.fonts.add(f);
    }
  }
  function loadImages(list) {
    return Promise.all(list.map((src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => { console.warn('missing', src); res(null); }; im.src = src; })));
  }

  // ---------- drawing helpers ----------
  function font(ctx, size, { w = 700, fam = 'MYS', style = 'normal', ls = 0 } = {}) {
    ctx.font = `${style} ${w} ${size}px ${fam}`;
    ctx.letterSpacing = `${ls}px`;
  }
  // text with alignment + optional per-line mask reveal (p 0..1 slides text up from under a baseline mask)
  function text(ctx, s, x, y, { size = 100, w = 700, fam = 'MYS', style = 'normal', ls, color = C.fg, align = 'center', base = 'alphabetic', alpha = 1, reveal = 1 } = {}) {
    if (alpha <= 0 || reveal <= 0) return;
    ctx.save();
    font(ctx, size, { w, fam, style, ls: ls ?? -size * 0.035 });
    ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = color; ctx.globalAlpha *= alpha;
    if (reveal < 1) {
      const m = ctx.measureText(s), asc = size * 1.0, desc = size * 0.3;
      const wdt = m.width + size; const x0 = align === 'center' ? x - wdt / 2 : align === 'right' ? x - wdt : x - size * 0.5;
      ctx.beginPath(); ctx.rect(x0, y - asc, wdt, asc + desc); ctx.clip();
      y += (1 - reveal) * (asc + desc);
    }
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  function measure(ctx, s, size, opts = {}) { ctx.save(); font(ctx, size, { ...opts, ls: opts.ls ?? -size * 0.035 }); const w = ctx.measureText(s).width; ctx.restore(); return w; }
  function rrect(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function glow(ctx, x, y, r, color, a = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha *= a; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.restore();
  }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

  // ---------- film furniture: HUD, grain, vignette ----------
  const grain = [];
  function makeGrain() {
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = 540; c.height = 960;
      const g = c.getContext('2d'), id = g.createImageData(540, 960);
      for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (rnd(i * 0.37 + k * 999) - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0); grain.push(c);
    }
  }
  function drawGrain(ctx, t, amt = 0.07) {
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = amt;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(grain[Math.floor(t * 24) % grain.length], 0, 0, W, H); ctx.restore();
  }
  function vignette(ctx, a = 0.55) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // small technical corner labels; light = light text on a dark background
  function hud(ctx, t, { title = 'BEATFILM', code = 'BF—000', footL = '', footR = '', light = true, alpha = 1 } = {}) {
    if (alpha <= 0) return;
    const col = light ? 'rgba(244,244,242,0.42)' : 'rgba(11,11,11,0.5)';
    ctx.save(); ctx.globalAlpha *= alpha; font(ctx, 19, { w: 400, fam: 'monospace', ls: 1.5 }); ctx.fillStyle = col; ctx.textBaseline = 'top';
    const fr = String(Math.floor(t * 60)).padStart(4, '0');
    const tc = `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`;
    ctx.textAlign = 'left'; ctx.fillText(title, 56, 64); ctx.fillText(code, 56, 90);
    ctx.textAlign = 'right'; ctx.fillText('REC ' + tc, W - 56, 64); ctx.fillText('FR ' + fr, W - 56, 90);
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText(footL, 56, H - 60);
    ctx.textAlign = 'right'; ctx.fillText(footR, W - 56, H - 60);
    // thin crop ticks
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (const [x, y, dx, dy] of [[36, 36, 1, 1], [W - 36, 36, -1, 1], [36, H - 36, 1, -1], [W - 36, H - 36, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * 22); ctx.lineTo(x, y); ctx.lineTo(x + dx * 22, y); ctx.stroke();
    }
    ctx.restore();
  }

  // particles sampled from text: returns [{x,y}] target points for a string
  function textPoints(str, size, { step = 7, w = 700, fam = 'MYS', style = 'normal', ls } = {}) {
    const c = document.createElement('canvas'); c.width = W; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${style} ${w} ${size}px ${fam}`; g.letterSpacing = `${ls ?? -size * 0.035}px`;
    g.fillText(str, W / 2, 300);
    const d = g.getImageData(0, 0, W, 600).data, pts = [];
    for (let y = 0; y < 600; y += step) for (let x = 0; x < W; x += step) if (d[(y * W + x) * 4 + 3] > 128) pts.push({ x, y: y - 300 });
    return pts;
  }

  // particles sampled from any drawing: draw(g) paints white on a W×H canvas; returns absolute {x,y}
  function shapePoints(draw, step = 7) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; draw(g);
    const d = g.getImageData(0, 0, W, H).data, pts = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (d[(y * W + x) * 4 + 3] > 128) pts.push({ x, y });
    return pts;
  }
  function shuffle(a, s = 1) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd(i * 1.7 + s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // horizontal slice glitch over the whole frame (amt 0..1)
  let tmp = null;
  function sliceGlitch(ctx, amt, seed) {
    if (amt <= 0.01) return;
    if (!tmp) { tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; }
    const g = tmp.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(ctx.canvas, 0, 0);
    const n = 14;
    for (let k = 0; k < n; k++) {
      if (rnd(seed * 13 + k) > 0.55 + 0.4 * amt) continue;
      const y = Math.floor(rnd(seed * 7 + k * 3) * H), h = 8 + rnd(seed + k * 5) * 120 * amt, dx = (rnd(seed * 3 + k) - 0.5) * 180 * amt;
      ctx.drawImage(tmp, 0, y, W, h, dx, y, W, h);
      if (rnd(seed + k * 11) > 0.6) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.5 * amt; ctx.fillStyle = rnd(k + seed) > 0.5 ? '#ff3b30' : '#6af'; ctx.fillRect(dx * 1.4, y, W, h * 0.3); ctx.restore(); }
    }
  }
  // camera shake offset that decays after `at` (seconds of beats handled by caller)
  function shake(ctx, amt, seed) { if (amt <= 0.01) return; ctx.translate((rnd(seed) - 0.5) * 40 * amt, (rnd(seed + 9) - 0.5) * 40 * amt); }
  // slow floating dust with parallax
  function dust(ctx, t, { n = 90, alpha = 0.5, color = '244,244,242' } = {}) {
    for (let i = 0; i < n; i++) {
      const z = 0.3 + rnd(i * 3) * 0.7, x = (rnd(i) * W + t * 12 * z * (rnd(i + 5) - 0.5) * 4 + W) % W, y = (rnd(i + 1) * H - t * 25 * z + H * 4) % H;
      ctx.fillStyle = `rgba(${color},${alpha * z * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + i)))})`;
      ctx.beginPath(); ctx.arc(x, y, 1 + 2.4 * z, 0, Math.PI * 2); ctx.fill();
    }
  }
  function shock(ctx, x, y, p, { r = 600, color = '244,244,242', w = 6 } = {}) {
    if (p <= 0 || p >= 1) return; ctx.save(); ctx.strokeStyle = `rgba(${color},${(1 - p) * 0.8})`; ctx.lineWidth = w * (1 - p) + 1;
    ctx.beginPath(); ctx.arc(x, y, r * E.outCubic(p), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  // time warp for fitting an animation to a song: segs = [[new0,new1,old0,old1], ...] in beats.
  // Inside a segment old time runs linearly; between segments it jumps (a hard cut).
  function warp(b, segs) {
    if (b <= segs[0][0]) return segs[0][2];
    for (const [n0, n1, o0, o1] of segs) if (b < n1) return lerp(o0, o1, clamp((b - n0) / (n1 - n0)));
    return segs[segs.length - 1][3];
  }
  // same idea from anchor pairs [[new, old], ...]
  const warpPts = (b, pts) => warp(b, pts.slice(1).map((p, i) => [pts[i][0], p[0], pts[i][1], p[1]]));

  // camera response to the cue sheet: zoom punch on impacts, shake, slice glitch
  function cueFx(b, cues) {
    let punch = 0, shk = 0, gl = 0;
    const dec = (at, k) => (b >= at ? Math.exp(-(b - at) * k) : 0);
    for (const c of cues || []) {
      if (c.type === 'impact' || c.type === 'lock') punch += 0.035 * (c.amp || 1) * dec(c.b, 9);
      if (c.shake) shk += c.shake * dec(c.b, 10);
      if (c.glitch && b >= c.b - 0.08 && b < c.b + 0.14) gl = Math.max(gl, c.glitch * (1 - Math.abs(b - c.b - 0.03) / 0.12));
    }
    return { punch, shk, gl };
  }
  function camera(ctx, t, fx, { punch = 1 } = {}) {
    ctx.translate(W / 2, H / 2); const s = 1 + fx.punch * punch + 0.045 * fx.shk; /* overscan hides the edges while shaking */ ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    shake(ctx, fx.shk, Math.floor(t * 60));
  }

  // ---------- film runner ----------
  window.Film = async function ({ bpm, beats, draw, images = [], fonts = [], setup, grainAmt = 0.07 }) {
    const B = 60 / bpm;
    window.DURATION = beats * B;
    const cv = document.getElementById('c'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    await loadFonts(fonts); makeGrain();
    const imgs = await loadImages(images);
    const state = setup ? await setup({ imgs, ctx }) : {};
    window.renderFrame = (t) => {
      const b = t / B;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      draw(ctx, t, b, { imgs, state, B });
      drawGrain(ctx, t, grainAmt);
      ctx.restore();
    };
    const q = new URLSearchParams(location.search);
    if (q.has('t')) window.renderFrame(+q.get('t'));
    else if (!q.has('render')) { const t0 = performance.now(); const loop = () => { window.renderFrame(((performance.now() - t0) / 1000) % window.DURATION); requestAnimationFrame(loop); }; loop(); }
    window.__ready = true;
  };

  window.BF = window.MY = { W, H, C, clamp, lerp, seg, E, ease, rnd, font, text, measure, rrect, glow, rgba, hud, vignette, textPoints, shapePoints, shuffle, sliceGlitch, shake, dust, shock, cueFx, camera, warp, warpPts };
})();
