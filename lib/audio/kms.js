/**
 * Kris' Music System (.kms) — Distinctive Software / EA PC music.
 * Header and track layout from https://www.shikadi.net/moddingwiki/Kris%27_Music_System_Format
 * (partial; notation events are best-effort until retail files are pinned).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlKms = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function u32(dv, o) { return dv.getUint32(o, true); }
  function u16(dv, o) { return dv.getUint16(o, true); }
  function str4(dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }

  /** @returns {{title:string, tracks:Array<{id:string, offset:number, data:Uint8Array}>, hdr:object|null}} */
  function parse(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 24) throw new Error('KMS too short');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var lenFile = u32(dv, 0);
    if (lenFile > u8.length) lenFile = u8.length;
    var title = '';
    for (var i = 0; i < 8; i++) {
      var c = dv.getUint8(6 + i);
      if (c) title += String.fromCharCode(c);
    }
    var lenTracks = u32(dv, 14);
    var numTracks = u16(dv, 18);
    var idBase = 20;
    var offBase = 20 + numTracks * 4;
    var trackBase = offBase + numTracks * 4;
    var ids = [];
    var offs = [];
    for (var t = 0; t < numTracks; t++) {
      ids.push(str4(dv, idBase + t * 4));
      offs.push(u32(dv, offBase + t * 4));
    }
    var tracks = [];
    var hdr = null;
    for (var k = 0; k < numTracks; k++) {
      var start = trackBase + offs[k];
      if (start + 4 > u8.length) continue;
      var lenTrack = u32(dv, start);
      var slice = u8.subarray(start, Math.min(u8.length, start + lenTrack));
      var parsed = parseTrack(slice);
      if (ids[k] === 'HDR1') hdr = parsed.songData;
      tracks.push({ id: ids[k], offset: offs[k], len: lenTrack, events: parsed.events, songData: parsed.songData });
    }
    return { lenFile: lenFile, title: title, lenTracks: lenTracks, numTracks: numTracks, tracks: tracks, hdr: hdr };
  }

  function parseTrack(trackBytes) {
    var dv = new DataView(trackBytes.buffer, trackBytes.byteOffset, trackBytes.byteLength);
    var lenTrack = u32(dv, 0);
    var p = 4;
    var events = [];
    var songData = null;
    while (p + 2 <= trackBytes.length && p < lenTrack) {
      var delay = dv.getUint8(p++);
      var ev = dv.getUint8(p++);
      var rec = { delay: delay, code: ev };
      if (ev === 0x00 && p < trackBytes.length) {
        songData = parseSongData(dv, p, trackBytes.length);
        events.push({ kind: 'song', delay: delay, data: songData });
        break;
      }
      if (ev === 0xdc && p < trackBytes.length) { rec.inst = dv.getUint8(p++); rec.kind = 'inst'; }
      else if (ev === 0xdd && p < trackBytes.length) { rec.tempo = dv.getUint8(p++); rec.kind = 'tempo'; }
      else if (ev === 0xde && p < trackBytes.length) { rec.vel = dv.getUint8(p++); rec.kind = 'volume'; }
      else if (ev >= 0x01 && ev <= 0xcf && p + 1 < trackBytes.length) {
        rec.kind = 'note';
        rec.a = dv.getUint8(p++);
        rec.b = dv.getUint8(p++);
      } else if (ev === 0xe7 && p < trackBytes.length) {
        var n = dv.getUint8(p++);
        rec.title = '';
        for (var i = 0; i < n && p < trackBytes.length; i++) rec.title += String.fromCharCode(dv.getUint8(p++));
        rec.kind = 'title';
      } else if (ev === 0xe2 && p < trackBytes.length) { rec.kind = 'loop'; rec.mark = dv.getUint8(p++); }
      else if (ev === 0xe3) { rec.kind = 'loopJump'; }
      else rec.kind = 'unknown';
      events.push(rec);
    }
    return { events: events, songData: songData };
  }

  function parseSongData(dv, p, end) {
    var numInst = dv.getUint8(p++);
    var inst = [];
    for (var i = 0; i < numInst && p + 4 <= end; i++) {
      inst.push(str4(dv, p));
      p += 4;
    }
    var numActive = dv.getUint8(p++);
    var active = [];
    for (var j = 0; j < numActive && p + 5 <= end; j++) {
      var s = '';
      for (var k = 0; k < 5; k++) s += String.fromCharCode(dv.getUint8(p++));
      active.push(s.replace(/\0.*$/, ''));
    }
    return { instruments: inst, activeTracks: active };
  }

  return { parse: parse, parseTrack: parseTrack };
});
