/**
 * Offline schedule → PCM (Node + browser). Triangle FM-ish preview, no Web Audio required.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlPreviewRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SAMPLE_RATE = 44100;
  const DEFAULT_MAX_SEC = 24;

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function trimSchedule(schedule, maxSec) {
    const cap = maxSec != null ? maxSec : DEFAULT_MAX_SEC;
    const events = (schedule && schedule.events) || [];
    const trimmed = events.filter((e) => (e.time || 0) < cap);
    const end = trimmed.reduce((m, e) => Math.max(m, (e.time || 0) + (e.duration || 0.1)), 0);
    return { events: trimmed, duration: Math.min(cap, Math.max(0.5, end)) };
  }

  function renderSchedule(schedule, opts) {
    const maxSec = (opts && opts.maxSec) != null ? opts.maxSec : DEFAULT_MAX_SEC;
    const thin = trimSchedule(schedule, maxSec);
    const events = thin.events;
    if (!events.length) return { samples: new Float32Array(0), duration: 0, sampleRate: SAMPLE_RATE };
    const durationSec = Math.min(maxSec, thin.duration + 0.1);
    const length = Math.ceil(durationSec * SAMPLE_RATE);
    const out = new Float32Array(length);
    const mix = Math.sqrt(Math.min(events.length, 48));
    const vol = (opts && opts.volume) != null ? opts.volume : 0.45;

    for (const ev of events) {
      const start = Math.max(0, ev.time || 0);
      const dur = Math.max(0.05, ev.duration || 0.1);
      const hz = Math.max(30, midiToHz(ev.midi));
      const i0 = Math.floor(start * SAMPLE_RATE);
      const i1 = Math.min(length, Math.floor((start + dur) * SAMPLE_RATE));
      const peak = 0.4 / mix;
      for (let i = i0; i < i1; i++) {
        const t = i / SAMPLE_RATE - start;
        const attack = Math.min(0.03, dur * 0.1);
        let env = peak;
        if (t < attack) env *= t / attack;
        else env *= Math.max(0, 1 - (t - attack) / (dur - attack + 0.001));
        out[i] += Math.sin(2 * Math.PI * hz * t) * env * vol;
      }
    }
    return { samples: out, duration: durationSec, sampleRate: SAMPLE_RATE };
  }

  function rms(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  return { SAMPLE_RATE, DEFAULT_MAX_SEC, trimSchedule, renderSchedule, rms, midiToHz };
});
