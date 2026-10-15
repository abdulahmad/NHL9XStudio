/**
 * Browser playback for Genesis FM schedules (2-op style Web Audio, not cycle-accurate YM2612).
 */
(function (root) {
  let ctx = null;
  let active = [];

  const FM_PRESETS = [
    { modRatio: 1, modIndex: 1.2, filter: 3200 },
    { modRatio: 2, modIndex: 2.5, filter: 2800 },
    { modRatio: 1, modIndex: 3.5, filter: 2200 },
    { modRatio: 3, modIndex: 1.8, filter: 4000 },
    { modRatio: 0.5, modIndex: 2, filter: 1800 },
    { modRatio: 2, modIndex: 4, filter: 2600 },
    { modRatio: 1, modIndex: 0.8, filter: 5000 },
    { modRatio: 4, modIndex: 1.5, filter: 3500 }
  ];

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

  function presetFor(instrument) {
    const idx = (instrument != null ? instrument : 0) % FM_PRESETS.length;
    return FM_PRESETS[idx];
  }

  function playFmVoice(audio, t0, ev, gainMaster) {
    const preset = presetFor(ev.instrument);
    const carrierHz = midiToHz(ev.midi);
    const modHz = carrierHz * preset.modRatio;
    const dur = Math.max(0.04, ev.duration || 0.1);
    const start = t0 + (ev.time || 0);
    const stop = start + dur + 0.02;

    const mod = audio.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = modHz;

    const modGain = audio.createGain();
    modGain.gain.value = preset.modIndex * carrierHz * 0.012;

    const carrier = audio.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = carrierHz;

    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    const amp = audio.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(0.35, start + Math.min(0.02, dur * 0.15));
    amp.gain.exponentialRampToValueAtTime(0.12, start + dur * 0.55);
    amp.gain.exponentialRampToValueAtTime(0.0001, stop);

    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.filter;
    filter.Q.value = 0.7;

    carrier.connect(filter);
    filter.connect(amp);
    amp.connect(gainMaster);

    mod.start(start);
    carrier.start(start);
    mod.stop(stop);
    carrier.stop(stop);
    active.push(carrier);
    active.push(mod);
  }

  function playSchedule(schedule, options) {
    stopAll();
    const audio = ensureContext();
    if (audio.state === 'suspended') audio.resume();
    const gainMaster = audio.createGain();
    const vol = (options && options.volume) != null ? options.volume : 0.22;
    gainMaster.gain.value = vol;
    gainMaster.connect(audio.destination);
    const t0 = audio.currentTime + 0.05;
    const events = schedule.events || [];
    const peakVoices = Math.min(12, Math.max(4, Math.ceil(events.length / 80)));
    const voiceGain = 1 / Math.sqrt(peakVoices);
    gainMaster.gain.value = vol * voiceGain;

    for (const ev of events) {
      playFmVoice(audio, t0, ev, gainMaster);
    }
    const duration = schedule.duration || 3;
    return { duration };
  }

  root.NhlAudioEngine = { playSchedule, stopAll, ensureContext };
})(typeof self !== 'undefined' ? self : this);
