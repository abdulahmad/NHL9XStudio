/**
 * Browser preview for Genesis FM cmdstream schedules (square-wave sketch).
 */
(function (root) {
  let ctx = null;
  let active = [];

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

  function playSchedule(schedule, options) {
    stopAll();
    const audio = ensureContext();
    if (audio.state === 'suspended') audio.resume();
    const gainMaster = audio.createGain();
    gainMaster.gain.value = (options && options.volume) != null ? options.volume : 0.12;
    gainMaster.connect(audio.destination);
    const t0 = audio.currentTime + 0.05;
    for (const ev of schedule.events || []) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = midiToHz(ev.midi);
      g.gain.value = 1;
      osc.connect(g);
      g.connect(gainMaster);
      const start = t0 + (ev.time || 0);
      const end = start + Math.max(0.03, ev.duration || 0.1);
      osc.start(start);
      osc.stop(end);
      active.push(osc);
    }
    const duration = schedule.duration || 3;
    return { duration };
  }

  root.NhlAudioEngine = { playSchedule, stopAll, ensureContext };
})(typeof self !== 'undefined' ? self : this);
