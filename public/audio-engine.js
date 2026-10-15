/**
 * Browser playback for Genesis FM schedules (Web Audio; not cycle-accurate YM2612).
 */
(function (root) {
  let ctx = null;
  let active = [];

  const MAX_VOICES = 320;

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

  function playVoice(audio, t0, ev, gainMaster) {
    const carrierHz = Math.max(20, midiToHz(ev.midi));
    const dur = Math.max(0.04, ev.duration || 0.1);
    const start = t0 + (ev.time || 0);
    const stop = start + dur + 0.03;

    const osc = audio.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(carrierHz, start);

    const amp = audio.createGain();
    const peak = 0.28 / Math.sqrt(Math.max(1, (ev._mix || 8)));
    amp.gain.setValueAtTime(0.001, start);
    amp.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.025, dur * 0.12));
    amp.gain.exponentialRampToValueAtTime(peak * 0.35, start + dur * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.001, stop);

    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 4200;
    filter.Q.value = 0.6;

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(gainMaster);

    osc.start(start);
    osc.stop(stop);
    active.push(osc);
  }

  async function playSchedule(schedule, options) {
    stopAll();
    const audio = ensureContext();
    if (audio.state === 'suspended') {
      await audio.resume();
    }
    const gainMaster = audio.createGain();
    const vol = (options && options.volume) != null ? options.volume : 0.35;
    gainMaster.gain.value = vol;
    gainMaster.connect(audio.destination);

    const t0 = audio.currentTime + 0.06;
    let events = (schedule && schedule.events) ? schedule.events.slice() : [];
    if (events.length > MAX_VOICES) {
      const step = Math.ceil(events.length / MAX_VOICES);
      events = events.filter((_, i) => i % step === 0);
    }
    const mix = Math.min(16, Math.max(4, Math.ceil(events.length / 40)));
    for (const ev of events) {
      ev._mix = mix;
      playVoice(audio, t0, ev, gainMaster);
    }
    const duration = (schedule && schedule.duration) || 3;
    return { duration };
  }

  root.NhlAudioEngine = { playSchedule, stopAll, ensureContext };
})(typeof self !== 'undefined' ? self : this);
