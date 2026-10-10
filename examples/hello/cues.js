// Cue sheet for the hello film. Times are in beats. The same list drives the camera (film.html) and the sound (tools/sound.js).
(function () {
  const BPM = 120, BEATS = 16;
  const CUES = [
    { type: 'drone', b: 0, to: 16, amp: 0.22 },
    { type: 'impact', b: 0, amp: 0.8, shake: 0.5 }, { type: 'hit', b: 1, amp: 0.7 }, { type: 'hit', b: 2, amp: 0.7 },
    { type: 'impact', b: 3, amp: 1, shake: 0.8, glitch: 0.7 },
    { type: 'whoosh', b: 4, dur: 0.8, dir: 1, amp: 0.7 },
    { type: 'pop', b: 4, note: 311, amp: 0.6 }, { type: 'pop', b: 5, note: 370, amp: 0.6 }, { type: 'pop', b: 6, note: 466, amp: 0.6 }, { type: 'pop', b: 7, note: 622, amp: 0.6 },
    { type: 'count', b: 4, span: 3.5, amp: 0.3 },
    { type: 'riser', from: 6.5, b: 8, amp: 0.5 },
    { type: 'impact', b: 8, amp: 0.9, shake: 0.6 }, { type: 'scatter', b: 8, span: 1.5, amp: 0.4 },
    { type: 'shimmer', b: 10, amp: 0.5 },
    { type: 'whoosh', b: 12, dur: 0.6, dir: -1, amp: 0.7 },
    { type: 'impact', b: 12, amp: 1, shake: 0.7 }, { type: 'braam', b: 12, dur: 3, amp: 0.6 },
    { type: 'ping', b: 13, note: 622, amp: 0.4 },
  ];
  const out = { BPM, BEATS, CUES };
  if (typeof module !== 'undefined') module.exports = out; else window.FILMCUES = out;
})();
