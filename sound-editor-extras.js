/**
 * Sequencer editor extras shared by the NHL 92, NHL 93/94 and SNES piano rolls: a scrub bar for one pass of the song,
 * a seconds ruler above the roll and a playhead line that follows the audible position while the editor's song plays
 * (and the roll scrolls to keep it in view). The playhead is a CSS-positioned element, so following the music costs
 * no canvas redraw.
 *
 * Clicking or dragging the scrub bar or the ruler seeks: while the song plays (or is paused) the host jumps there;
 * while it is stopped the spot becomes the cue, where the next Play starts (cue()).
 */
(function (root) {
  'use strict';

  const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

  /**
   * Run time `now` -> the position inside one pass of `total` seconds. A song with a loop point (`loop` seconds, 0 for
   * NHL 92) repeats from there; one without (null) stops at its end.
   */
  function foldRun(now, total, loop) {
    if (!(total > 0) || now <= total) return now;
    if (loop == null) return total;
    return total > loop ? loop + ((now - loop) % (total - loop)) : now % total;
  }

  /**
   * Song position `sec` -> the run time to seek to while the run is at `now`: in a later pass the spot is taken in the
   * pass being heard when the loop repeats it, otherwise in the first pass.
   */
  function seekRunTime(sec, now, total, loop) {
    if (now == null || now <= total || loop == null || !(total > loop) || sec < loop) return sec;
    const len = total - loop;
    const pass = Math.floor((now - total) / len) + 1;
    return total + (pass - 1) * len + (sec - loop);
  }

  /**
   * @param {{ scroller: HTMLElement, inner: HTMLElement, gutter: number,
   *           pxPerSec: function(): number, totalSec: function(): number, loopSec: function(): (number|null),
   *           hostSec: function(): (number|null), paused: function(): boolean,
   *           seek: (function(number): void)|undefined, seeking: (function(): (number|null))|undefined }} o
   *   hostSec is the audible run time of the playing song (it keeps counting past the end of a pass), null when
   *   stopped; seek(runSec) moves the playing song to that run time; seeking() is how far that has got (0..1), or null.
   */
  function attach(o) {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    const C = { bg: v('--raise-2', '#222c36'), line: v('--line', '#33414d'), text: v('--muted', '#8ea0b0'), now: v('--amber', '#f0b429') };
    const mono = v('--mono', 'ui-monospace, monospace');

    // Scrub bar: one pass of the song. The time text has a fixed width so nothing moves while it changes.
    const scrub = document.createElement('div');
    scrub.className = 'se-scrub-row';
    const track = document.createElement('div');
    track.className = 'se-scrub';
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Song position (click or drag to seek; while stopped, sets where Play starts)');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    const rail = document.createElement('div');
    rail.className = 'se-scrub-rail';
    const fill = document.createElement('div');
    fill.className = 'se-scrub-fill';
    const knob = document.createElement('div');
    knob.className = 'se-scrub-knob';
    rail.append(fill, knob);
    track.appendChild(rail);
    const time = document.createElement('span');
    time.className = 'se-scrub-time mono';
    scrub.append(track, time);

    const ruler = document.createElement('div');
    ruler.className = 'se-ruler';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Seconds into the song (click or drag to seek)');
    ruler.appendChild(canvas);
    o.scroller.parentNode.insertBefore(scrub, o.scroller);
    o.scroller.parentNode.insertBefore(ruler, o.scroller);
    o.scroller.classList.add('has-ruler');

    const head = document.createElement('div');
    head.className = 'se-playhead';
    head.hidden = true;
    o.inner.appendChild(head);

    let width = 0;
    let key = '';
    let lastHead = null;
    let cue = 0; // song seconds where the next Play starts
    let drag = null; // song seconds under the pointer while the scrub bar or ruler is held
    let jump = false; // scroll the playhead into view on the next frame (after a seek), even while paused
    let ro = null;
    const measure = () => { width = o.scroller.clientWidth || width; };
    measure();
    if (root.ResizeObserver) {
      ro = new root.ResizeObserver(measure);
      ro.observe(o.scroller);
    }

    const clock = (s) => {
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return m ? m + ':' + (r < 10 ? '0' : '') + r.toFixed(r % 1 ? 1 : 0) : r.toFixed(r % 1 ? 1 : 0) + 's';
    };

    const fold = (now) => foldRun(now, o.totalSec(), o.loopSec());
    const runTimeFor = (sec, now) => seekRunTime(sec, now, o.totalSec(), o.loopSec());

    /** Seek to `sec` seconds of the song (clamped to one pass). */
    function seekTo(sec) {
      const total = o.totalSec();
      sec = Math.max(0, Math.min(total > 0 ? total : 0, sec));
      const now = o.hostSec();
      if (now != null && o.seek) o.seek(runTimeFor(sec, now));
      else cue = sec;
      jump = true;
      lastHead = null;
      key = '';
    }

    function drawRuler(pps, sx, nowSec, cueSec) {
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      const w = Math.max(100, width);
      const h = 20;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, w, h);
      g.font = '10px ' + mono;
      g.textBaseline = 'middle';
      const step = STEPS.find((s) => s * pps >= 56) || STEPS[STEPS.length - 1];
      const t0 = Math.max(0, Math.floor((sx - o.gutter) / pps / step) * step);
      g.strokeStyle = C.line;
      g.fillStyle = C.text;
      g.beginPath();
      for (let t = t0; ; t += step) {
        const x = o.gutter + t * pps - sx;
        if (x > w) break;
        if (x < o.gutter - 1) continue;
        g.moveTo(Math.round(x) + 0.5, 12);
        g.lineTo(Math.round(x) + 0.5, h);
        g.fillText(clock(t), x + 3, 7);
      }
      g.stroke();
      g.fillStyle = C.bg;
      g.fillRect(0, 0, o.gutter - 1, h);
      g.fillStyle = C.text;
      g.fillText('seconds', 4, 10);
      if (cueSec != null) {
        const x = o.gutter + cueSec * pps - sx;
        if (x >= o.gutter && x <= w) {
          g.strokeStyle = C.now;
          g.beginPath();
          g.moveTo(x - 4, 0.5);
          g.lineTo(x + 4, 0.5);
          g.lineTo(x, 6.5);
          g.closePath();
          g.stroke();
        }
      }
      if (nowSec != null) {
        const x = o.gutter + nowSec * pps - sx;
        if (x >= o.gutter && x <= w) {
          g.fillStyle = C.now;
          g.beginPath();
          g.moveTo(x - 4, 0);
          g.lineTo(x + 4, 0);
          g.lineTo(x, 6);
          g.fill();
          g.fillText(nowSec.toFixed(1) + 's', Math.min(x + 6, w - 34), 12);
        }
      }
    }

    let raf = 0;
    function frame() {
      if (!o.scroller.isConnected) { destroy(); return; }
      raf = root.requestAnimationFrame(frame);
      const pps = o.pxPerSec();
      const sx = o.scroller.scrollLeft;
      const total = o.totalSec();
      if (total >= 0 && cue > total) cue = total;
      let now = o.hostSec();
      if (now != null) now = fold(now);
      // Stopped: the playhead (dimmed) marks the cue, when there is one.
      const at = drag != null ? drag : now != null ? now : cue;
      const shown = now == null ? null : Math.round(now * 10) / 10;
      const cueShown = now == null && drag == null && cue > 0 ? cue : drag;
      const k = pps + '|' + sx + '|' + width + '|' + shown + '|' + cueShown;
      if (k !== key) {
        key = k;
        drawRuler(pps, sx, drag != null ? null : shown, cueShown);
      }
      updateScrub(at, total, now != null, o.seeking ? o.seeking() : null);
      if (now == null && !(cue > 0) && drag == null) {
        if (!head.hidden) head.hidden = true;
        lastHead = null;
        if (jump) { jump = false; if (o.scroller.scrollLeft > 0 && cue === 0) o.scroller.scrollLeft = 0; }
        return;
      }
      const x = o.gutter + at * pps;
      head.hidden = false;
      head.classList.toggle('is-cue', now == null || drag != null);
      head.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      // Keep the playhead on screen: when it runs past 85% of the view (or jumps behind it), put it at 15%.
      const off = x > sx + width * 0.85 || x < sx + o.gutter;
      if (jump && drag == null) {
        jump = false;
        if (off) o.scroller.scrollLeft = Math.max(0, x - width * 0.15);
      } else if (now != null && drag == null && !o.paused() && off && (lastHead == null || Math.abs(x - lastHead) < width)) {
        o.scroller.scrollLeft = Math.max(0, x - width * 0.15);
      }
      lastHead = x;
    }

    let scrubKey = '';
    function updateScrub(sec, total, playing, seeking) {
      const f = total > 0 ? Math.max(0, Math.min(1, sec / total)) : 0;
      const pct = (f * 100).toFixed(2);
      // The retail drivers only run forward, so a seek runs them ahead silently; say how far that has got.
      const text = seeking != null ? 'seeking ' + Math.round(seeking * 100) + '%' : clockLong(Math.min(sec, total > 0 ? total : sec)) + ' / ' + clockLong(Math.max(0, total));
      const k = pct + '|' + text + '|' + playing;
      if (k === scrubKey) return;
      scrubKey = k;
      fill.style.width = pct + '%';
      knob.style.left = pct + '%';
      track.classList.toggle('is-playing', playing);
      track.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      track.setAttribute('aria-valuetext', text);
      if (time.textContent !== text) time.textContent = text;
    }
    const clockLong = (s) => {
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
    };

    // --- seeking from the scrub bar and the ruler ------------------------------------------------------------
    const scrubSec = (ev) => {
      const r = rail.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) * Math.max(0, o.totalSec());
    };
    const rulerSec = (ev) => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      if (x < o.gutter) return 0;
      return Math.max(0, Math.min(Math.max(0, o.totalSec()), (x + o.scroller.scrollLeft - o.gutter) / o.pxPerSec()));
    };
    function holdToSeek(el, secOf) {
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', (ev) => {
        if (ev.button != null && ev.button > 0) return;
        ev.preventDefault();
        drag = secOf(ev);
        try { el.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic pointer */ }
        if (el.tabIndex >= 0) el.focus({ preventScroll: true });
        key = '';
      });
      el.addEventListener('pointermove', (ev) => {
        if (drag == null) return;
        drag = secOf(ev);
      });
      const release = (ev) => {
        if (drag == null) return;
        const sec = ev.type === 'pointercancel' ? null : secOf(ev);
        drag = null;
        key = '';
        if (sec != null) seekTo(sec);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    }
    holdToSeek(track, scrubSec);
    holdToSeek(canvas, rulerSec);
    canvas.style.cursor = 'pointer';
    track.addEventListener('keydown', (ev) => {
      const total = Math.max(0, o.totalSec());
      const now = o.hostSec();
      const at = now != null ? fold(now) : cue;
      const step = Math.max(0.5, total / 20);
      let to = null;
      if (ev.key === 'ArrowRight') to = at + step;
      else if (ev.key === 'ArrowLeft') to = at - step;
      else if (ev.key === 'Home') to = 0;
      else if (ev.key === 'End') to = total;
      if (to == null) return;
      ev.preventDefault();
      ev.stopPropagation();
      seekTo(to);
    });
    raf = root.requestAnimationFrame(frame);

    function destroy() {
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
    }
    return {
      destroy,
      /** Song seconds where the next Play should start. */
      cue: () => cue,
      seekTo
    };
  }

  root.NhlEditorExtras = { attach, foldRun, seekRunTime };
})(typeof self !== 'undefined' ? self : this);
