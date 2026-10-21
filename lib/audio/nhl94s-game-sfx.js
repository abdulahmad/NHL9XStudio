/**
 * NHL '94 (SNES) puck and collision effect helpers ported from NHL94SNES PuckSfx.asm and CollisionSfx.asm
 * (reference only). Used by the Sound test to audition retail routing (velocity loudness and random pitch).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlNhl94sGameSfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var s8 = function (v) { return (v << 24) >> 24; };
  var s16 = function (v) { return (v << 16) >> 16; };

  /** Mul8S: signed 8-bit multiply (PuckSfx velocity term). */
  function mul8S(a, b) {
    return (s8(a) * s8(b)) & 0xffff;
  }

  /** ApproxLength: Euclidean length of (x, y) using 8-bit high bytes (CollisionSfx). */
  function approxLength(x, y) {
    var hx = s8((x >> 8) & 0xff);
    var hy = s8((y >> 8) & 0xff);
    var ax = hx < 0 ? -hx : hx;
    var ay = hy < 0 ? -hy : hy;
    var m = ax > ay ? ax : ay;
    var n = ax > ay ? ay : ax;
    return (m + (n >> 1)) & 0xff;
  }

  /** PuckSfx / sfx: loudness from puck velocity halves in p0/p0+2, capped at $70. */
  function sfxVelocityFromHalfVxVy(vxHalf, vyHalf) {
    var sx = s16(vxHalf);
    var sy = s16(vyHalf);
    var termX = mul8S((sx >> 8) & 0xff, (sx >> 8) & 0xff);
    var termY = mul8S((sy >> 8) & 0xff, (sy >> 8) & 0xff);
    var v = ((termX + termY) >> 3) & 0xffff;
    if (v >= 0x70) v = 0x70;
    return v;
  }

  /** Instrument pitch word (+2) scaled by random $C0-$FF (PuckSfx). */
  function puckPitch(inst, seed) {
    var base = inst[2] | (inst[3] << 8);
    var factor = 0xc0 + (seed & 0x3f);
    return Math.floor((base * factor) / 256) & 0xffff;
  }

  /**
   * Play sound `n` like PuckSfx: vx/vy are puck velocities (16-bit), halved inside.
   * Returns the voice from playSound, after setting pitch on a just-started voice.
   */
  function puckSfx(player, n, vx, vy, seed) {
    seed = seed == null ? 0x1234 : seed >>> 0;
    var vxHalf = s16(vx) >> 1;
    var vyHalf = s16(vy) >> 1;
    var vel = sfxVelocityFromHalfVxVy(vxHalf, vyHalf);
    var inst = player.soundTable && player.soundTable[n];
    if (!inst) throw new Error('no sound ' + n);
    var pitch = puckPitch(inst, seed);
    var v = player.playSound(n, { velocity: vel, pitch: pitch, recordPitch: pitch });
    return { voice: v, velocity: vel, pitch: pitch, seed: seed & 0x3f };
  }

  /** Play collision sound $0F like CollisionSfx from two player velocities. */
  function collisionSfx(player, vxA, vyA, vxB, vyB, seed) {
    var lenA = approxLength(vxA, vyA);
    var lenB = approxLength(vxB, vyB);
    var vx;
    var vy;
    if (lenA >= lenB) { vx = vxA; vy = vyA; } else { vx = vxB; vy = vyB; }
    return puckSfx(player, 0x0f, s16(vx) << 1, s16(vy) << 1, seed);
  }

  return { approxLength: approxLength, sfxVelocityFromHalfVxVy: sfxVelocityFromHalfVxVy, puckPitch: puckPitch, puckSfx: puckSfx, collisionSfx: collisionSfx };
});
