/**
 * NHL 95 PC pictures (and NHL 96 PC SHPI .FSH / locatebig VIV).
 *
 * QFS files are EA RefPack (the 10 FB / 11 FB form unpacked by sub_97CE0
 * in NHL95PC). NHL 95 PPV files and QFS payloads are SHPI shape banks;
 * NHL 96 PC locateshape loads the same SHPI bank as a .FSH (also .vsh / .qvs).
 * GAMEART.VIV and siblings are locatebig unit files: C0 FB (type 1) or
 * BI/BIGF (type 2), not 94/95 speech VIV.
 * NHL 94 PPV / QPP is a Mode X planar PackBits bank (see pc94-shape.js),
 * packed as Huffman 30 FB or BTree 46 FB (pc94-pack.js) — not SHPI and not
 * RefPack. Bytes inside a 95 QFS may be SHPI after RefPack.
 * banks. On this PC game the size, count, and offsets are little-endian
 * dwords, which is how sub_B30B4 reads them, even though the magic is
 * SHPI. Each entry is a SPIT picture. Type 123 is raw pixels. Anything
 * else is the ILBM-style run already decoded by SPIT-To-BMP.
 *
 * Player and goalie sprites use the createPal from PAL-To-ACT: rink
 * colors, the 64 team colors, the mapping bytes at team offset 320,
 * then createjerseyShadowfixed for indexes 0–143. Static sprites
 * (referee, puck, the F*.PPV crowd) use the game palette instead,
 * which is rinkpal plus those team colors and rinkpal's last five
 * colors. The blitter skips index 255, and index 0 is equipment black.
 *
 * SPIT bytes 8 and 10 are the console 0, 0 point (DrawSprite subtracts
 * them from the world position). GetHot reads HotList in HOCKEY.EXE;
 * its Y is stored with the opposite sign of the Genesis hotspot.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nhl95Pc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FRAME_COUNT = 1134;
  const FRAME_COUNT_94 = 876;
  const FRAME_COUNT_96 = 0;
  const PIC_EXT = /\.(qfs|qpp|ppv|spit|shp|vsh|fsh|qvs)$/i;
  const TEAM_BYTES = 448;
  const BUNDLE_MAGIC = [0x50, 0x39, 0x35, 0x42];

  const TEAMS = [
    { code: 'bos', city: 'Boston' },
    { code: 'buf', city: 'Buffalo' },
    { code: 'cgy', city: 'Calgary' },
    { code: 'chi', city: 'Chicago' },
    { code: 'det', city: 'Detroit' },
    { code: 'edm', city: 'Edmonton' },
    { code: 'hfd', city: 'Hartford' },
    { code: 'la', city: 'Los Angeles' },
    { code: 'min', city: 'Minnesota' },
    { code: 'mtl', city: 'Montreal' },
    { code: 'nj', city: 'New Jersey' },
    { code: 'nyi', city: 'Long Island' },
    { code: 'nyr', city: 'New York' },
    { code: 'ott', city: 'Ottawa' },
    { code: 'phi', city: 'Philadelphia' },
    { code: 'pit', city: 'Pittsburgh' },
    { code: 'que', city: 'Quebec' },
    { code: 'stl', city: 'St. Louis' },
    { code: 'sj', city: 'San Jose' },
    { code: 'tb', city: 'Tampa Bay' },
    { code: 'tor', city: 'Toronto' },
    { code: 'van', city: 'Vancouver' },
    { code: 'wsh', city: 'Washington' },
    { code: 'wpg', city: 'Winnipeg' },
    { code: 'ana', city: 'Anaheim' },
    { code: 'fla', city: 'Florida' },
    { code: 'asw', city: 'All-Star West' },
    { code: 'ase', city: 'All-Star East' }
  ];

  // NHL 96 PC team .FSH names in HOCKEY.EXE (DAL not MIN; no all-star sheets).
  const TEAMS_96 = [
    { code: 'ana', city: 'Anaheim' },
    { code: 'bos', city: 'Boston' },
    { code: 'buf', city: 'Buffalo' },
    { code: 'cgy', city: 'Calgary' },
    { code: 'chi', city: 'Chicago' },
    { code: 'dal', city: 'Dallas' },
    { code: 'det', city: 'Detroit' },
    { code: 'edm', city: 'Edmonton' },
    { code: 'fla', city: 'Florida' },
    { code: 'hfd', city: 'Hartford' },
    { code: 'la', city: 'Los Angeles' },
    { code: 'mtl', city: 'Montreal' },
    { code: 'nj', city: 'New Jersey' },
    { code: 'nyi', city: 'Long Island' },
    { code: 'nyr', city: 'New York' },
    { code: 'ott', city: 'Ottawa' },
    { code: 'phi', city: 'Philadelphia' },
    { code: 'pit', city: 'Pittsburgh' },
    { code: 'que', city: 'Quebec' },
    { code: 'sj', city: 'San Jose' },
    { code: 'stl', city: 'St. Louis' },
    { code: 'tb', city: 'Tampa Bay' },
    { code: 'tor', city: 'Toronto' },
    { code: 'van', city: 'Vancouver' },
    { code: 'wsh', city: 'Washington' },
    { code: 'wpg', city: 'Winnipeg' }
  ];

  const LABELS = {
    ARENA: ['Arena', 'Screens'],
    SRLOGO: ['EA Sports logo', 'Screens'],
    CREDITS: ['Credits background', 'Screens'],
    CTBKGD: ['City background', 'Screens'],
    CTLOGO: ['City logo', 'Screens'],
    CITY: ['City', 'Screens'],
    CTTITLE: ['City title', 'Screens'],
    CTTITLE1: ['City title 2', 'Screens'],
    CTTITLE2: ['City title 3', 'Screens'],
    CTTITLE3: ['City title 4', 'Screens'],
    PSTATBAR: ['Player stat bar', 'Screens'],
    DB_BUT: ['Dialog buttons', 'Screens'],
    DIALOGBX: ['Dialog box', 'Screens'],
    EXHGAME2: ['Exhibition', 'Screens'],
    PLAQUE: ['Plaque', 'Screens'],
    PLAYOFFS: ['Playoffs', 'Screens'],
    SETTING: ['Settings', 'Screens'],
    SETTINGS: ['Settings', 'Screens'],
    EMBPAL: ['Team emblems', 'Screens'],
    RINK: ['Ice rink', 'Ice'],
    RINKPAL: ['Rink palette', 'Ice'],
    SUMMARY: ['Summary', 'Screens'],
    SUMMARY2: ['Summary', 'Screens'],
    HOMEPAL3: ['Home jersey colors', 'Other'],
    AWAYPAL3: ['Away jersey colors', 'Other'],
    NUMSHP: ['Number shapes', 'Fonts'],
    SCRBRD1: ['Scoreboard', 'Screens'],
    SCRBRD2: ['Scoreboard 2', 'Screens'],
    TRINKND: ['Rink end', 'Ice'],
    F000149: ['Rink and crowd', 'Ice'],
    CALENDAR: ['Calendar', 'Screens'],
    HILIGHT: ['Highlight font', 'Fonts'],
    CLAP: ['Clap', 'Ice'],
    GOAL: ['Goal light', 'Ice'],
    HOOK: ['Hook', 'Ice'],
    SIREN: ['Siren', 'Ice'],
    RUFF: ['Ruff', 'Ice'],
    FANOM: ['Fan', 'Ice'],
    CROSS: ['Cross', 'Ice'],
    CFLAG: ['Canadian flag', 'Ice'],
    UFLAG: ['US flag', 'Ice'],
    SAVED: ['Saved', 'Screens'],
    CRESTS4: ['Crests', 'Logos'],
    GADGET5: ['Gadget', 'Screens'],
    GADGET6: ['Gadget replay', 'Screens'],
    POINTER3: ['Pointer', 'Screens'],
    LOAD: ['Loading', 'Screens'],
    LOCKROOM: ['Locker room', 'Screens'],
    PLAYER: ['Player card', 'Screens'],
    LELOGO: ['League logos', 'Logos'],
    CALLOGO: ['Calendar logos', 'Logos'],
    OPEN_BUT: ['Open buttons', 'Screens'],
    JOYCAL: ['Joystick calibration', 'Screens'],
    SAVEGAME: ['Save game', 'Screens'],
    SOUND: ['Sound', 'Screens'],
    PALETTE: ['Palette', 'Other'],
    EASN: ['EA Sports Net', 'Screens'],
    EASCRN: ['EA screen', 'Screens'],
    EASCRN1: ['EA screen 2', 'Screens'],
    EAOPEN: ['EA open', 'Screens'],
    EADESK: ['EA desk', 'Screens'],
    EADESK0: ['EA desk', 'Screens'],
    EADESK1: ['EA desk 2', 'Screens'],
    EADESK2: ['EA desk 3', 'Screens'],
    EASNDESK: ['EA Sports desk', 'Screens'],
    LOCKRM: ['Locker room', 'Screens'],
    TITLE2: ['Title', 'Screens'],
    LINEDITP: ['Line editor', 'Screens'],
    MISC: ['Misc', 'Other'],
    AWARDS: ['Awards', 'Screens'],
    SCOREBRD: ['Scoreboard', 'Jumbotron'],
    FLAG: ['Jumbotron flag', 'Jumbotron'],
    TROPHIES: ['Trophies', 'Screens'],
    TROPBACK: ['Awards backdrop', 'Screens'],
    STOPCHI: ['Chicago ice logo', 'Logos'],
    STOPDET: ['Detroit ice logo', 'Logos'],
    STOPMTL: ['Montreal ice logo', 'Logos'],
    STOPVAN: ['Vancouver ice logo', 'Logos'],
    TSPAL: ['Title palette', 'Other'],
    TPAL: ['Team palette', 'Other'],
    EDBPAL: ['Editor palette', 'Other'],
    SCRBRD: ['Scoreboard', 'Jumbotron'],
    ICE: ['Ice rink', 'Ice'],
    RINKPAL: ['Rink palette', 'Ice'],
    MAINMENU: ['Main menu', 'Screens'],
    CONTROL: ['Controls', 'Screens'],
    EXMAIN: ['Exhibition', 'Screens'],
    HIMANG: ['Himang', 'Screens'],
    LOADPO: ['Load playoffs', 'Screens'],
    RULES: ['Rules', 'Screens'],
    OPTIONS: ['Options', 'Screens'],
    JOYSTICK: ['Joystick', 'Screens'],
    DETAILS: ['Details', 'Screens'],
    CONNECT: ['Connect', 'Screens'],
    DISCONN: ['Disconnect', 'Screens'],
    EXSETUP: ['Exhibition setup', 'Screens'],
    MODSETUP: ['Modem setup', 'Screens'],
    MODCONF: ['Modem config', 'Screens'],
    LEGNEW: ['New league', 'Screens'],
    'SEAS-SC1': ['Season', 'Screens'],
    'SEAS-SC3': ['Season 3', 'Screens'],
    LEGSTAND: ['Standings', 'Screens'],
    PAUSELO: ['Pause', 'Screens'],
    PAUSEHI: ['Pause (hi)', 'Screens'],
    CALBUTT: ['Calendar buttons', 'Screens'],
    PNT: ['Pointer', 'Screens'],
    TNAMES: ['Team names', 'Screens'],
    REPLOW: ['Replay', 'Screens'],
    REPHIGH: ['Replay (hi)', 'Screens'],
    SCOUT: ['Scouting', 'Screens'],
    LINEUPF: ['Lineup forward', 'Screens'],
    LINEUPD: ['Lineup defense', 'Screens'],
    GOALIES: ['Goalies', 'Screens'],
    '3STARS': ['Three stars', 'Screens'],
    TITLE: ['Title', 'Screens'],
    INTRO: ['Intro', 'Screens'],
    PROFILE: ['Profile', 'Screens'],
    FRONT: ['Front', 'Screens'],
    POPUP: ['Popup', 'Screens'],
    GAMESTA1: ['Game stats', 'Screens'],
    GAMESTA2: ['Game stats 2', 'Screens'],
    STATSTND: ['Stats standings', 'Screens'],
    STATCMN: ['Stats common', 'Screens'],
    NHLPASTA: ['NHLPA stats', 'Screens'],
    CLOCK: ['Clock', 'Screens'],
    ROSTER: ['Roster', 'Screens'],
    PLAYSTAT: ['Player stats', 'Screens'],
    LINECMN: ['Line common', 'Screens'],
    USERLOG: ['User logos', 'Logos'],
    PLAYCOMP: ['Player compare', 'Screens'],
    NEWPLAY: ['New player', 'Screens'],
    'FREE-AG2': ['Free agents', 'Screens'],
    STANPLY3: ['Stanley play', 'Screens'],
    ROSTCOMP: ['Roster compare', 'Screens'],
    TRADE: ['Trade', 'Screens'],
    CALDER: ['Calder', 'Trophies'],
    EAAWR: ['EA awards', 'Trophies'],
    HART: ['Hart', 'Trophies'],
    JENNING: ['Jennings', 'Trophies'],
    NORRIS: ['Norris', 'Trophies'],
    ROSS: ['Ross', 'Trophies'],
    SELKE: ['Selke', 'Trophies'],
    SMYTHE: ['Smythe', 'Trophies'],
    VEZINA: ['Vezina', 'Trophies'],
    CAMPBELL: ['Campbell', 'Trophies'],
    PRESID: ['Presidents', 'Trophies'],
    STANLEY: ['Stanley Cup', 'Trophies'],
    WALES: ['Wales', 'Trophies'],
    CREDITS: ['Credits', 'Screens'],
    CRDT: ['Credits', 'Screens'],
    PAL: ['Palette', 'Other'],
    OLDSHP: ['Old shapes', 'Other'],
    NEWPAL: ['New palette', 'Other']
  };

  // Event clips and the scoreboard. They share one sidebar group.
  const JUMBOTRON = {
    CLAP: 1, CROSS: 1, CFLAG: 1, UFLAG: 1, FANOM: 1, GOAL: 1, GUILT: 1, HOOK: 1,
    RUFF: 1, SAVED: 1, SIREN: 1, SCRBRD1: 1, SCRBRD2: 1, FLAG: 1, SCOREBRD: 1
  };

  const SEQUENCE_LABELS = {
    CREDIT: ['Credits', 'Screens'],
    PORTR: ['Portraits', 'Screens'],
    EADESK: ['EA desk', 'Screens'],
    SETTING: ['Settings', 'Screens'],
    PIONEER: ['Pioneer', 'Screens'],
    EASCRN: ['EA screen', 'Screens'],
    SCRBRD: ['Scoreboard', 'Jumbotron'],
    CTTITLE: ['City titles', 'Screens'],
    CALND: ['Calendar', 'Screens'],
    LINES: ['Lines', 'Screens']
  };

  const CITY_CODES = {
    ANA: 'Anaheim', ASE: 'All-Star East', ASW: 'All-Star West', BOS: 'Boston', BUF: 'Buffalo',
    CGY: 'Calgary', CHI: 'Chicago', DAL: 'Dallas', DET: 'Detroit', EAS: 'EA Sports',
    EDM: 'Edmonton', FLA: 'Florida', HFD: 'Hartford', LA: 'Los Angeles', MIN: 'Minnesota',
    MTL: 'Montreal', NHL: 'NHL', NJ: 'New Jersey', NYI: 'Long Island', NYR: 'New York',
    OTT: 'Ottawa', PHI: 'Philadelphia', PIT: 'Pittsburgh', QUE: 'Quebec', SCUP: 'Stanley Cup',
    SJ: 'San Jose', STL: 'St. Louis', TB: 'Tampa Bay', TOR: 'Toronto', VAN: 'Vancouver',
    WES: 'West', WPG: 'Winnipeg', WSH: 'Washington'
  };

  // Pictures whose colors live in a different QFS. From QFS-To-BMP.
  const PAL_DONOR = {
    SRLOGO: 'ARENA',
    CTLOGO: 'CTBKGD',
    // TonightsGameScreen and the summary screens load ctbkgd "!pal" before these shapes.
    CTTITLE: 'CTBKGD',
    CTTITLE1: 'CTBKGD',
    CTTITLE2: 'CTBKGD',
    CTTITLE3: 'CTBKGD',
    // DrawCreatePlayer copies prez2 "!pal" before the stat bar.
    PSTATBAR: 'PREZ2',
    DIALOGBX: 'DB_BUT',
    EXHGAME2: 'DB_BUT',
    PLAQUE: 'DB_BUT',
    PLAYOFFS: 'DB_BUT',
    SETTING: 'DB_BUT',
    SETTINGS: 'DB_BUT',
    RINK: 'RINKPAL',
    SUMMARY2: 'SUMMARY'
  };
  for (let i = 0; i < 20; i++) PAL_DONOR['CREDIT' + (i < 10 ? '0' : '') + i] = 'CREDITS';
  for (let i = 2; i <= 7; i++) PAL_DONOR['SETTING' + i] = 'DB_BUT';

  // NHL 94 PC QPP banks that borrow another file's !pal (QPP94-To-PNG).
  const PAL_DONOR_94 = {
    EMBNHL: 'TSPAL',
    PLAYOFFS: 'EMBPAL',
    EMBSCUP: 'EMBPAL',
    SAVEGAME: 'EASNDESK',
    SETTING3: 'EASNDESK',
    SETTING4: 'EASNDESK',
    SETTING5: 'EASNDESK',
    SETTING6: 'EASNDESK',
    SETTING7: 'EASNDESK',
    SOUND: 'EASNDESK',
    EXHGAME2: 'LOCKRM',
    SUMMARY2: 'SUMMARY',
    SUMMARY3: 'SUMMARY',
    RINK: 'RINKPAL',
    NUMSHP: 'RINKPAL',
    SCOREBRD: 'RINKPAL',
    TRINKND: 'RINKPAL',
    CFLAG: 'FLAG',
    CLAP: 'FLAG',
    FANOM: 'FLAG',
    GOAL: 'FLAG',
    UFLAG: 'FLAG'
  };

  // NHL 96 PC: locateshape loads rinkpal.qfs "!pal" (sub_B3420, 32 RGB colors
  // at +16, 6-bit×4). ICE.FSH has no embedded pal — it borrows that bank.
  // Do not assign rinkpal (or any other bank) as a global 96 fallback: that
  // recolors art that already had a working !pal. Targeted donors only.
  const PAL_DONOR_96 = {
    ICE: 'RINKPAL',
    RINK: 'RINKPAL'
  };

  // newpal.qfs locateshape tags (HOCKEY.EXE off_11BB4C): home then away per team.
  const NEWPAL_TAGS = {
    ANA: ['!anh', '!ana'], BOS: ['!bsh', '!bsa'], BUF: ['!bfh', '!bfa'],
    CGY: ['!cgh', '!cga'], CHI: ['!chh', '!cha'], DAL: ['!dlh', '!dla'],
    DET: ['!dth', '!dta'], EDM: ['!edh', '!eda'], FLA: ['!flh', '!fla'],
    HFD: ['!hrh', '!hra'], LA: ['!lah', '!laa'], MTL: ['!mth', '!mta'],
    NJ: ['!njh', '!nja'], NYI: ['!ilh', '!ila'], NYR: ['!rgh', '!rga'],
    OTT: ['!oth', '!ota'], PHI: ['!phh', '!pha'], PIT: ['!pth', '!pta'],
    QUE: ['!quh', '!qua'], STL: ['!slh', '!sla'], SJ: ['!sjh', '!sja'],
    TB: ['!tbh', '!tba'], TOR: ['!trh', '!tra'], VAN: ['!vnh', '!vna'],
    WSH: ['!wsh', '!wsa'], WPG: ['!wnh', '!wna'], ASW: ['!asw'], ASE: ['!ase']
  };

  function bytesOf(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
  }

  function u16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function s16(bytes, offset) {
    return (u16(bytes, offset) << 16) >> 16;
  }

  function be16(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function be24(bytes, offset) {
    return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  }

  function be32(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  // NHL96PC locatebig (sub_C6090): first two bytes BE. C0 FB = type 1, "BI" = type 2.
  const ART_VIV = /^(GAMEART|ARENAART|AWARDS|BASEFILE|CALENDAR|CMNBASE|CMNMIN|DONRUSS|EDITLINE|GAMESTAT|ICELOGO|INTRO|MINIMUM|OPTIMUM|PROFILES|RECOMEND|STATBGND)\.VIV$/i;

  function locatebigKind(bytes) {
    if (!bytes || bytes.length < 6) return 0;
    const mag = be16(bytes, 0);
    if (mag === 0xC0FB) return 1;
    if (mag === 0x4249) return 2;
    return 0;
  }

  function readCString(bytes, offset, max) {
    let name = '';
    let p = offset;
    const lim = max == null ? 64 : max;
    while (p < bytes.length && bytes[p] && name.length < lim) {
      name += String.fromCharCode(bytes[p]);
      p += 1;
    }
    if (p >= bytes.length || bytes[p] !== 0) return null;
    return { name: name, next: p + 1 };
  }

  function isRefPack(bytes) {
    // 10/11 FB — NHL 95 QFS (sub_97CE0 RefPack). 30 FB is Huffman, not RefPack.
    return bytes && bytes.length >= 5 && bytes[1] === 0xFB && (bytes[0] & 0xFE) === 0x10;
  }

  function isEaHuffPack(bytes) {
    return bytes && bytes.length >= 5 && bytes[0] === 0x30 && bytes[1] === 0xFB;
  }

  function snesPak() {
    if (typeof require === 'function') {
      try {
        return require('./snespak');
      } catch (err) {
        return null;
      }
    }
    return typeof Nhl92SnesPak !== 'undefined' ? Nhl92SnesPak : null;
  }

  function pc94Pack() {
    if (typeof require === 'function') {
      try {
        return require('./pc94-pack');
      } catch (err) {
        return null;
      }
    }
    return typeof NhlPc94Pack !== 'undefined' ? NhlPc94Pack : null;
  }

  function pc94Shape() {
    if (typeof require === 'function') {
      try {
        return require('./pc94-shape');
      } catch (err) {
        return null;
      }
    }
    return typeof NhlPc94Shape !== 'undefined' ? NhlPc94Shape : null;
  }

  function pcRink() {
    if (typeof require === 'function') {
      try {
        return require('./pc-rink');
      } catch (err) {
        return null;
      }
    }
    return typeof NhlPcRink !== 'undefined' ? NhlPcRink : null;
  }

  function decompressEaContainer(buffer) {
    const bytes = bytesOf(buffer);
    if (isRefPack(bytes)) return decompressRefPack(bytes);
    const pack = pc94Pack();
    if (pack && pack.isPacked(bytes)) {
      try {
        return pack.unpack(bytes).data;
      } catch (err) {
        return null;
      }
    }
    if (bytes.length >= 5 && bytes[1] === 0xfb) {
      const pak = snesPak();
      if (!pak || !pak.unpack94) return null;
      try {
        return pak.unpack94(bytes, 0);
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  function isShapeMagic(bytes) {
    if (!bytes || bytes.length < 16) return false;
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    return magic === 'SHPP' || magic === 'SHPS' || magic === 'SHPI' || magic === 'SHPM';
  }

  function isBundle(bytes) {
    return bytes && bytes.length >= 8 &&
      bytes[0] === BUNDLE_MAGIC[0] && bytes[1] === BUNDLE_MAGIC[1] &&
      bytes[2] === BUNDLE_MAGIC[2] && bytes[3] === BUNDLE_MAGIC[3];
  }

  /**
   * RefPack as sub_97CE0 runs it. Flags 0x10 omit the compressed size;
   * flags 0x11 store a 3-byte compressed size before the 3-byte
   * decompressed size. Both sizes are big-endian.
   */
  function decompressRefPack(buffer) {
    const bytes = bytesOf(buffer);
    if (!isRefPack(bytes)) return null;
    let p = 2;
    if (bytes[0] & 1) p += 3;
    if (p + 3 > bytes.length) return null;
    const size = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
    p += 3;
    if (size <= 0 || size > 32 * 1024 * 1024) return null;
    const out = new Uint8Array(size);
    let w = 0;

    function copyLit(n) {
      if (n < 0 || p + n > bytes.length || w + n > size) return false;
      out.set(bytes.subarray(p, p + n), w);
      p += n;
      w += n;
      return true;
    }

    function copyRef(offset, length) {
      if (offset <= 0 || offset > w || length < 0 || w + length > size) return false;
      for (let i = 0; i < length; i++) out[w + i] = out[w - offset + i];
      w += length;
      return true;
    }

    while (w < size && p < bytes.length) {
      const b0 = bytes[p++];
      const lit2 = b0 & 3;
      if ((b0 & 0x80) === 0) {
        if (p >= bytes.length) break;
        const b1 = bytes[p++];
        if (lit2 && !copyLit(lit2)) break;
        if (!copyRef(((b0 & 0x60) << 3) + b1 + 1, ((b0 & 0x1C) >> 2) + 3)) break;
      } else if ((b0 & 0x40) === 0) {
        if (p + 1 >= bytes.length) break;
        const b1 = bytes[p++];
        const b2 = bytes[p++];
        const lits = b1 >> 6;
        if (lits && !copyLit(lits)) break;
        if (!copyRef(((b1 & 0x3F) << 8) + b2 + 1, (b0 & 0x3F) + 4)) break;
      } else if ((b0 & 0x20) === 0) {
        if (p + 2 >= bytes.length) break;
        const b1 = bytes[p++];
        const b2 = bytes[p++];
        const b3 = bytes[p++];
        if (lit2 && !copyLit(lit2)) break;
        const offset = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1;
        const length = ((b0 & 0x0C) << 6) + b3 + 5;
        if (!copyRef(offset, length)) break;
      } else if (b0 < 0xFC) {
        if (!copyLit(((b0 & 0x1F) + 1) * 4)) break;
      } else {
        if (lit2) copyLit(lit2);
        break;
      }
    }
    return out;
  }

  function decodeSpit(buffer) {
    const bytes = bytesOf(buffer);
    if (bytes.length < 16) return null;
    const type = bytes[0];
    let width;
    let height;
    let xOffset;
    let yOffset;
    let xPos;
    let yPos;
    if (type === 5) {
      width = bytes[2] | (bytes[3] << 8);
      height = bytes[6] | (bytes[7] << 8);
      if (width <= 0 || height <= 0 || width > 2048 || height > 2048) {
        width = bytes[4] | (bytes[5] << 8);
        height = bytes[8] | (bytes[9] << 8);
      }
      xOffset = s16(bytes, 10);
      yOffset = s16(bytes, 12);
      xPos = s16(bytes, 14);
      yPos = bytes.length >= 18 ? s16(bytes, 16) : 0;
    } else {
      width = s16(bytes, 4);
      height = s16(bytes, 6);
      xOffset = s16(bytes, 8);
      yOffset = s16(bytes, 10);
      xPos = s16(bytes, 12);
      yPos = s16(bytes, 14);
    }
    if (width <= 0 || height <= 0 || width > 2048 || height > 2048) return null;
    const count = width * height;
    if (count > 4000000) return null;
    const rawType = type === 123;
    if (rawType && bytes.length < 16 + count) return null;
    const pixels = new Uint8Array(count);
    let index = 16;
    let raw = 0;
    while (raw < count) {
      let description;
      if (rawType) {
        description = 1;
      } else {
        if (index >= bytes.length) break;
        description = bytes[index++];
      }
      if (description === 0) break;
      if (description >= 128) {
        const writeLen = 255 - description + 1;
        if (index + writeLen > bytes.length) break;
        for (let i = 0; i < writeLen && raw < count; i++) pixels[raw++] = bytes[index++];
      } else {
        if (index >= bytes.length) break;
        const color = bytes[index++];
        for (let i = 0; i < description && raw < count; i++) pixels[raw++] = color;
      }
    }
    if (!rawType && raw === 0) return null;
    if (!rawType && type === 5 && raw < count * 0.2) return null;
    return {
      type,
      width,
      height,
      xOffset,
      yOffset,
      xPos,
      yPos,
      pixels
    };
  }

  function tagAt(bytes, offset) {
    let text = '';
    for (let i = 0; i < 4; i++) {
      const c = bytes[offset + i];
      if (!c) break;
      text += String.fromCharCode(c);
    }
    return text;
  }

  function numericTag(tag) {
    const text = String(tag || '').trim();
    if (!/^\d{1,4}$/.test(text)) return null;
    return parseInt(text, 10);
  }

  function shapeIsLittle(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function plausible(little) {
      const size = view.getUint32(4, little);
      const count = view.getUint32(8, little);
      if (count <= 0 || count > 10000) return false;
      if (16 + count * 8 > bytes.length) return false;
      return size === bytes.length || (size > 16 && size <= bytes.length);
    }
    const le = plausible(true);
    const be = plausible(false);
    if (le && !be) return true;
    if (be && !le) return false;
    if (le && be) {
      if (view.getUint32(4, true) === bytes.length) return true;
      if (view.getUint32(4, false) === bytes.length) return false;
    }
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    return magic === 'SHPP' || magic === 'SHPS';
  }

  /**
   * NHL 94 PC .PPV (and some 94 QPP payloads): gfxpak C0FB-style pack —
   * u32 totalSize, u16 shape count, 4-digit ASCII tags, u32 offsets into
   * a trailing blob of SPIT pictures (not SHPI-in-file like NHL 95).
   */
  function isGfxPakPack(bytes) {
    if (!bytes || bytes.length < 12) return false;
    if (isShapeMagic(bytes) || isRefPack(bytes) || isBundle(bytes)) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(4, true);
    if (count < 1 || count > 500) return false;
    const pTags = 6;
    const pOff = pTags + count * 4;
    const dataStart = pOff + count * 4;
    if (dataStart > bytes.length) return false;
    for (let i = 0; i < count; i++) {
      const tag = tagAt(bytes, pTags + i * 4);
      if (!/^\d{4}$/.test(tag)) return false;
    }
    let prev = -1;
    for (let i = 0; i < count; i++) {
      const off = view.getUint32(pOff + i * 4, true);
      if (off < prev) return false;
      prev = off;
    }
    const dataBytes = bytes.length - dataStart;
    if (dataBytes < 16) return false;
    const lastOff = view.getUint32(pOff + (count - 1) * 4, true);
    if (lastOff >= dataBytes) return false;
    const end0 = count > 1 ? view.getUint32(pOff + 4, true) : dataBytes;
    const slice = bytes.subarray(dataStart, dataStart + Math.min(end0, dataBytes));
    if (decodeSpit(slice)) return true;
    return true;
  }

  function spitFromBlob(slice) {
    let best = null;
    const direct = decodeSpit(slice);
    if (direct && direct.width <= 512 && direct.height <= 512) best = direct;
    const max = Math.min(slice.length, 2048);
    for (let off = 0; off < max - 16; off++) {
      const spit = decodeSpit(slice.subarray(off));
      if (!spit || spit.width < 4 || spit.height < 4 || spit.width > 512 || spit.height > 512) continue;
      if (spit.pixels.length !== spit.width * spit.height) continue;
      if (Math.abs(spit.xPos) > 512 || Math.abs(spit.yPos) > 512) continue;
      if (!best || spit.width * spit.height < best.width * best.height) best = spit;
    }
    return best;
  }

  function findEmbeddedPalette(bytes) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 512)));
    const match = /!pal[a-z0-9]*/i.exec(text);
    if (!match) return null;
    const start = text.indexOf(match[0]);
    let off = start + match[0].length;
    while (off < bytes.length && bytes[off] === 0) off += 1;
    off = (off + 15) & ~15;
    for (let tryAt = off; tryAt < Math.min(bytes.length, off + 64); tryAt += 4) {
      const pal = decodeEaPalette(bytes.subarray(tryAt));
      if (pal) return pal;
    }
    return null;
  }

  function openPc94Bank(bytes) {
    const shape = pc94Shape();
    if (!shape || !shape.isBank(bytes)) return null;
    try {
      return shape.openBank(bytes);
    } catch (err) {
      return null;
    }
  }

  function openDecompressedPcPicture(bytes) {
    if (isShapeMagic(bytes)) return parseShapeBank(bytes);
    const planar = openPc94Bank(bytes);
    if (planar) return planar;
    if (isGfxPakPack(bytes)) return parseGfxPakPack(bytes);
    if (isBundle(bytes)) {
      const files = decodeBundle(bytes);
      if (!files) return null;
      const shapes = [];
      let palette = null;
      for (const file of files) {
        const base = file.name.split(/[\\/]/).pop();
        if (base.charAt(0) === '!') {
          palette = palette || decodeEaPalette(file.data);
          continue;
        }
        const opened = openDecompressedPcPicture(file.data);
        if (!opened) continue;
        if (opened.palette && !palette) palette = opened.palette;
        shapes.push.apply(shapes, opened.shapes);
      }
      return shapes.length ? { shapes, palette } : null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length >= 6 && view.getUint16(0, true) === 0xfd36) {
      const palette = findEmbeddedPalette(bytes);
      const shapes = [];
      for (let off = 0; off < Math.min(bytes.length, 120000) - 16; off++) {
        const spit = decodeSpit(bytes.subarray(off));
        if (!spit || spit.width < 16 || spit.height < 16) continue;
        if (spit.pixels.length !== spit.width * spit.height) continue;
        shapes.push(spit);
        break;
      }
      if (shapes.length) return { shapes, palette };
    }
    const spit = decodeSpit(bytes);
    if (spit) return { shapes: [spit], palette: null };
    return null;
  }

  function parseGfxPakPack(buffer) {
    const bytes = bytesOf(buffer);
    if (!isGfxPakPack(bytes)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(4, true);
    const pTags = 6;
    const pOff = pTags + count * 4;
    const dataStart = pOff + count * 4;
    const dataBytes = bytes.length - dataStart;
    const shapes = [];
    for (let i = 0; i < count; i++) {
      const tag = tagAt(bytes, pTags + i * 4);
      const start = view.getUint32(pOff + i * 4, true);
      const end = i + 1 < count ? view.getUint32(pOff + (i + 1) * 4, true) : dataBytes;
      const from = dataStart + start;
      const to = dataStart + end;
      let spit = spitFromBlob(bytes.subarray(from, to));
      if (!spit && from > 0) spit = spitFromBlob(bytes.subarray(Math.max(0, from - 32), to));
      if (!spit) continue;
      spit.tag = tag;
      shapes.push(spit);
    }
    return { shapes, palette: null };
  }

  function parseShapeBank(buffer) {
    const bytes = bytesOf(buffer);
    if (!isShapeMagic(bytes)) return null;
    const little = shapeIsLittle(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(8, little);
    if (count <= 0 || count > 20000) return null;
    if (16 + count * 8 > bytes.length) return null;
    const shapes = [];
    const palettes = {};
    let palette = null;
    let paletteRank = 0;
    for (let i = 0; i < count; i++) {
      const entry = 16 + i * 8;
      const tag = tagAt(bytes, entry);
      const offset = view.getUint32(entry + 4, little);
      if (offset <= 0 || offset >= bytes.length) continue;
      const slice = bytes.subarray(offset);
      // Only ! / pal* tags are palettes. Treating every 0x22/0x24 shape as a
      // palette (PR 192) skipped banner / logo pictures and overrode working
      // pal* banks. Targeted files pick extra palettes below via palettes[tag].
      if (isPaletteTag(tag)) {
        const decoded = decodeEaPalette(slice);
        if (decoded) {
          palettes[tag] = decoded;
          const rank = tag === '!pal' ? 3 : (tag.charAt(0) === '!' ? 2 : 1);
          if (rank >= paletteRank) {
            palette = decoded;
            paletteRank = rank;
          }
        }
        continue;
      }
      const spit = decodeSpit(slice);
      if (!spit) continue;
      spit.tag = tag;
      shapes.push(spit);
    }
    return { shapes, palette, palettes };
  }

  function decodeBundle(buffer) {
    const bytes = bytesOf(buffer);
    if (!isBundle(bytes)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(4, true);
    if (count < 0 || count > 20000) return null;
    const files = [];
    let p = 8;
    for (let i = 0; i < count; i++) {
      if (p + 8 > bytes.length) return null;
      const nameLen = view.getUint32(p, true);
      const dataLen = view.getUint32(p + 4, true);
      p += 8;
      if (nameLen < 0 || dataLen < 0 || p + nameLen + dataLen > bytes.length) return null;
      const name = new TextDecoder().decode(bytes.subarray(p, p + nameLen));
      p += nameLen;
      const data = bytes.subarray(p, p + dataLen);
      p += dataLen;
      files.push({ name, data });
    }
    return files;
  }

  function encodeBundle(files) {
    const encoded = files.map((file) => ({
      name: new TextEncoder().encode(file.name),
      data: bytesOf(file.data)
    }));
    let size = 8;
    for (const file of encoded) size += 8 + file.name.length + file.data.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out.set(BUNDLE_MAGIC, 0);
    view.setUint32(4, encoded.length, true);
    let p = 8;
    for (const file of encoded) {
      view.setUint32(p, file.name.length, true);
      view.setUint32(p + 4, file.data.length, true);
      p += 8;
      out.set(file.name, p);
      p += file.name.length;
      out.set(file.data, p);
      p += file.data.length;
    }
    return out;
  }

  /**
   * locatebig type 1: C0 FB unit file (NHL96PC sub_C611B). Directory runs
   * from +6 to +4+be16(+2). Each slot is u24be offset, u24be size, name\\0.
   */
  function parseUnitC0fb(buffer) {
    const bytes = bytesOf(buffer);
    if (locatebigKind(bytes) !== 1) return null;
    const end = 4 + be16(bytes, 2);
    if (end <= 6 || end > bytes.length) return null;
    const files = [];
    let p = 6;
    while (p + 7 <= bytes.length && p < end) {
      const off = be24(bytes, p);
      const size = be24(bytes, p + 3);
      const nm = readCString(bytes, p + 6, 64);
      if (!nm) break;
      p = nm.next;
      if (!nm.name || off >= bytes.length || size <= 0) continue;
      const sliceEnd = Math.min(bytes.length, off + size);
      if (sliceEnd <= off) continue;
      files.push({ name: nm.name, data: bytes.subarray(off, sliceEnd) });
    }
    return files.length ? files : null;
  }

  /**
   * locatebig type 2: "BI…" archive (BIGF). Directory from +0x10 to be32(+0xC).
   * Each slot is u32be offset, u32be size, name\\0 (sub_C61AD).
   */
  function parseBigf(buffer) {
    const bytes = bytesOf(buffer);
    if (locatebigKind(bytes) !== 2 || bytes.length < 16) return null;
    const dirEnd = be32(bytes, 12);
    if (dirEnd <= 16 || dirEnd > bytes.length) return null;
    const files = [];
    let p = 16;
    while (p + 9 <= bytes.length && p < dirEnd) {
      const off = be32(bytes, p);
      const size = be32(bytes, p + 4);
      const nm = readCString(bytes, p + 8, 64);
      if (!nm) break;
      p = nm.next;
      if (!nm.name || off >= bytes.length || size <= 0) continue;
      const sliceEnd = Math.min(bytes.length, off + size);
      if (sliceEnd <= off) continue;
      files.push({ name: nm.name, data: bytes.subarray(off, sliceEnd) });
    }
    return files.length ? files : null;
  }

  /** NHL96PC locatebig: C0 FB (type 1) or BI/BIGF (type 2). */
  function parseUnit(buffer) {
    const kind = locatebigKind(bytesOf(buffer));
    if (kind === 1) return parseUnitC0fb(buffer);
    if (kind === 2) return parseBigf(buffer);
    return null;
  }

  function encodeC0fb(files) {
    const encoded = (files || []).map((file) => ({
      name: String(file.name || 'file.bin'),
      data: bytesOf(file.data)
    }));
    let dir = 6;
    for (const file of encoded) dir += 6 + file.name.length + 1;
    const dirSize = dir - 4;
    let size = dir;
    for (const file of encoded) size += file.data.length;
    const out = new Uint8Array(size);
    out[0] = 0xC0; out[1] = 0xFB;
    out[2] = (dirSize >> 8) & 0xff;
    out[3] = dirSize & 0xff;
    out[4] = (encoded.length >> 8) & 0xff;
    out[5] = encoded.length & 0xff;
    let p = 6;
    let dataAt = dir;
    for (const file of encoded) {
      out[p] = (dataAt >> 16) & 0xff;
      out[p + 1] = (dataAt >> 8) & 0xff;
      out[p + 2] = dataAt & 0xff;
      out[p + 3] = (file.data.length >> 16) & 0xff;
      out[p + 4] = (file.data.length >> 8) & 0xff;
      out[p + 5] = file.data.length & 0xff;
      p += 6;
      for (let i = 0; i < file.name.length; i++) out[p++] = file.name.charCodeAt(i);
      out[p++] = 0;
      out.set(file.data, dataAt);
      dataAt += file.data.length;
    }
    return out;
  }

  function encodeBigf(files) {
    const encoded = (files || []).map((file) => ({
      name: String(file.name || 'file.bin'),
      data: bytesOf(file.data)
    }));
    let dir = 16;
    for (const file of encoded) dir += 8 + file.name.length + 1;
    let size = dir;
    for (const file of encoded) size += file.data.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    out[0] = 0x42; out[1] = 0x49; out[2] = 0x47; out[3] = 0x46;
    view.setUint32(4, size, false);
    view.setUint32(8, encoded.length, false);
    view.setUint32(12, dir, false);
    let p = 16;
    let dataAt = dir;
    for (const file of encoded) {
      view.setUint32(p, dataAt, false);
      view.setUint32(p + 4, file.data.length, false);
      p += 8;
      for (let i = 0; i < file.name.length; i++) out[p++] = file.name.charCodeAt(i);
      out[p++] = 0;
      out.set(file.data, dataAt);
      dataAt += file.data.length;
    }
    return out;
  }

  function splitVivPath(rel) {
    const text = String(rel || '').replace(/\\/g, '/');
    const match = /^(.*\.viv)\/(.+)$/i.exec(text);
    if (!match) return null;
    return { pack: match[1], inner: match[2] };
  }

  function innerNameOf(name) {
    return fileBase(name).toLowerCase();
  }

  /** Bytes for a loose file or a locatebig inner path `GAMEART.VIV/ice.fsh`. */
  function readPacked(rel, readBytes) {
    if (!rel || typeof readBytes !== 'function') return null;
    const packed = splitVivPath(rel);
    if (packed) {
      let pack = null;
      try { pack = readBytes(packed.pack); } catch (err) { pack = null; }
      if (!pack) return null;
      const files = parseUnit(pack);
      if (!files) return null;
      const want = innerNameOf(packed.inner);
      const hit = files.find((file) => innerNameOf(file.name) === want);
      return hit ? bytesOf(hit.data) : null;
    }
    try {
      const direct = readBytes(rel);
      if (direct && direct.length) return bytesOf(direct);
    } catch (err) { /* missing file */ }
    return null;
  }

  function openBytes(buffer) {
    const bytes = bytesOf(buffer);
    if (isBundle(bytes)) {
      const files = decodeBundle(bytes);
      if (!files) return null;
      const shapes = [];
      let palette = null;
      for (const file of files) {
        const base = file.name.split(/[\\/]/).pop();
        if (base.charAt(0) === '!') {
          palette = palette || decodeEaPalette(file.data);
          continue;
        }
        const opened = openBytes(file.data);
        if (!opened) continue;
        if (opened.palette && !palette) palette = opened.palette;
        shapes.push.apply(shapes, opened.shapes);
      }
      return { shapes, palette };
    }
    if (isShapeMagic(bytes)) return parseShapeBank(bytes);
    const planar = openPc94Bank(bytes);
    if (planar) return planar;
    if (isGfxPakPack(bytes)) return parseGfxPakPack(bytes);
    if (bytes.length >= 5 && bytes[1] === 0xfb) {
      const raw = decompressEaContainer(bytes);
      if (!raw) return null;
      const opened = openDecompressedPcPicture(raw);
      if (opened) return opened;
      return openBytes(raw);
    }
    const opened = openDecompressedPcPicture(bytes);
    if (opened) return opened;
    const spit = decodeSpit(bytes);
    if (spit) return { shapes: [spit], palette: null };
    return null;
  }

  function grayscale() {
    const colors = [];
    for (let i = 0; i < 256; i++) colors.push([i, i, i]);
    return colors;
  }

  function decodeAct(buffer) {
    const bytes = bytesOf(buffer);
    const colors = [];
    const count = Math.min(256, Math.floor(bytes.length / 3));
    for (let i = 0; i < count; i++) {
      colors.push([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]]);
    }
    while (colors.length < 256) colors.push([0, 0, 0]);
    return colors;
  }

  // SHPI palette shapes (locateshape / FSH): 0x22 = 24-bit RGB, 0x24 = 16-bit
  // 1555. Width at +2 is the color count; pixels start at +16. rinkpal.qfs
  // passes ebx=0x20 (32 colors) into sub_B3420, then sub_B3458 shl 2 (6-bit).
  const PALETTE_TYPES = { 0x22: 'rgb', 0x24: 'rgb16', 0x29: 'rgb16', 0x2A: 'rgb16', 0x2D: 'rgb' };

  function isPaletteType(type) {
    return Object.prototype.hasOwnProperty.call(PALETTE_TYPES, type);
  }

  function isPaletteTag(tag) {
    const text = String(tag || '');
    return text.charAt(0) === '!' || /^pal/i.test(text);
  }

  function shapeColorCount(bytes, elemSize) {
    if (bytes.length < 16 + elemSize) return 0;
    const w = bytes[2] | (bytes[3] << 8);
    const h = bytes[6] | (bytes[7] << 8);
    if (w >= 1 && w <= 256 && (h === 0 || h === 1) && 16 + w * elemSize <= bytes.length) return w;
    return Math.min(256, Math.floor((bytes.length - 16) / elemSize));
  }

  function decodePaletteRgb16(bytes) {
    const count = shapeColorCount(bytes, 2);
    if (count < 1) return null;
    const colors = [];
    for (let i = 0; i < count; i++) {
      const w = bytes[16 + i * 2] | (bytes[16 + i * 2 + 1] << 8);
      colors.push([((w >> 10) & 31) * 8, ((w >> 5) & 31) * 8, (w & 31) * 8]);
    }
    while (colors.length < 256) colors.push([0, 0, 0]);
    return colors;
  }

  function decodeEaPalette(buffer) {
    const bytes = bytesOf(buffer);
    if (bytes.length < 19) return null;
    const kind = PALETTE_TYPES[bytes[0]] || 'rgb';
    if (kind === 'rgb16') return decodePaletteRgb16(bytes);
    const count = shapeColorCount(bytes, 3);
    if (count < 1) return null;
    let max = 0;
    const raw = [];
    for (let i = 0; i < count; i++) {
      const rgb = [bytes[16 + i * 3], bytes[16 + i * 3 + 1], bytes[16 + i * 3 + 2]];
      if (rgb[0] > max) max = rgb[0];
      if (rgb[1] > max) max = rgb[1];
      if (rgb[2] > max) max = rgb[2];
      raw.push(rgb);
    }
    const mul = max <= 63 ? 4 : 1;
    const colors = raw.map((rgb) => [rgb[0] * mul, rgb[1] * mul, rgb[2] * mul]);
    while (colors.length < 256) colors.push([0, 0, 0]);
    return colors;
  }

  function decodeRinkFile(buffer) {
    const bytes = bytesOf(buffer);
    if (bytes.length === 768 || (bytes.length % 3 === 0 && bytes.length <= 768 && bytes.length >= 384)) {
      return decodeAct(bytes);
    }
    return decodeEaPalette(bytes);
  }

  function colorsToAct(colors) {
    const out = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      const rgb = colors[i] || [0, 0, 0];
      out[i * 3] = rgb[0];
      out[i * 3 + 1] = rgb[1];
      out[i * 3 + 2] = rgb[2];
    }
    return out;
  }

  const ACTS = {};
  // HotList at HOCKEY.EXE file offset 0x11339C. Pairs are signed X, then
  // Y with the opposite sign of the Genesis hotspot. 814 entries.
  const HOT_B64 = '/BT/GP4c/xkBGRAIFwoTCBULDgQR/RX9Ff4V/RL9DvoR8hH2E/UR9gLwAewE8QTsAOz4+vP18vTv8vH08/3s//L98f7z/fII8QfyB/EI8wkBDQELAQwADAENCwYMBwwGCgYKBxEAFv4W/xT/Ev8L9A3yDPUK9Av1APMB8QH0APIC9Pf19/b29/P29fbwAO8B7wDw/vL+9wr0CPYG9wX2BvoFDgUUABL6Cfrw9egE6gcBBw8JFv0O+/756vrqBvIO+gz6DPoM+gz6DPoMDgwODA4MDgwODA4ME/4T/hP+E/4T/hP+D/kP+Q/5D/kP+Q/5CPII8gjyBvUI8gjy9vT29Pb09vT29Pb08Pnv+e/57/nv+e/57gTuBO4E7gTuBO4E/xP/ExAHEAcRAREBC/gL+Pr4+vjx+fH59AX0BfUJ9Qn+E/YQ/RAREg4LBgoY/xgEEgML+A/9Dvz89wL3CPju/PL6+PrnAu7/8QHrDfEJ8gIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwKAg0TAxAGEvgS+Qn2CvTy9/j17v/x/PMD7gL4B/cJ/gUGBQcCBPn/9/f99P/2Be8B9gUZ/hT6CfP49On88PnvBPcIGwUd/g7yAvDq++n88QoTCh4IHfgI9eT54/7oCOsA8QEPCAwCEQAC+PT58vv4GPYcEwcXDRr6IfoU8yDzCfAH5u/35u/i/Nz/6QjoCwAADPkC4Q8NAAAF/ezmDP4M/AL94AUG+P38+fvmE//4AAAAAAEZ8vvxA/77EhjwB+4C+/0fAQME9wgD/RzsAgcCFPYV9Rj4EgwLERYSHxIPGfwi/ikHHQMR+BvvH/AT7v3y/t8E3ALh5/bl6+Tr6+vg/tn81/vl+vEE5AzkD+wQDAQQAQ35CPny/OwA7wH5Cw0HEwEZ+w31+fXs+e0A8QYAAAYCBwAHAAcABwAHAQcBBwEHAQcBBwEHAQcBBwH3AuoB4AToBOgE6AToBOgE6ATs+v0C/wDj/gL7Av79/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBQr/8wUFAwn79wkIAvz5CBEJ/ff7Cf4C+vUACf/7+fUJBvX3//oJ+Pf3AwkI8vz+BggNCwgXBBP/E/kO/f/1A/Xv+PD26/vt/+ED9QXxEQsBEgMI/w78+P369vn98f7zAPMH+QAOD/8A7Qb+AfgKBwASDAkAFv8F9wn1+P3s+w0I9/sRAPUEDfn3DP72CgL2/wwA8AAM/vYEBfgEDfn6/ggBBwcDAQATAQ4AEwQQARH9DfwR/BD+AfcD9wb3B/b28/fz9/b18+z27vbo9+r36f3o/ej+6gLwBvEH8QXzBfUJ/RgIDwsUDwEXBQn+EvYA+ALt9Pju9PL/4wT7CvIR+ADy/wf+C/7/Cf8IEQIRAwwADQEO/Aj8A/sD+e338fbv/u//9QT1BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD5BQYD/wMHAAUDBf4GAv3+B//8AAH8+gL5//sC+QH8BQAjBBoPBggLDwERCQ/8EAX/+AX98/vv/+3/6wruDPQRAAoACQALCAkICQgIDAINAw0DCvoK+gr7APUB9gH29fr1+vX69AH0AewB9AjyB/MIAwIDAgMCBgL9/f39/f39/QL9Av0C/QL9Av4B/uby5vLm8uby5vLm8vEB7wQM//wABP8Q/xECFwESABH+Ev0F/fr/8f/tAOsBJgcAABj/IP7+Cf8LDQUXARb+F/0G+xP8AvsE9O794/rp/eb99P/lAPQD9AQABgcAEQALAg/9EQIV/Az+BvUB/PL88/vs/usA3wHzAfMB8AIC/QL8//77/vD98fz1AQ7+Ef/1BfgEAfwA//3+9QHy/PH8+wH1Ae4DC/78AfUBCPsM/Q7+CPwMBwkCAwAKABIGDv4ZAyUEBQEEAQX/DgMUAh34EP0O/P/1Bvvy/dz+9P/nAtwF9/7uBOQF8wDwC+0FAP4F/yABIwIh/iv7BfkF7Nz85fLkAeYC2BPeEPcE5xEYBg4M5gHeAPAC8AwJCRwTHw8iEBQCEwQb/xTy+ff58ef+3fr8A/4C+QP/AwkABgQLAAsAEP0A/gD8//4F/gP9Afz9/P78/vz6AfgD/AH+/v7+/v4=';

  function paletteToolsRoot() {
    const path = require('path');
    const fs = require('fs');
    if (process.env.EA_NHL_TOOLS_ROOT) {
      return path.join(path.resolve(process.env.EA_NHL_TOOLS_ROOT), 'PAL-To-ACT');
    }
    const bundled = path.join(__dirname, '..', 'test', 'fixtures', 'PAL-To-ACT');
    if (fs.existsSync(bundled)) return bundled;
    const oneUp = path.join(__dirname, '..', 'PAL-To-ACT');
    if (fs.existsSync(oneUp)) return oneUp;
    return path.join(__dirname, '..', '..', 'PAL-To-ACT');
  }

  function actColors(name) {
    if (Object.prototype.hasOwnProperty.call(ACTS, name)) return ACTS[name];
    ACTS[name] = null;
    if (typeof require !== 'function') return null;
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(paletteToolsRoot(), name);
      if (!fs.existsSync(file)) return null;
      ACTS[name] = decodeAct(fs.readFileSync(file));
      return ACTS[name];
    } catch (err) {
      return null;
    }
  }

  function padColors(colors) {
    const out = [];
    for (let i = 0; i < 256; i++) {
      if (colors && colors[i]) out.push(colors[i].slice());
      else out.push([0, 0, 0]);
    }
    return out;
  }

  // mergePal.js: the first palette keeps its head, and a rink palette
  // also keeps its last five colors (indexes 251–255).
  function mergeColors(first, second, colorsFromFirst, keepTail) {
    const end = keepTail ? 251 : 256;
    const out = [];
    for (let i = 0; i < 256; i++) {
      const source = i < colorsFromFirst || i >= end ? first : second;
      out.push((source[i] || [0, 0, 0]).slice());
    }
    return out;
  }

  function hotTable() {
    if (hotTable.bytes) return hotTable.bytes;
    let bytes;
    if (typeof Buffer !== 'undefined') bytes = new Uint8Array(Buffer.from(HOT_B64, 'base64'));
    else {
      const bin = atob(HOT_B64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    hotTable.bytes = bytes;
    return bytes;
  }

  function signedByte(value) {
    return value > 127 ? value - 256 : value;
  }

  // GetHot in engine_core.asm. The frame number is the 0-based PC index.
  function hotspotFor(index) {
    let frame = index;
    if (frame < 0 || frame >= 0x468) return { x: 0, y: 0 };
    if (frame >= 0x378) frame -= 0xF4;
    else if (frame > 0x283) return { x: 0, y: 0 };
    if (frame >= 0x2DA) frame -= 0x46;
    else if (frame > 0x293) return { x: 0, y: 0 };
    const table = hotTable();
    const at = frame * 2;
    if (at + 1 >= table.length) return { x: 0, y: 0 };
    return { x: signedByte(table[at]), y: -signedByte(table[at + 1]) };
  }

  // Arrows, the puck, nets, the goal light, glass, and the referee use
  // the game palette. Player and goalie poses use createPal.
  // 94 PC has no GetHot HotList in the 244 KB EXE; puck/origin marks come
  // from the planar bank's hotX/hotY (shape header +4/+6). Dynamic ranges
  // follow frames94pc.asm SPF groups (876 frames, not 95's 1134).
  function frameIsDynamic(frame, gameId) {
    if (frame >= 353 && frame <= 357) return false;
    if (frame >= 384 && frame <= 406) return false;
    if (frame >= 555 && frame <= 568) return false;
    if (frame >= 645 && frame <= 872) return false;
    if (gameId === 'nhl94pc') return true;
    if (frame >= 1129 && frame <= 1134) return false;
    return true;
  }

  function playerFrameCount(gameId) {
    if (gameId === 'nhl94pc') return FRAME_COUNT_94;
    if (gameId === 'nhl96pc') return FRAME_COUNT_96;
    return FRAME_COUNT;
  }

  function buildTeamPalette(teamBlock, rinkColors) {
    const bytes = bytesOf(teamBlock);
    if (bytes.length < TEAM_BYTES) return null;
    const team = padColors(null);
    for (let i = 0; i < 64; i++) {
      team[128 + i] = [bytes[i * 3] * 4, bytes[i * 3 + 1] * 4, bytes[i * 3 + 2] * 4];
    }
    const map = new Uint8Array(256);
    for (let i = 0; i < 128; i++) map[128 + i] = bytes[320 + i];
    const fallback = padColors(rinkColors);
    const rinkPlain = actColors('rinkpal.act') || fallback;
    const rinkFixed = actColors('rinkpalShadowfixed.act') || fallback;
    const jersey = actColors('createjerseyShadowfixed.act');
    const game = mergeColors(rinkPlain, team, 128, true);
    const gameFixed = mergeColors(rinkFixed, team, 128, true);
    const mapped = [];
    for (let i = 0; i < 256; i++) mapped.push((gameFixed[map[i]] || [0, 0, 0]).slice());
    let sprite = mapped;
    if (jersey) {
      const edit = [];
      for (let i = 0; i < 256; i++) edit.push((i >= 251 ? jersey[i] : mapped[i]).slice());
      sprite = mergeColors(jersey, edit, 144, false);
    }
    sprite.game = game;
    return sprite;
  }

  /** teampal.qda (NHL96PC sub_61E53): dword offset table, then int8 count, count×RGB, 256-byte map. */
  function looksLikeQda(buffer) {
    const bytes = bytesOf(buffer);
    if (bytes.length < 16) return false;
    const first = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (first < 8 || first % 4 !== 0 || first >= bytes.length) return false;
    const n = first / 4;
    return n >= 8 && n <= 64;
  }

  function paletteFromQda(buffer, index, rinkColors) {
    const bytes = bytesOf(buffer);
    if (!looksLikeQda(bytes) || index < 0) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(0, true) / 4;
    if (index >= n) return null;
    const off = view.getUint32(index * 4, true);
    if (off >= bytes.length) return null;
    const count = (bytes[off] << 24) >> 24;
    if (count <= 0 || count > 64) return null;
    const rgbAt = off + 1;
    const mapAt = rgbAt + count * 3;
    if (mapAt > bytes.length) return null;
    let max = 0;
    const team = padColors(null);
    for (let i = 0; i < count; i++) {
      const r = bytes[rgbAt + i * 3];
      const g = bytes[rgbAt + i * 3 + 1];
      const b = bytes[rgbAt + i * 3 + 2];
      if (r > max) max = r;
      if (g > max) max = g;
      if (b > max) max = b;
      team[128 + i] = [r, g, b];
    }
    const mul = max <= 63 ? 4 : 1;
    for (let i = 0; i < count; i++) {
      team[128 + i] = [team[128 + i][0] * mul, team[128 + i][1] * mul, team[128 + i][2] * mul];
    }
    const map = new Uint8Array(256);
    for (let i = 0; i < 256; i++) map[i] = i;
    if (mapAt + 256 <= bytes.length) {
      for (let i = 0; i < 256; i++) map[i] = bytes[mapAt + i];
    }
    const fallback = padColors(rinkColors);
    const rinkPlain = (rinkColors && rinkColors.length) ? fallback : (actColors('rinkpal.act') || fallback);
    const game = mergeColors(rinkPlain, team, 128, true);
    const mapped = [];
    for (let i = 0; i < 256; i++) mapped.push((game[map[i]] || team[map[i]] || [0, 0, 0]).slice());
    mapped.game = game;
    return mapped;
  }

  function teamPaletteColors(name, bin, rinkColors) {
    const parsed = parseTeamFile(name);
    if (!parsed || !bin) return null;
    const bytes = bytesOf(bin);
    if (looksLikeQda(bytes)) {
      const qdaIndex = TEAMS_96.findIndex((team) => team.code === parsed.code);
      if (qdaIndex < 0) return null;
      return paletteFromQda(bytes, qdaIndex, rinkColors);
    }
    const start = parsed.index * TEAM_BYTES;
    if (start + TEAM_BYTES > bytes.length) return null;
    return buildTeamPalette(bytes.subarray(start, start + TEAM_BYTES), rinkColors);
  }

  function emptyFrame(frame) {
    return {
      frame,
      index: frame - 1,
      width: 0,
      height: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      minX: 0,
      minY: 0,
      hotspotX: 0,
      hotspotY: 0,
      hotspotPxX: 0,
      hotspotPxY: 0,
      pixels: new Uint8Array(0),
      numSprites: 0,
      sprites: [],
      picture: false,
      opaque: false
    };
  }

  function numOr(v, fallback) {
    return v != null ? v : fallback;
  }

  function pictureHot(shape) {
    if (shape.hotX != null || shape.hotY != null) return { x: numOr(shape.hotX, 0), y: numOr(shape.hotY, 0) };
    return { x: numOr(shape.xOffset, 0), y: numOr(shape.yOffset, 0) };
  }

  function shapeToFrame(shape, frame, picture, kind, gameId) {
    const minX = picture ? 0 : -numOr(shape.xOffset, 0);
    const minY = picture ? 0 : -numOr(shape.yOffset, 0);
    const hot = kind === 'rink'
      ? { x: 0, y: 0 }
      : picture
        ? pictureHot(shape)
        : (gameId === 'nhl94pc' && shape.hotX != null
          ? { x: shape.hotX, y: shape.hotY }
          : hotspotFor(frame - 1));
    const out = {
      frame,
      index: frame - 1,
      width: shape.width,
      height: shape.height,
      canvasWidth: shape.width,
      canvasHeight: shape.height,
      minX,
      minY,
      hotspotX: hot.x,
      hotspotY: hot.y,
      hotspotPxX: hot.x - minX,
      hotspotPxY: hot.y - minY,
      pixels: shape.pixels,
      numSprites: picture ? 0 : 1,
      sprites: [],
      picture,
      opaque: Boolean(picture),
      transparent: picture ? 0 : 255,
      dynamic: !picture && kind !== 'rink' && frameIsDynamic(frame, gameId),
      tag: shape.tag || ''
    };
    if (shape.type != null) out.type = shape.type;
    if (shape.xOffset != null) out.xOffset = shape.xOffset;
    if (shape.yOffset != null) out.yOffset = shape.yOffset;
    if (shape.xPos != null) out.xPos = shape.xPos;
    if (shape.yPos != null) out.yPos = shape.yPos;
    if (shape.hotX != null) out.hotX = shape.hotX;
    if (shape.hotY != null) out.hotY = shape.hotY;
    if (shape.srcX != null) out.srcX = shape.srcX;
    if (shape.srcY != null) out.srcY = shape.srcY;
    if (shape.extra != null) out.extra = shape.extra;
    if (shape.flags != null) out.flags = shape.flags;
    if (shape.quads != null) out.quads = shape.quads;
    return out;
  }

  function numericName(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    return numericTag(base);
  }

  /**
   * Player sheets are one PPV per 50 frames: 000_049, 050_099, … 950_999,
   * then 10001049, 10501099, and 11001149 (LoadPlayerPhotos). Rink and
   * crowd sheets use the same cut with an F prefix (F000_049 … F100_149),
   * and F000_149 is the wider rink-object bank DrawRinkObjects indexes.
   */
  function rangeOf(name) {
    const stem = stemOf(name).toUpperCase();
    let match = /^F(\d{3})_(\d{3})$/.exec(stem);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (end >= start) return { kind: 'rink', start, end };
    }
    match = /^(\d{3})_(\d{3})$/.exec(stem);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start % 50 === 0 && end === start + 49) return { kind: 'players', start, end };
    }
    match = /^(\d{4})(\d{4})$/.exec(stem);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start >= 1000 && start % 50 === 0 && end === start + 49) return { kind: 'players', start, end };
    }
    return null;
  }

  function tagIndex(tag) {
    const text = String(tag || '').trim();
    const prefixed = /^f(\d{1,4})$/i.exec(text);
    if (prefixed) return parseInt(prefixed[1], 10);
    return numericTag(text);
  }

  function isSpriteBank(opened, filename) {
    const range = rangeOf(filename);
    if (range) return range.kind === 'players';
    // NHL96PC sub_61F2E unpacks oldshp.qfs (RefPack SHPI) as the player sheet.
    if (/oldshp/i.test(fileBase(filename || ''))) return true;
    // PLAYER.QPP is a picture (tag dbox). `players?` would also match it.
    if (/\.(qpp|qfs|fsh|vsh|qvs)$/i.test(filename || '')) return false;
    const base = String(filename || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    return /^(sprites|sprite|players)$/i.test(base);
  }

  function isRinkBank(opened, filename) {
    const range = rangeOf(filename);
    return Boolean(range && range.kind === 'rink');
  }

  function placeShape(frames, shape, index, picture, kind, gameId) {
    if (index < 0 || index >= frames.length) return;
    frames[index] = shapeToFrame(shape, index + 1, picture, kind, gameId);
  }

  function buildSpriteBank(files, kind, gameId) {
    const list = files || [];
    let count = kind === 'rink' ? 0 : playerFrameCount(gameId);
    if (kind === 'rink' || (kind === 'players' && gameId === 'nhl96pc' && !count)) {
      for (const file of list) {
        const range = rangeOf(file.name);
        if (range) count = Math.max(count, range.end + 1);
        else if (kind === 'players') {
          const opened = openBytes(file.data);
          if (!opened) continue;
          for (const shape of opened.shapes) {
            const index = tagIndex(shape.tag);
            if (index != null) count = Math.max(count, index + 1);
          }
        }
      }
      if (!count) count = 1;
    }
    const frames = [];
    for (let i = 0; i < count; i++) frames.push(emptyFrame(i + 1));
    const ordered = list.slice().sort((a, b) => {
      const left = rangeOf(a.name);
      const right = rangeOf(b.name);
      const spanA = left ? left.end - left.start : 0;
      const spanB = right ? right.end - right.start : 0;
      return spanB - spanA;
    });
    for (const file of ordered) {
      const named = numericName(file.name);
      const range = rangeOf(file.name);
      if (kind === 'players' && range && range.start >= playerFrameCount(gameId)) continue;
      const opened = openBytes(file.data);
      if (!opened) continue;
      if (!range && opened.shapes.length === 1 && named != null) {
        placeShape(frames, opened.shapes[0], named, false, kind, gameId);
        continue;
      }
      for (let local = 0; local < opened.shapes.length; local++) {
        const shape = opened.shapes[local];
        let index = tagIndex(shape.tag);
        if (range && (index == null || index < range.start || index > range.end)) {
          index = range.start + local;
        }
        if (index == null) continue;
        placeShape(frames, shape, index, false, kind, gameId);
      }
    }
    if (kind === 'rink') {
      while (frames.length > 1 && frames[frames.length - 1].width === 0) frames.pop();
    }
    return {
      numFrames: frames.length,
      frames,
      combined: grayscale(),
      renderFrame: function (frameNumber) {
        return frames[frameNumber - 1] || null;
      }
    };
  }

  function openSpriteBundle(buffer, gameId) {
    const bytes = bytesOf(buffer);
    const files = isBundle(bytes) ? decodeBundle(bytes) : [{ name: 'sprites', data: bytes }];
    if (!files) return buildSpriteBank([], 'players', gameId);
    const rink = files.some((file) => isRinkBank(null, file.name));
    const players = files.some((file) => isSpriteBank(null, file.name) && rangeOf(file.name));
    return buildSpriteBank(files, rink && !players ? 'rink' : 'players', gameId);
  }

  function paletteFrom(buffer, tag) {
    if (!buffer) return null;
    const bytes = bytesOf(buffer);
    if (isShapeMagic(bytes) || isRefPack(bytes) || isBundle(bytes) ||
        (bytes.length >= 5 && bytes[1] === 0xfb) || (pc94Shape() && pc94Shape().isBank(bytes))) {
      const opened = openBytes(bytes);
      if (opened && opened.palettes && tag && opened.palettes[tag]) return opened.palettes[tag];
      if (opened && opened.palette) return opened.palette;
    }
    if (bytes.length === 768) return decodeAct(bytes);
    return decodeEaPalette(bytes);
  }

  function openImageParts(parts, donor, opts) {
    const options = opts || {};
    const wantTag = options.shapeTag || '';
    const palTag = options.paletteTag || '';
    const rel = options.rel || ((parts && parts[0] && parts[0].name) || '');
    const frames = [];
    const donorPal = paletteFrom(donor, palTag) || null;
    let carry = donorPal;
    for (const part of parts || []) {
      const opened = openBytes(part && part.data) || { shapes: [], palette: null, palettes: {} };
      if (opened.palette) carry = opened.palette;
      if (palTag && opened.palettes && opened.palettes[palTag]) carry = opened.palettes[palTag];
      for (const shape of opened.shapes) {
        if (wantTag && shape.tag !== wantTag) continue;
        const use = paletteFor96Shape(rel || part.name, shape.tag, opened, donorPal || carry) ||
          opened.palette || carry || grayscale();
        const frame = shapeToFrame(shape, frames.length + 1, true);
        frame.colors = use;
        frames.push(frame);
      }
    }
    const use = (frames[0] && frames[0].colors) || carry || grayscale();
    return {
      numFrames: frames.length,
      frames,
      combined: use,
      renderFrame: function (frameNumber) {
        return frames[frameNumber - 1] || null;
      }
    };
  }

  function openImage(buffer, donor) {
    return openImageParts([{ data: buffer }], donor);
  }

  /** NHL 94 PC full ice rink: RINK.TIL + RINK.MAP blit at (0, 0), LoadRink / BlitTileMap. */
  function openRinkImage(tilBytes, mapBytes, donor, game) {
    const Rink = pcRink();
    if (!Rink) {
      return { numFrames: 0, frames: [], combined: grayscale(), renderFrame: function () { return null; } };
    }
    const pic = Rink.fullPicture(tilBytes, mapBytes, game || 94);
    const colors = paletteFrom(donor) || grayscale();
    const frame = shapeToFrame({
      width: pic.width,
      height: pic.height,
      pixels: pic.pixels,
      tag: 'RINK'
    }, 1, true);
    frame.colors = colors;
    return {
      numFrames: 1,
      frames: [frame],
      combined: colors,
      renderFrame: function (frameNumber) {
        return frameNumber === 1 ? frame : null;
      }
    };
  }

  function fileBase(rel) {
    return String(rel || '').split(/[\\/]/).pop();
  }

  function findRel(files, name) {
    const want = String(name).toLowerCase();
    return (files || []).find((rel) => fileBase(rel).toLowerCase() === want) || '';
  }

  /** True when a PC install has sprites, pictures, both jersey bins, and AdLib songs.
   *  NHL 96 PC is ready on SHPI pictures plus ASF songs (no HOMEPALS / PPV sheets). */
  function installReady(catalog) {
    if (!catalog) return false;
    const audio = catalog.audio || {};
    const songs = (audio.songs || []).length > 0;
    const pictures = (catalog.images || []).length > 0;
    if (pictures && songs && !(catalog.spriteFiles || []).length) return true;
    return (catalog.spriteFiles || []).length > 0
      && pictures
      && catalog.hasHome && catalog.hasAway
      && songs;
  }

  /** 94 PC has no RINK.QFS; the full 384x592 rink is RINK.TIL + RINK.MAP. Skip when a QFS/QPP already listed. */
  function addFullRinkImage(images, files, use94) {
    if ((images || []).some((image) => /^rink\.(qfs|qpp)$/i.test(fileBase(image.id)))) return;
    const til = findRel(files, 'RINK.TIL');
    const map = findRel(files, 'RINK.MAP');
    if (!til || !map) return;
    images.push({
      id: map,
      label: 'Ice rink',
      group: 'Ice',
      kind: 'pc-rink',
      palette: '',
      files: [til, map],
      rinkGame: use94 ? 94 : 95
    });
  }

  function stemOf(rel) {
    const base = String(rel || '').split(/[\\/]/).pop();
    const cut = base.lastIndexOf('.');
    return (cut > 0 ? base.slice(0, cut) : base);
  }

  function cityOf(code) {
    return CITY_CODES[code] || code;
  }

  function imageMeta(rel) {
    const stem = stemOf(rel).toUpperCase();
    const parent = stemOf(String(rel || '').split(/[\\/]/).slice(0, -1).pop() || '').toUpperCase();
    const jersey = /^JER([A-Z]{2,4})([HV])$/.exec(stem);
    if (jersey) {
      return {
        label: cityOf(jersey[1]) + (jersey[2] === 'V' ? ' away' : ' home') + ' jersey',
        group: 'Jerseys'
      };
    }
    if (JUMBOTRON[stem]) return { label: LABELS[stem] ? LABELS[stem][0] : stemOf(rel), group: 'Jumbotron' };
    const emblem = /^EMB([A-Z]{2,4})$/.exec(stem);
    if (emblem && !/^PAL/.test(emblem[1])) {
      return { label: cityOf(emblem[1]) + ' emblem', group: 'Logos' };
    }
    if (/^EMB/.test(stem) && stem.length > 3) {
      return { label: stem.slice(3) + ' emblem', group: 'Screens' };
    }
    if (/^CREDIT\d+$/.test(stem)) {
      return { label: 'Credits ' + stem.slice(6), group: 'Screens' };
    }
    const photo = /^(\d+)_(\d+)$/.exec(stem);
    if (photo) return { label: 'Photos ' + photo[1] + '–' + photo[2], group: 'Other' };
    const known = LABELS[stem] || LABELS[parent];
    if (known && LABELS[stem]) return { label: known[0], group: known[1] };
    if (known) return { label: stemOf(rel), group: known[1] };
    if (CITY_CODES[stem]) return { label: CITY_CODES[stem], group: 'Teams' };
    return { label: stemOf(rel), group: 'Other' };
  }

  function folderOf(rel) {
    const first = String(rel || '').replace(/\\/g, '/').split('/')[0] || '';
    if (/^GERMAN$/i.test(first)) return 'GERMAN';
    return 'DATA';
  }

  function packOf(rel) {
    const parts = String(rel || '').replace(/\\/g, '/').split('/');
    const hit = parts.find((part) => /\.viv$/i.test(part));
    return hit || '';
  }

  function newpalTagFor(name, side) {
    const key = String(name || '').replace(/^!/, '').toUpperCase();
    const pair = NEWPAL_TAGS[key];
    if (!pair) return '';
    if (pair.length === 1) return pair[0];
    return side === 'away' ? pair[1] : pair[0];
  }

  function isBasefileIntro(rel) {
    return /BASEFILE\.VIV/i.test(rel || '') && /^intro\.fsh$/i.test(fileBase(rel));
  }

  function isIceLogoPack(rel) {
    return /ICELOGO\.VIV/i.test(rel || '');
  }

  function teamKeyOf(name) {
    const key = String(name || '').replace(/^!/, '').toUpperCase();
    if (CITY_CODES[key] || NEWPAL_TAGS[key]) return key;
    return '';
  }

  function isAwardsTeamLogo(rel, tag) {
    if (!/AWARDS\.VIV/i.test(rel || '')) return false;
    return Boolean(teamKeyOf(stemOf(rel)) || teamKeyOf(tag));
  }

  function isCalendarBg(tag) {
    return /^(bkgd|back|box|caln|fram|bg)$/i.test(String(tag || ''));
  }

  function calendarTeamOf(rel, tag) {
    const fromTag = teamKeyOf(tag);
    if (fromTag) return fromTag;
    const match = /CALND(\d{2})/i.exec(fileBase(rel) || '');
    if (match) {
      const team = TEAMS_96[parseInt(match[1], 10)];
      if (team) return team.code.toUpperCase();
    }
    return teamKeyOf(stemOf(rel));
  }

  function isCalendarIcon(rel, tag) {
    if (!/CALENDAR\.VIV/i.test(rel || '') && !/^CALND/i.test(stemOf(rel))) return false;
    if (isCalendarBg(tag)) return false;
    return Boolean(calendarTeamOf(rel, tag));
  }

  function isBannerShape(tag) {
    return /^[ah]\d{3,7}$/i.test(String(tag || ''));
  }

  function usesNewpal(rel, tag) {
    return isIceLogoPack(rel) || isAwardsTeamLogo(rel, tag) || isCalendarIcon(rel, tag);
  }

  function paletteFor96Shape(rel, tag, opened, fallback) {
    const pals = (opened && opened.palettes) || {};
    if (isBasefileIntro(rel)) {
      if (/^nhlp$/i.test(tag)) return pals['!pl1'] || pals['!pal'] || opened.palette || fallback;
      return pals['!pl0'] || pals['!pal'] || opened.palette || fallback;
    }
    if (usesNewpal(rel, tag) && fallback) return fallback;
    if (tag && pals[tag]) return pals[tag];
    return opened && opened.palette ? opened.palette : fallback;
  }

  function isArtViv(rel) {
    return ART_VIV.test(fileBase(rel));
  }

  function isSpeechViv(rel) {
    return /xbruce|xrbarr/i.test(fileBase(rel));
  }

  function pcYearOf(files) {
    const list = files || [];
    if (list.some((rel) => /\.qpp$/i.test(rel))) return 94;
    if (list.some((rel) => /\.(fsh|asf|vsh|qvs)$/i.test(rel) || isArtViv(rel))) return 96;
    return 95;
  }

  function parseTeamFile(name) {
    const match = /^([a-z]+)([hv])\.pal$/i.exec(String(name || ''));
    if (!match) return null;
    const code = match[1].toLowerCase();
    let index = TEAMS.findIndex((team) => team.code === code);
    if (index < 0) index = TEAMS_96.findIndex((team) => team.code === code);
    if (index < 0) return null;
    return { index, code, side: match[2].toLowerCase() === 'v' ? 'away' : 'home' };
  }

  function considerPicture(rel, data, spriteFiles, rinkFiles, loose, year, donorFiles) {
    if (!data) return;
    if (/\.viv$/i.test(rel)) {
      const inner = parseUnit(data);
      if (!inner) return;
      const parent = String(rel || '').replace(/\\/g, '/');
      for (const file of inner) {
        const base = fileBase(file.name);
        if (!PIC_EXT.test(base) && !isShapeMagic(bytesOf(file.data)) && !isRefPack(bytesOf(file.data))) continue;
        const child = parent + '/' + base;
        if (donorFiles) donorFiles.push(child);
        considerPicture(child, file.data, spriteFiles, rinkFiles, loose, year, donorFiles);
      }
      return;
    }
    if (!PIC_EXT.test(rel)) return;
    let opened = null;
    try { opened = openBytes(data); } catch (err) { opened = null; }
    const ranged = rangeOf(rel);
    if (ranged || isSpriteBank(opened, rel) || isRinkBank(opened, rel)) {
      if (!opened || !opened.shapes.length) return;
      if (ranged && ranged.kind === 'rink') rinkFiles.push(rel);
      else spriteFiles.push(rel);
      return;
    }
    if (!opened || !opened.shapes.length) return;
    if (year === 96) {
      for (const shape of opened.shapes) {
        const tag = shape.tag || '';
        if (isPaletteTag(tag)) continue;
        loose.push({ rel: rel, tag: tag, meta: imageMeta(rel) });
      }
      return;
    }
    loose.push({ rel: rel, meta: imageMeta(rel) });
  }

  function paletteNames(hasHome, hasAway, year) {
    const names = [];
    const list = year === 96 ? TEAMS_96 : TEAMS;
    for (const team of list) {
      if (hasHome) names.push(team.code + 'h.pal');
      if (hasAway) names.push(team.code + 'v.pal');
    }
    return names;
  }

  function isPaletteFile(rel) {
    if (PIC_EXT.test(rel) && !/rinkpal|pal\.fsh$|newpal/i.test(rel)) return false;
    const base = stemOf(rel);
    if (/^(homepals|awaypals|rinkpal|teampal|newpal)$/i.test(base)) return true;
    return /\.(act|pal|qda)$/i.test(rel);
  }

  function isIgnored(rel) {
    return /\.(bmp|raw|json|md|txt|js|asm)$/i.test(rel);
  }

  function isAudioFile(rel) {
    return /\.(kms|cfg|tim|dig|pat|scn|bgp|viv|iff|asf|bnk)$/i.test(rel);
  }

  function catalogAudio(files) {
    const stems = new Map();
    const tim = [];
    const pat = [];
    let dig = '';
    const extra = [];
    for (const rel of files) {
      const base = stemOf(rel).toUpperCase();
      const ext = (String(rel).split('.').pop() || '').toLowerCase();
      if (ext === 'kms' || ext === 'cfg' || ext === 'asf') {
        if (!stems.has(base)) stems.set(base, { stem: base, kms: '', cfg: '', asf: '' });
        stems.get(base)[ext === 'asf' ? 'asf' : ext] = rel;
      } else if (ext === 'tim') tim.push(rel);
      else if (ext === 'pat') pat.push(rel);
      else if (ext === 'dig' && !dig) dig = rel;
      else if (ext === 'viv' || ext === 'scn' || ext === 'bgp' || ext === 'iff' || ext === 'bnk') {
        if (ext === 'viv' && isArtViv(rel) && !isSpeechViv(rel)) continue;
        extra.push(rel);
      }
    }
    const songs = [...stems.values()].filter((s) => s.kms || s.asf).sort((a, b) => a.stem.localeCompare(b.stem));
    return { songs: songs, tim: tim.sort(), pat: pat.sort(), dig: dig, extra: extra.sort() };
  }

  function paletteDonorOf(stem, year) {
    if (year === 94) {
      if (PAL_DONOR_94[stem]) return PAL_DONOR_94[stem];
      if (/^EMB/.test(stem) && !/^EMBPAL/.test(stem)) return 'EMBPAL';
    }
    if (year === 96 && PAL_DONOR_96[stem]) return PAL_DONOR_96[stem];
    if (PAL_DONOR[stem]) return PAL_DONOR[stem];
    if (year === 96 && /^ICE/.test(stem) && !/ICELOGO/i.test(stem)) return 'RINKPAL';
    if (/^EMB/.test(stem) && !/^EMBPAL/.test(stem)) return 'EMBPAL';
    return null;
  }

  function findNamedFile(files, stem) {
    const want = String(stem || '').toUpperCase();
    return (files || []).find((rel) => stemOf(rel).toUpperCase() === want) || '';
  }

  function assignImagePalettes(images, files, year) {
    const byId = new Map(files.map((rel) => [stemOf(rel).toUpperCase(), rel]));
    const newpal = findNamedFile(files, 'NEWPAL');
    for (const image of images) {
      const fileRel = (image.files && image.files[0]) || String(image.id || '').split('#')[0];
      const dirName = fileRel.split('/').slice(0, -1).join('/');
      const sibling = files.find((rel) => {
        const parent = rel.split('/').slice(0, -1).join('/');
        return parent === dirName && stemOf(rel).charAt(0) === '!';
      });
      const stem = stemOf(fileRel).toUpperCase();
      const tag = image.shapeTag || '';
      if (year === 96 && isBasefileIntro(fileRel)) {
        image.paletteTag = /^nhlp$/i.test(tag) ? '!pl1' : '!pl0';
        continue;
      }
      if (year === 96 && usesNewpal(fileRel, tag)) {
        if (newpal) {
          image.palette = newpal;
          image.paletteTag = newpalTagFor(stem) || newpalTagFor(tag) ||
            newpalTagFor(calendarTeamOf(fileRel, tag)) || '';
        }
        continue;
      }
      if (sibling) {
        image.palette = sibling;
        continue;
      }
      const donor = paletteDonorOf(stem, year);
      if (donor && byId.has(donor)) image.palette = byId.get(donor);
    }
  }

  function pickRinkFile(files) {
    let pal = '';
    let rink = '';
    for (const rel of files) {
      const base = stemOf(rel);
      if (/^rinkpal$/i.test(base)) rink = rel;
      else if (/^pal$/i.test(base) && !pal) pal = rel;
    }
    return rink || pal;
  }

  function sequenceParts(stem) {
    const match = /^(.*\D)(\d+)$/.exec(String(stem || '').toUpperCase());
    if (!match) return null;
    return { prefix: match[1], n: parseInt(match[2], 10) };
  }

  function groupImages96(items) {
    const images = [];
    for (const item of items) {
      const tag = item.tag || '';
      const folder = folderOf(item.rel);
      const pack = packOf(item.rel);
      const stem = stemOf(item.rel);
      const known = LABELS[stem.toUpperCase()];
      const city = CITY_CODES[String(tag || stem).toUpperCase()];
      let label = tag || (known ? known[0] : stem);
      if (/^nhlp$/i.test(tag)) label = 'NHLPA · nhlp';
      else if (isBannerShape(tag) || isBannerShape(stem)) label = tag || stem;
      else if (city && tag) label = city + ' · ' + tag;
      else if (known && tag && tag.toLowerCase() !== stem.toLowerCase()) label = known[0] + ' · ' + tag;
      images.push({
        id: tag ? item.rel + '#' + tag : item.rel,
        label: label,
        group: folder,
        subgroup: pack,
        folder: folder,
        pack: pack,
        shapeTag: tag,
        kind: 'pc95',
        palette: '',
        paletteTag: '',
        files: [item.rel],
        fileNames: [fileBase(item.rel) + (tag ? ' · ' + tag : '')]
      });
    }
    images.sort((a, b) => {
      const fa = a.folder === 'GERMAN' ? 1 : 0;
      const fb = b.folder === 'GERMAN' ? 1 : 0;
      return fa - fb || String(a.pack).localeCompare(String(b.pack)) ||
        a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
    return images;
  }

  function groupImages(items, year) {
    if (year === 96) return groupImages96(items);
    const buckets = new Map();
    const bare = new Map();
    const singles = [];
    for (const item of items) {
      const stem = stemOf(item.rel).toUpperCase();
      const parts = sequenceParts(stem);
      if (!parts) {
        if (!bare.has(stem)) bare.set(stem, []);
        bare.get(stem).push(item);
        continue;
      }
      const dirName = item.rel.split('/').slice(0, -1).join('/');
      const key = dirName + '\n' + parts.prefix;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ item, n: parts.n, prefix: parts.prefix, dirName });
    }
    const images = [];
    const used = new Set();
    for (const group of buckets.values()) {
      const prefix = group[0].prefix;
      const extras = (bare.get(prefix) || []).filter((item) => {
        const dirName = item.rel.split('/').slice(0, -1).join('/');
        return dirName === group[0].dirName && !used.has(item.rel);
      });
      if (group.length + extras.length < 2) {
        singles.push(group[0].item);
        continue;
      }
      group.sort((a, b) => a.n - b.n || a.item.rel.localeCompare(b.item.rel));
      const members = extras.concat(group.map((entry) => entry.item));
      for (const item of members) used.add(item.rel);
      const known = SEQUENCE_LABELS[prefix];
      const first = members[0];
      const last = members[members.length - 1];
      images.push({
        id: first.rel,
        label: known ? known[0] : stemOf(first.rel) + '–' + stemOf(last.rel),
        group: known ? known[1] : first.meta.group,
        kind: 'pc95',
        palette: '',
        files: members.map((item) => item.rel)
      });
    }
    for (const item of singles) {
      if (used.has(item.rel)) continue;
      images.push({
        id: item.rel,
        label: item.meta.label,
        group: item.meta.group,
        kind: 'pc95',
        palette: '',
        files: [item.rel]
      });
    }
    for (const list of bare.values()) {
      for (const item of list) {
        if (used.has(item.rel)) continue;
        images.push({
          id: item.rel,
          label: item.meta.label,
          group: item.meta.group,
          kind: 'pc95',
          palette: '',
          files: [item.rel]
        });
      }
    }
    return images;
  }

  function catalogDirectory(dir) {
    const empty = {
      spriteFiles: [],
      rinkFiles: [],
      images: [],
      hasHome: false,
      hasAway: false,
      homeFile: '',
      awayFile: '',
      rinkFile: '',
      paletteNames: [],
      audio: { songs: [], tim: [], pat: [], dig: '', extra: [] }
    };
    if (!dir || typeof require !== 'function') return empty;
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(dir)) return empty;
    const files = [];

    function walk(abs, rel) {
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.charAt(0) === '.') continue;
        const childRel = rel ? rel + '/' + entry.name : entry.name;
        const childAbs = path.join(abs, entry.name);
        if (entry.isDirectory()) {
          if (/^sprites?$/i.test(entry.name)) {
            walkSprites(childAbs, childRel);
          } else {
            walk(childAbs, childRel);
          }
        } else if (entry.isFile()) {
          files.push(childRel);
        }
      }
    }

    function walkSprites(abs, rel) {
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.charAt(0) === '.') continue;
        const childRel = rel + '/' + entry.name;
        const childAbs = path.join(abs, entry.name);
        if (entry.isDirectory()) walkSprites(childAbs, childRel);
        else if (entry.isFile() && entry.name.charAt(0) !== '!') files.push(childRel);
      }
    }

    walk(dir, '');
    const spriteFiles = [];
    const rinkFiles = [];
    const loose = [];
    let hasHome = false;
    let hasAway = false;
    let homeFile = '';
    let awayFile = '';
    let rinkFile = '';
    const year = pcYearOf(files);
    const donorFiles = files.slice();
    for (const rel of files) {
      const base = stemOf(rel);
      if (/^homepals$/i.test(base) && /\.bin$/i.test(rel)) {
        hasHome = true;
        if (!homeFile) homeFile = rel;
      }
      if (/^awaypals$/i.test(base) && /\.bin$/i.test(rel)) {
        hasAway = true;
        if (!awayFile) awayFile = rel;
      }
      if (/^teampal$/i.test(base) && /\.qda$/i.test(rel)) {
        hasHome = true;
        if (!homeFile) homeFile = rel;
      }
      if (!rinkFile && /^rinkpal$/i.test(base)) rinkFile = rel;
      if (isPaletteFile(rel) || isIgnored(rel)) continue;
      const inSprites = /(^|\/)sprites?\//i.test(rel);
      if (inSprites) {
        spriteFiles.push(rel);
        continue;
      }
      if (!PIC_EXT.test(rel) && !/\.viv$/i.test(rel)) continue;
      let data = null;
      try {
        const stat = fs.statSync(path.join(dir, rel));
        if (stat.size > 32 * 1024 * 1024) continue;
        data = fs.readFileSync(path.join(dir, rel));
      } catch (err) {
        data = null;
      }
      considerPicture(rel, data, spriteFiles, rinkFiles, loose, year, donorFiles);
    }
    const images = groupImages(loose, year);
    function byRange(a, b) {
      const left = rangeOf(a);
      const right = rangeOf(b);
      const startA = left ? left.start : 0;
      const startB = right ? right.start : 0;
      return startA - startB || a.localeCompare(b);
    }
    spriteFiles.sort(byRange);
    rinkFiles.sort(byRange);
    if (year === 96 && homeFile && /\.qda$/i.test(homeFile) && !awayFile) {
      hasAway = true;
      awayFile = homeFile;
    }
    if (!rinkFile) rinkFile = pickRinkFile(donorFiles);
    addFullRinkImage(images, donorFiles, year === 94);
    assignImagePalettes(images, donorFiles, year);
    if (year !== 96) images.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    return {
      spriteFiles,
      rinkFiles,
      images,
      hasHome,
      hasAway,
      homeFile,
      awayFile,
      rinkFile,
      paletteNames: paletteNames(hasHome, hasAway, year),
      audio: catalogAudio(files)
    };
  }

  function catalogFromPaths(relativePaths, readBytes) {
    const files = (relativePaths || []).filter(Boolean).sort();
    const spriteFiles = [];
    const rinkFiles = [];
    const loose = [];
    let hasHome = false;
    let hasAway = false;
    let homeFile = '';
    let awayFile = '';
    let rinkFile = '';
    const year = pcYearOf(files);
    const donorFiles = files.slice();
    for (const rel of files) {
      const base = stemOf(rel);
      if (/^homepals$/i.test(base) && /\.bin$/i.test(rel)) {
        hasHome = true;
        if (!homeFile) homeFile = rel;
      }
      if (/^awaypals$/i.test(base) && /\.bin$/i.test(rel)) {
        hasAway = true;
        if (!awayFile) awayFile = rel;
      }
      if (/^teampal$/i.test(base) && /\.qda$/i.test(rel)) {
        hasHome = true;
        if (!homeFile) homeFile = rel;
      }
      if (!rinkFile && /^rinkpal$/i.test(base)) rinkFile = rel;
      if (isPaletteFile(rel) || isIgnored(rel)) continue;
      const inSprites = /(^|\/)sprites?\//i.test(rel);
      if (inSprites) {
        spriteFiles.push(rel);
        continue;
      }
      if (!PIC_EXT.test(rel) && !/\.viv$/i.test(rel)) continue;
      let data = null;
      try {
        data = readBytes(rel);
        if (!data || data.length > 32 * 1024 * 1024) data = null;
      } catch (err) {
        data = null;
      }
      considerPicture(rel, data, spriteFiles, rinkFiles, loose, year, donorFiles);
    }
    const images = groupImages(loose, year);
    function byRange(a, b) {
      const left = rangeOf(a);
      const right = rangeOf(b);
      const startA = left ? left.start : 0;
      const startB = right ? right.start : 0;
      return startA - startB || a.localeCompare(b);
    }
    spriteFiles.sort(byRange);
    rinkFiles.sort(byRange);
    if (year === 96 && homeFile && /\.qda$/i.test(homeFile) && !awayFile) {
      hasAway = true;
      awayFile = homeFile;
    }
    if (!rinkFile) rinkFile = pickRinkFile(donorFiles);
    addFullRinkImage(images, donorFiles, year === 94);
    assignImagePalettes(images, donorFiles, year);
    if (year !== 96) images.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    return {
      spriteFiles,
      rinkFiles,
      images,
      hasHome,
      hasAway,
      homeFile,
      awayFile,
      rinkFile,
      paletteNames: paletteNames(hasHome, hasAway, year),
      audio: catalogAudio(files)
    };
  }

  return {
    FRAME_COUNT,
    FRAME_COUNT_94,
    FRAME_COUNT_96,
    playerFrameCount,
    TEAM_BYTES,
    TEAMS,
    TEAMS_96,
    LABELS,
    PAL_DONOR,
    PAL_DONOR_94,
    PAL_DONOR_96,
    NEWPAL_TAGS,
    isPaletteTag,
    isRefPack,
    isEaHuffPack,
    decompressEaContainer,
    decompressRefPack,
    decodeSpit,
    parseShapeBank,
    isGfxPakPack,
    parseGfxPakPack,
    encodeBundle,
    decodeBundle,
    parseBigf,
    encodeBigf,
    parseUnit,
    parseUnitC0fb,
    encodeC0fb,
    locatebigKind,
    splitVivPath,
    readPacked,
    looksLikeQda,
    paletteFromQda,
    teamPaletteColors,
    pcYearOf,
    openBytes,
    grayscale,
    decodeAct,
    decodeEaPalette,
    decodeRinkFile,
    colorsToAct,
    buildTeamPalette,
    hotspotFor,
    frameIsDynamic,
    isSpriteBank,
    isRinkBank,
    rangeOf,
    buildSpriteBank,
    openSpriteBundle,
    openImage,
    openImageParts,
    folderOf,
    packOf,
    newpalTagFor,
    openRinkImage,
    paletteFrom,
    imageMeta,
    parseTeamFile,
    paletteNames,
    catalogDirectory,
    catalogFromPaths,
    catalogAudio,
    installReady
  };
});
