/**
 * Browser playback for Genesis FM schedules (offline render → single buffer).
 */
(function (root) {
  let ctx = null;
  let active = [];

  const MAX_RENDER_EVENTS = 360;
  const MAX_RENDER_SEC = 75;

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function ensureContext() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    return ctx;
  }

  function stopAll() {
    for (const node of active) {
      try {
        node.stop();
      } catch (e) { /* already stopped */ }
    }
    active = [];
  }

  function thinEvents(events) {
    if (events.length <= MAX_RENDER_EVENTS) return events;
    const step = Math.ceil(events.length / MAX_RENDER_EVENTS);
    return events.filter((_, i) => i % step === 0);
  }

  async function renderSchedule(schedule, options) {
    const events = thinEvents((schedule && schedule.events) || []);
    if (!events.length) return null;
    const endTime = events.reduce((m, e) => Math.max(m, (e.time || 0) + (e.duration || 0.1)), 0);
    const durationSec = Math.min(MAX_RENDER_SEC, Math.max(0.5, endTime + 0.15));
    const sampleRate = 44100;
    const length = Math.ceil(durationSec * sampleRate);
    const offline = new OfflineAudioContext(1, length, sampleRate);
    const master = offline.createGain();
    const vol = (options && options.volume) != null ? options.volume : 0.45;
    master.gain.value = vol;
    master.connect(offline.destination);
    const mix = Math.sqrt(Math.min(events.length, 48));

    for (const ev of events) {
      const start = Math.max(0, ev.time || 0);
      const dur = Math.max(0.05, ev.duration || 0.1);
      const hz = Math.max(30, midiToHz(ev.midi));
      const osc = offline.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz;
      const g = offline.createGain();
      const peak = 0.35 / mix;
      g.gain.setValueAtTime(0.001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.03, dur * 0.1));
      g.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(Math.min(durationSec, start + dur + 0.02));
    }

    return { buffer: await offline.startRendering(), duration: durationSec };
  }

  async function playSchedule(schedule, options) {
    stopAll();
    const audio = ensureContext();
    if (audio.state === 'suspended') {
      await audio.resume();
    }
    const rendered = await renderSchedule(schedule, options);
    if (!rendered || !rendered.buffer) {
      return { duration: 0 };
    }
    const src = audio.createBufferSource();
    src.buffer = rendered.buffer;
    src.connect(audio.destination);
    src.start();
    active.push(src);
    return { duration: rendered.duration };
  }

  root.NhlAudioEngine = { playSchedule, stopAll, ensureContext, renderSchedule };
})(typeof self !== 'undefined' ? self : this);
