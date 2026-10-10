// Lay an audio file on a silent render: node tools/mux.js <video.mp4> <audio> <out.mp4> [fadeSeconds]
// The audio starts at 0, is cut to the video's length, fades out at the end (default 0.5 s) and is normalised to -14 LUFS.
const { spawnSync } = require('child_process');
const FF = process.env.FFMPEG || 'ffmpeg';
const [video, audio, out, fade = '0.5'] = process.argv.slice(2);
if (!out) { console.error('usage: node tools/mux.js <video.mp4> <audio> <out.mp4> [fadeSeconds]'); process.exit(1); }
const probe = spawnSync(FF, ['-hide_banner', '-i', video], { encoding: 'utf8' }).stderr || '';
const m = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
if (!m) { console.error('cannot read duration of', video); process.exit(1); }
const dur = +m[1] * 3600 + +m[2] * 60 + +m[3], f = Math.min(+fade, dur);
const r = spawnSync(FF, ['-loglevel', 'error', '-y', '-i', video, '-i', audio,
  '-filter_complex', `[1:a]apad,atrim=0:${dur},afade=t=out:st=${(dur - f).toFixed(3)}:d=${f}:curve=qsin,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log(out, dur.toFixed(2) + ' s');
