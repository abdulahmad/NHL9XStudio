/**
 * Encoder for the NHLPA 93 / NHL 94 Genesis tile bytecode that
 * DecompressBytecode (93G decompress93.asm, 94G decompress94.asm) unpacks
 * and lib/jim.js decompressBytecode ports. The output only uses opcodes from
 * DecompressOpcodeTable and ends with $E0 $00 (ReverseMedium, distance 0).
 *
 * The game's 256-byte ring buffer is not cleared before unpacking, so a copy
 * never reaches back past the first output byte.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92JimCompress = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_DISTANCE = 255;
  const LEN_CAP = 255;

  // Copy opcodes that cost two bytes: [opcode, max distance, max count].
  // All of them take at least 3 bytes.
  const FORWARD_LONG = [
    [0x8, 255, 18],
    [0x9, 128, 34],
    [0xA, 64, 66],
    [0xB, 32, 130]
  ];
  const REVERSE_LONG = [
    [0xE, 255, 18],
    [0xF, 128, 34]
  ];

  const OP_LITERAL = 1;
  const OP_ZERO = 2;
  const OP_FILL = 3;
  const OP_SHORT = 4;
  const OP_REV_SHORT = 0xC;

  function compressBytecode(input) {
    const src = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
    const n = src.length;
    const cost = new Uint32Array(n + 1);
    const op = new Uint8Array(n);
    const len = new Uint8Array(n);
    const dist = new Uint8Array(n);

    // fwd[d] = how many bytes from p match the bytes d back (copy walks up).
    // rev[e] = how many bytes from p match walking down from p - e. Reverse
    // step i reads p - e - i while writing p + i, so the gap grows by 2 a
    // byte; rev at p + 1 is indexed by e + 2. Capped at 255 so the source
    // stays inside the ring.
    let fwd = new Uint8Array(MAX_DISTANCE + 1);
    let fwdNext = new Uint8Array(MAX_DISTANCE + 1);
    let rev = new Uint8Array(MAX_DISTANCE + 3);
    let revNext = new Uint8Array(MAX_DISTANCE + 3);
    let zeroRun = 0;
    let sameRun = 0;

    for (let p = n - 1; p >= 0; p--) {
      const b = src[p];
      zeroRun = b === 0 ? zeroRun + 1 : 0;
      sameRun = p + 1 < n && src[p + 1] === b ? sameRun + 1 : 1;

      let tmp = fwd; fwd = fwdNext; fwdNext = tmp;
      tmp = rev; rev = revNext; revNext = tmp;
      const reach = Math.min(p, MAX_DISTANCE);
      for (let d = 1; d <= MAX_DISTANCE; d++) {
        if (d <= reach && src[p - d] === b) {
          fwd[d] = Math.min(fwdNext[d] + 1, LEN_CAP);
          rev[d] = Math.min(revNext[d + 2] + 1, LEN_CAP);
        } else {
          fwd[d] = 0;
          rev[d] = 0;
        }
      }

      let best = Infinity;
      let bestOp = 0;
      let bestLen = 0;
      let bestDist = 0;
      const remain = n - p;
      function consider(c, k, o, d) {
        const total = c + cost[p + k];
        if (total < best) {
          best = total;
          bestOp = o;
          bestLen = k;
          bestDist = d;
        }
      }

      for (let k = 1, top = Math.min(32, remain); k <= top; k++) consider(1 + k, k, OP_LITERAL, 0);
      for (let k = 1, top = Math.min(16, zeroRun); k <= top; k++) consider(1, k, OP_ZERO, 0);
      for (let k = 3, top = Math.min(18, sameRun); k <= top; k++) consider(2, k, OP_FILL, 0);

      // One-byte copies: forward $40-$7F and reverse $C0-$DF, distance 1-8.
      let shortFwdLen = 0, shortFwdDist = 0, shortRevLen = 0, shortRevDist = 0;
      for (let d = 1; d <= 8; d++) {
        if (fwd[d] > shortFwdLen) { shortFwdLen = fwd[d]; shortFwdDist = d; }
        if (rev[d] > shortRevLen) { shortRevLen = rev[d]; shortRevDist = d; }
      }
      for (let k = 2, top = Math.min(9, shortFwdLen); k <= top; k++) consider(1, k, OP_SHORT, shortFwdDist);
      for (let k = 2, top = Math.min(5, shortRevLen); k <= top; k++) consider(1, k, OP_REV_SHORT, shortRevDist);

      for (const [code, maxDist, maxCount] of FORWARD_LONG) {
        let bl = 0, bd = 0;
        for (let d = 1; d <= maxDist; d++) if (fwd[d] > bl) { bl = fwd[d]; bd = d; }
        for (let k = 3, top = Math.min(maxCount, bl); k <= top; k++) consider(2, k, code, bd);
      }
      for (const [code, maxDist, maxCount] of REVERSE_LONG) {
        let bl = 0, bd = 0;
        for (let d = 1; d <= maxDist; d++) if (rev[d] > bl) { bl = rev[d]; bd = d; }
        for (let k = 3, top = Math.min(maxCount, bl); k <= top; k++) consider(2, k, code, bd);
      }

      cost[p] = best;
      op[p] = bestOp;
      len[p] = bestLen;
      dist[p] = bestDist;
    }

    const out = [];
    for (let p = 0; p < n; p += len[p]) {
      const k = len[p];
      const d = dist[p];
      switch (op[p]) {
        case OP_LITERAL:
          out.push(k - 1);
          for (let i = 0; i < k; i++) out.push(src[p + i]);
          break;
        case OP_ZERO:
          out.push(0x20 | (k - 1));
          break;
        case OP_FILL:
          out.push(0x30 | (k - 3), src[p]);
          break;
        case OP_SHORT:
          out.push(0x40 | ((d - 1) << 3) | (k - 2));
          break;
        case OP_REV_SHORT:
          out.push(0xC0 | ((d - 1) << 2) | (k - 2));
          break;
        case 0x8:
        case 0xE:
          out.push((op[p] << 4) | (k - 3), d);
          break;
        case 0x9:
        case 0xF:
          out.push((op[p] << 4) | ((k - 3) >> 1), (((k - 3) & 1) << 7) | (d - 1));
          break;
        case 0xA:
          out.push(0xA0 | ((k - 3) >> 2), (((k - 3) & 3) << 6) | (d - 1));
          break;
        case 0xB:
          out.push(0xB0 | ((k - 3) >> 3), (((k - 3) & 7) << 5) | (d - 1));
          break;
        default:
          throw new Error('compressBytecode: no encoding at byte ' + p);
      }
    }
    out.push(0xE0, 0x00);
    return Uint8Array.from(out);
  }

  return { compressBytecode };
});
