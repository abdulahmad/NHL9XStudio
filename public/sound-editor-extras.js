/**
 * Sequencer editor extras shared by the NHL 92 and NHL 93/94 piano rolls: a seconds ruler above the roll and a
 * playhead line that follows the audible position while the editor's song plays (and the roll scrolls to keep it in view).
 * The playhead is a CSS-positioned element, so following the music costs no canvas redraw.
 */
(function (root) {
  'use strict';

  const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

  /**
   * @param {{ scroller: HTMLElement, inner: HTMLElement, gutter: number,
   *           pxPerSec: function(): number, totalSec: function(): number, loopSec: function(): (number|null),
   *           hostSec: function(): (number|null), paused: function(): boolean }} o
   */
  function attach(o) {
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
    const C = { bg: v('--raise-2', '#222c36'), line: v('--line', '#33414d'), text: v('--muted', '#8ea0b0'), now: v('--amber', '#f0b429') };
    const mono = v('--mono', 'ui-monospace, monospace');

    const ruler = document.createElement('div');
    ruler.className = 'se-ruler';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Seconds into the song');
    ruler.appendChild(canvas);
    o.scroller.parentNode.insertBefore(ruler, o.scroller);
    o.scroller.classList.add('has-ruler');

    const head = document.createElement('div');
    head.className = 'se-playhead';
    head.hidden = true;
    o.inner.appendChild(head);

    let width = 0;
    let key = '';
    let lastHead = null;
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

    function drawRuler(pps, sx, nowSec) {
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
      let now = o.hostSec();
      if (now != null) {
        const total = o.totalSec();
        const loop = o.loopSec();
        if (total > 0 && now > total) now = loop != null && total > loop ? loop + ((now - loop) % (total - loop)) : now % total;
      }
      const shown = now == null ? null : Math.round(now * 10) / 10;
      const k = pps + '|' + sx + '|' + width + '|' + shown;
      if (k !== key) {
        key = k;
        drawRuler(pps, sx, shown);
      }
      if (now == null) {
        if (!head.hidden) head.hidden = true;
        lastHead = null;
        return;
      }
      const x = o.gutter + now * pps;
      head.hidden = false;
      head.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      // Keep the playhead on screen: when it runs past 85% of the view (or jumps behind it), put it at 15%.
      if (!o.paused() && (x > sx + width * 0.85 || x < sx + o.gutter) && (lastHead == null || Math.abs(x - lastHead) < width)) {
        o.scroller.scrollLeft = Math.max(0, x - width * 0.15);
      }
      lastHead = x;
    }
    raf = root.requestAnimationFrame(frame);

    function destroy() {
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
    }
    return { destroy };
  }

  root.NhlEditorExtras = { attach };
})(typeof self !== 'undefined' ? self : this);
