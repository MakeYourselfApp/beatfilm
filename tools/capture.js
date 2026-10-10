// Deterministic frame capture: drives window.renderFrame(t) in headless Chrome over CDP and pipes JPEG frames into ffmpeg.
// usage: node capture.js <page.html> <out.mp4> <fps> [fromSec] [toSec] [--png dir step]   (out '-' = stills only)
// env: CHROME, FFMPEG, CAP_W, CAP_H (default 1080x1920)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
function findChrome() {
  const c = process.platform === 'win32' ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => fs.existsSync(p)) || 'google-chrome';
}
const CHROME = process.env.CHROME || findChrome();
const FF = process.env.FFMPEG || 'ffmpeg';
const args = process.argv.slice(2);
const page = path.resolve(args[0]), out = args[1], fps = +args[2] || 60;
const num = (v) => (v !== undefined && !isNaN(+v) ? +v : null);
const from = num(args[3]) ?? 0, to = num(args[4]);
const sheetIdx = args.indexOf('--png');
const pngDir = sheetIdx >= 0 ? args[sheetIdx + 1] : null;
const pngStep = sheetIdx >= 0 ? +args[sheetIdx + 2] : 0;
const W = +process.env.CAP_W || 1080, H = +process.env.CAP_H || 1920, PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const prof = path.join(require('os').tmpdir(), 'beatfilm_prof_' + PORT);
  const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--hide-scrollbars',
    '--allow-file-access-from-files', '--force-device-scale-factor=1', `--window-size=${W},${H}`, '--mute-audio',
    '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 100; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.find((x) => x.type === 'page')) break; } catch (e) {} await sleep(100); }
  const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800)); return r.result.result.value; };
  await cmd('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.enable'); await cmd('Runtime.enable'); ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') console.error('PAGE EXC', JSON.stringify(d.params.exceptionDetails).slice(0, 600)); if (d.method === 'Runtime.consoleAPICalled' && d.params.type !== 'log') console.error('PAGE', d.params.type, JSON.stringify(d.params.args.map(a => a.value || a.description)).slice(0, 400)); });
  await cmd('Page.navigate', { url: 'file:///' + page.split(String.fromCharCode(92)).join('/') + '?render=1' });
  for (let i = 0; i < 300; i++) { await sleep(100); try { if (await ev('window.__ready === true')) break; } catch (e) {} }
  const dur = await ev('window.DURATION'); console.log('state', await ev('JSON.stringify({d: window.DURATION, r: window.__ready, t: document.title, c: !!window.CUESET, href: location.href})'));
  const end = to === null ? dur : Math.min(to, dur);
  const n0 = Math.round(from * fps), n1 = Math.round(end * fps);
  let ff = null;
  if (out !== '-') {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  if (pngDir) fs.mkdirSync(pngDir, { recursive: true });
  const t0 = Date.now();
  for (let n = n0; n < n1; n++) {
    const t = n / fps;
    await ev(`window.renderFrame(${t})`);
    const wantPng = pngDir && (n - n0) % pngStep === 0;
    if (ff) {
      const s = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: 94, captureBeyondViewport: false });
      const buf = Buffer.from(s.result.data, 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (wantPng) fs.writeFileSync(path.join(pngDir, `f_${String(n).padStart(5, '0')}.jpg`), buf);
    } else if (wantPng) {
      const s = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
      fs.writeFileSync(path.join(pngDir, `f_${String(n).padStart(5, '0')}.jpg`), Buffer.from(s.result.data, 'base64'));
    }
    if ((n - n0) % 60 === 0) process.stdout.write(`frame ${n}/${n1} ${(((Date.now() - t0) / (n - n0 + 1))).toFixed(0)} ms/f\n`);
  }
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
  ws.close(); ch.kill();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
  console.log('done', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => { console.error(e); process.exit(1); });
