/**
 * NHL 94/95 PC Audio list grouping: AdLib team songs vs desk cues, and VIV
 * speech by pack then file extension (NUM, HOM, …).
 * 95 PC OpenAnnouncerBank is one pack, XBRUCE2.VIV (NUM / COR / TEA / PEN / FRM
 * rink calls, then HOM / AWA / BAR / INT / …). 94 PC also has XRBARR2.VIV.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlPcAudioGroups = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEAM_SONGS = 'Team songs';
  var MT32 = 'Songs — MT-32';
  var SONGS = 'Songs';
  /** Rink calls first (NUM / COR / TEA / PEN / FRM), then announcer roles, then city / rank. Unknown exts sort after. */
  var EXT_ORDER = ['NUM', 'COR', 'TEA', 'PEN', 'FRM', 'BRU', 'BAR', 'MSC', 'OFF', 'INT', 'HOM', 'AWA', 'CTY', 'RNK'];

  function songGroup(stem, songsLabel) {
    var s = String(stem || '').toUpperCase();
    if (/^MT/.test(s)) return MT32;
    if (/^(AD|TITLE|ROCK|SB|SLAP|CANADA|USA)/.test(s)) return songsLabel || SONGS;
    return TEAM_SONGS;
  }

  function songRank(group, songsLabel) {
    if (group === (songsLabel || SONGS)) return 0;
    if (group === TEAM_SONGS) return 1;
    if (group === MT32) return 2;
    return 3;
  }

  function sortSongs(songs, songsLabel) {
    return songs.slice().sort(function (a, b) {
      var r = songRank(a.group, songsLabel) - songRank(b.group, songsLabel);
      if (r) return r;
      return String(a.stem || a.label || '').localeCompare(String(b.stem || b.label || ''));
    });
  }

  function extOf(name) {
    var s = String(name || '');
    var i = s.lastIndexOf('.');
    return i > 0 ? s.slice(i + 1).toUpperCase() : '';
  }

  function packRank(pack) {
    var u = String(pack || '').toUpperCase();
    if (/XBRUCE/.test(u)) return 0;
    if (/XRBARR/.test(u)) return 1;
    return 2;
  }

  function extRank(ext) {
    var i = EXT_ORDER.indexOf(String(ext || '').toUpperCase());
    return i < 0 ? EXT_ORDER.length : i;
  }

  function sortSpeech(clips) {
    return clips.slice().sort(function (a, b) {
      var pr = packRank(a.group) - packRank(b.group);
      if (pr) return pr;
      var g = String(a.group || '').localeCompare(String(b.group || ''));
      if (g) return g;
      var er = extRank(a.subgroup) - extRank(b.subgroup);
      if (er) return er;
      var sg = String(a.subgroup || '').localeCompare(String(b.subgroup || ''));
      if (sg) return sg;
      return String(a.name || a.label || '').localeCompare(String(b.name || b.label || ''));
    });
  }

  function subKey(group, subgroup) {
    return String(group || '') + '\x1f' + String(subgroup || '');
  }

  return {
    TEAM_SONGS: TEAM_SONGS,
    MT32: MT32,
    SONGS: SONGS,
    EXT_ORDER: EXT_ORDER,
    songGroup: songGroup,
    songRank: songRank,
    sortSongs: sortSongs,
    extOf: extOf,
    packRank: packRank,
    extRank: extRank,
    sortSpeech: sortSpeech,
    subKey: subKey
  };
});
