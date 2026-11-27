/**
 * Games this viewer can name and, when a ROM is present, draw.
 *
 * NHL 92 pictures are Alice .ANIM banks. They also sit at fixed offsets in
 * the retail ROM. NHLPA 93, NHL 94, NHL 95 and NHL 96 Genesis keep the SPA
 * tables (and SPF on 93–95) and a player sprite sheet, plus every picture the
 * disassembly extract scripts name (screens, rink, fonts, logos, portraits,
 * frame banks).
 * The two SNES ports use planar 4bpp tiles; their animation names come from
 * the disassemblies. NHL 95 PC reads SHPP shape banks (PPV and RefPack QFS)
 * of SPIT pictures. NHL 96 PC locateshape loads the same SHPI bank as a .FSH
 * (NHL96PC HOCKEY.EXE). NHL 94 PC PPV / QPP is a Mode X planar PackBits bank
 * (Huffman 30 FB or BTree 46 FB), not SHPI and not RefPack.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nhl92Games = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const generated = (typeof require === 'function')
    ? require('./genesis-images')
    : { nhlpa93: [], nhl94: [], nhl94cd: [], nhl95: [], nhl96: [] };

  // PicturePalette's CRAM block. Shared portraits (header longs are 0) have
  // no colors of their own; DrawMatchupPicture uses this palette.
  const PORTRAIT_PALETTE = { nhl94: 0xC6762, nhl94cd: 0x165CE, nhl95: 0xA1DC4 };

  // Sega CD: GRAPH2.BIN + HOCKEY.BIN (184,842 bytes) + STARTER.BIN (120,248 bytes), then the decoded title picture
  // (30,606 bytes; lib/segacd-film.js). STARTER.BIN holds the two boot pictures as .map.jim data: the title with credits
  // (raw, file $5BD8, 18,030 bytes) and High Score Productions (packed, file $A942, 4,896 bytes).
  const CD_STARTER_AT = 3051520 + 184842;
  const CD_TITLE_AT = CD_STARTER_AT + 120248;
  // GRAPH2.BIN pages, one per team in TeamList order (GTABLE.BIN records 68 to 95): [GRAPH2 offset, then the stored sizes of the team
  // details picture, the same page without the photo, and the video player picture]. They sit at +12 and follow each other.
  const CD_TEAM_PAGES = [
    [2076672, 12616, 8392, 10376],
    [2109440, 11912, 7592, 9608],
    [2140160, 12584, 8584, 10952],
    [2172928, 12616, 8968, 10312],
    [2205696, 12680, 8648, 10472],
    [2238464, 10760, 6504, 7080],
    [2263040, 12264, 8168, 9640],
    [2293760, 12104, 8488, 10408],
    [2326528, 11976, 7688, 9288],
    [2357248, 12520, 8040, 9288],
    [2387968, 12296, 8584, 10408],
    [2420736, 12712, 8712, 10472],
    [2453504, 12840, 8424, 10696],
    [2486272, 12904, 8648, 10984],
    [2519040, 13000, 9288, 11208],
    [2553856, 12200, 7592, 8264],
    [2582528, 12840, 8584, 10440],
    [2615296, 12584, 8488, 10056],
    [2648064, 12264, 8200, 9704],
    [2678784, 12264, 7912, 9832],
    [2709504, 11912, 7816, 8456],
    [2738176, 12808, 8552, 10920],
    [2770944, 12744, 8584, 10568],
    [2803712, 13064, 8648, 10824],
    [2836480, 12136, 8392, 9896],
    [2867200, 11368, 7880, 9832],
    [2897920, 11752, 7784, 9864],
    [2928640, 11400, 7368, 9544]
  ];
  const CD_BLOB_SCREENS = [{ at: 0xDD800, len: 23496 }, { at: 0xE33C8, len: 12648 }];
  CD_TEAM_PAGES.forEach((page) => {
    let at = page[0] + 12;
    for (let k = 1; k < 4; k++) { CD_BLOB_SCREENS.push({ at, len: page[k] }); at += page[k]; }
  });
  // The pictures wrapped as .map.jim follow the title picture, 6 bytes longer than their stored size.
  function cdBlobImages() {
    const out = [];
    let at = CD_TITLE_AT + 30606;
    const names = ['GoalieLicense', 'GoalieLoading'];
    const labels = ['License (goalie)', 'Loading (goalie)'];
    const groups = ['Screens', 'Screens'];
    const kinds = [['TeamDetails', 'Team details', 'Team details'], ['TeamDetailsNoPhoto', 'Team details, no photo', 'Team details, no photo'], ['VideoPlayer', 'Video player', 'Video player']];
    CD_BLOB_SCREENS.forEach((s, i) => {
      let id, label, group = 'Screens';
      if (i < 2) { id = names[i]; label = labels[i]; } else {
        const team = LOGO_ORDER[Math.floor((i - 2) / 3)];
        const kind = kinds[(i - 2) % 3];
        id = kind[0] + team; label = kind[1] + ' ' + team; group = kind[2];
      }
      out.push({ id: id + '.map.jim', label, group, kind: 'jim', start: at, end: at + s.len + 6 });
      at += s.len + 6;
    });
    return out;
  }
  function cdImages() {
    return generated.nhl94cd.concat([
      { id: 'TitleCredits.map.jim', label: 'Title with credits', group: 'Screens', kind: 'jim', start: CD_STARTER_AT + 0x5BD8, end: CD_STARTER_AT + 0x5BD8 + 18030 },
      { id: 'BootFont.map.jim', label: 'Boot font', group: 'Fonts', kind: 'jim', start: CD_STARTER_AT + 0xA246, end: CD_STARTER_AT + 0xA246 + 1788 },
        { id: 'HighScoreProductions.map.jim', label: 'High Score Productions', group: 'Screens', kind: 'jim', start: CD_STARTER_AT + 0xA942, end: CD_STARTER_AT + 0xA942 + 4896 },
      { id: 'Title.map.jim', label: 'Title (intro movie, last frame)', group: 'Screens', kind: 'jim', start: CD_TITLE_AT, end: CD_TITLE_AT + 30606 }
    ]).concat(cdBlobImages());
  }

  function stampPortraits(id, images) {
    const at = PORTRAIT_PALETTE[id];
    if (at == null) return images;
    return images.map((image) => {
      if (image.paletteAt != null || image.group !== 'Players' || image.kind !== 'jim') return image;
      return Object.assign({}, image, { paletteAt: at });
    });
  }

  // TeamLogoPalettes, one 16-color CRAM palette per team in TeamList order.
  const LOGO_ORDER = ['ANH', 'BOS', 'BUF', 'CGY', 'CHI', 'DAL', 'DET', 'EDM', 'FLA', 'HFD', 'LA', 'MTL', 'NJ', 'NYI', 'NYR', 'OTW', 'PHI', 'PIT', 'QUE', 'SJ', 'STL', 'TB', 'TOR', 'VAN', 'WSH', 'WPG', 'ASE', 'ASW'];
  // Sega CD: GRAPH2.BIN (3,051,520 bytes) is followed by HOCKEY.BIN; its logo palettes are 64 bytes apart from $A060.
  const LOGO_PALETTE = { nhl94: 0xFF462, nhl94cd: 3051520 + 0xA060, nhl95: 0x1A169A, nhl96: 0x1D93C8 };
  const LOGO_STRIDE = { nhl94cd: 64 };

  function stampLogos(id, images) {
    const base = LOGO_PALETTE[id];
    if (base == null) return images;
    return images.map((image) => {
      const match = /^(?:logo|TeamLogo|SmallLogo)([A-Z0-9]+)\.map\.jim$/.exec(image.id);
      if (!match) return image;
      const code = match[1] === 'ANA' ? 'ANH' : match[1];
      const index = LOGO_ORDER.indexOf(code);
      if (index < 0) return image;
      return Object.assign({}, image, { paletteAt: base + index * (LOGO_STRIDE[id] || 32) });
    });
  }
  const NHL92_IMAGES = [
    { id: 'Sprites.anim', label: 'Sprites', group: 'Sprites', kind: 'anim', file: true, start: 0x3D5EE, end: 0x7216C },
    { id: 'Puck.anim', label: 'Puck', group: 'Sprites', kind: 'anim', file: true, start: 0x2E9EC, end: 0x2F262 },
    { id: 'Crowd.anim', label: 'Crowd', group: 'Sprites', kind: 'anim', file: true, start: 0x7216C, end: 0x75790 },
    { id: 'FaceOff.anim', label: 'Faceoff', group: 'Sprites', kind: 'anim', start: 0x75790, end: 0x7716C },
    { id: 'Zam.anim', label: 'Zamboni', group: 'Sprites', kind: 'anim', file: true, start: 0x7716C, end: 0x778D2 },
    { id: 'GameSetUp.map.jim', label: 'Game setup', group: 'Screens', kind: 'jim', start: 0x24214, end: 0x25642 },
    { id: 'Title1.map.jim', label: 'Title', group: 'Screens', kind: 'jim', start: 0x25642, end: 0x2ADF0 },
    { id: 'Title2.map.jim', label: 'Title page 2', group: 'Screens', kind: 'jim', start: 0x2ADF0, end: 0x2C0FE },
    { id: 'NHLSpin.map.jim', label: 'NHL spin', group: 'Screens', kind: 'jim', start: 0x2C0FE, end: 0x2E9EC },
    { id: 'Scouting.map.jim', label: 'Scouting', group: 'Screens', kind: 'jim', start: 0x2F262, end: 0x33590 },
    { id: 'Framer.map.jim', label: 'Frame', group: 'Screens', kind: 'jim', start: 0x33590, end: 0x336B0, remap: [0, 3, 4, 3], forceIce: true },
    { id: 'FaceOff.map.jim', label: 'Faceoff window', group: 'Screens', kind: 'jim', start: 0x336B0, end: 0x33AAE },
    { id: 'IceRink.map.jim', label: 'Ice rink', group: 'Ice', kind: 'jim', start: 0x33AAE, end: 0x3A3DC },
    { id: 'Refs.map.jim', label: 'Referees', group: 'Ice', kind: 'jim', start: 0x3A3DC, end: 0x3D5EE },
    { id: 'BigFont.map.jim', label: 'Big font', group: 'Fonts', kind: 'jim', start: 0x778D2, end: 0x78C20 },
    { id: 'SmallFont.map.jim', label: 'Small font', group: 'Fonts', kind: 'jim', start: 0x78C20, end: 0x79C2E },
    { id: 'TeamBlocks.map.jim', label: 'Team blocks', group: 'Screens', kind: 'jim', start: 0x79C2E, end: 0x7E79C },
    { id: 'Arrows.map.jim', label: 'Arrows', group: 'Screens', kind: 'jim', start: 0x7E79C, end: 0x7EB12 },
    { id: 'Stanley.map.jim', label: 'Stanley Cup', group: 'Screens', kind: 'jim', start: 0x7EB12, end: 0x7FC20 },
    { id: 'EASN.map.jim', label: 'EASN', group: 'Screens', kind: 'jim', start: 0x7FC20, end: 0x7FE8A }
  ];

  const AUX_FRAME_BANK_ORDER = [
    'GameSetup.anim',
    'Title3.anim',
    'NHLPALogo.anim',
    'Crowd.anim',
    'FaceOff.anim',
    'Zam.anim',
    'EASN.anim',
    'StanleyCup.anim',
    'ArenaAnimGfx.anim',
    'CupCelebrationSpr.anim'
  ];

  function frameBanksFromImages(images) {
    const list = images || [];
    const banks = [];
    for (const id of AUX_FRAME_BANK_ORDER) {
      const image = list.find((item) => item.id === id && item.kind === 'frames');
      if (!image) continue;
      banks.push({
        id: image.id,
        label: image.label,
        kind: 'frames',
        start: image.start,
        end: image.end,
        paletteFrom: image.paletteFrom
      });
    }
    return banks;
  }

  function sheetGameBanks(images) {
    return [{ id: 'sprites', label: 'Sprites' }].concat(frameBanksFromImages(images));
  }

  function snes93(frames, pieces, tiles, pieceSize, piecesAt) {
    return { frames, pieceCount: pieces, tiles, pieceSize, pieces: piecesAt };
  }

  const GAMES = [
    {
      id: 'nhl92',
      title: 'NHL 92',
      frames: 'frames.asm',
      source: 'NHL92Genesis',
      platform: 'genesis',
      kind: 'anim',
      paletteKind: 'genesis',
      banks: [
        { id: 'Sprites.anim', label: 'Sprites', file: true, start: 0x3D5EE, end: 0x7216C },
        { id: 'Puck.anim', label: 'Puck', file: true, start: 0x2E9EC, end: 0x2F262 },
        { id: 'Crowd.anim', label: 'Crowd', file: true, start: 0x7216C, end: 0x75790 },
        { id: 'FaceOff.anim', label: 'Faceoff', start: 0x75790, end: 0x7716C },
        { id: 'Zam.anim', label: 'Zamboni', file: true, start: 0x7716C, end: 0x778D2 }
      ],
      images: NHL92_IMAGES,
      palettes: '92',
      romNames: ['nhl92.bin', 'nhl92.md', 'nhl92.gen'],
      romBytes: 0x80000
    },
    {
      id: 'nhlpa93',
      title: 'NHLPA 93',
      frames: 'frames93.asm',
      source: 'NHLPA93Genesis',
      platform: 'genesis',
      kind: 'sheet',
      paletteKind: 'genesis',
      banks: sheetGameBanks(generated.nhlpa93),
      images: generated.nhlpa93,
      palettes: '94',
      romNames: ['nhlpa93.bin', 'nhlpa93.md', 'nhlpa93.gen'],
      romBytes: 0x80000,
      sheet: {
        record: '94',
        boundsAt: 2,
        sprites: 0x3A378,
        hotlist: 0x743CE,
        palette: 0x35E22
      }
    },
    {
      id: 'nhl94',
      title: 'NHL 94',
      frames: 'frames94.asm',
      source: 'NHL94Genesis',
      platform: 'genesis',
      kind: 'sheet',
      paletteKind: 'genesis',
      banks: sheetGameBanks(stampLogos('nhl94', stampPortraits('nhl94', generated.nhl94))),
      images: stampLogos('nhl94', stampPortraits('nhl94', generated.nhl94)),
      palettes: '94',
      romNames: ['nhl94.bin', 'nhl94.md', 'nhl94.gen'],
      romBytes: 0x100000,
      sheet: {
        record: '94',
        boundsAt: 2,
        sprites: 0x5DE7A,
        hotlist: 0xA44C8,
        palette: 0x59924
      }
    },
    {
      id: 'nhl94cd',
      title: 'NHL 94 (Sega CD)',
      frames: 'frames94.asm',
      source: 'NHL94Genesis',
      platform: 'genesis',
      kind: 'sheet',
      paletteKind: 'genesis',
      banks: sheetGameBanks(stampLogos('nhl94cd', stampPortraits('nhl94cd', cdImages()))),
      images: stampLogos('nhl94cd', stampPortraits('nhl94cd', cdImages())),
      palettes: '94',
      romNames: [],
      // titleMovie: the NHL HOCKEY '94 picture is the last frame of HOCKEY.SEG; Studio decodes it into a .map.jim and appends it after HOCKEY.BIN.
      disc: { names: ['nhl94cd.iso', 'nhl94sc.iso', 'nhl94segacd.iso'], file: 'GRAPH2.BIN', extra: ['HOCKEY.BIN', 'STARTER.BIN'], titleMovie: 'HOCKEY.SEG', blobScreens: CD_BLOB_SCREENS },
      romBytes: 3051520,
      // The cartridge's player sheet, moved: Sprites.bin, the hot spot list and CRAM sit at other offsets in GRAPH2.BIN.
      sheet: {
        record: '94',
        boundsAt: 2,
        sprites: 0x6F800,
        hotlist: 0x63192,
        palette: 0x499AA
      }
    },
    {
      id: 'nhl95',
      title: 'NHL 95',
      frames: 'frames95.asm',
      source: 'NHL95Genesis',
      platform: 'genesis',
      kind: 'sheet',
      paletteKind: 'genesis',
      banks: sheetGameBanks(
        stampLogos('nhl95', stampPortraits('nhl95', generated.nhl95)).map((image) => {
          if (!/^ArenaGfx/.test(image.id)) return image;
          const next = Object.assign({}, image);
          delete next.paletteAt;
          return next;
        })
      ),
      images: stampLogos('nhl95', stampPortraits('nhl95', generated.nhl95)).map((image) => {
        if (!/^ArenaGfx/.test(image.id)) return image;
        const next = Object.assign({}, image);
        delete next.paletteAt;
        return next;
      }),
      palettes: '95',
      romNames: ['nhl95.bin', 'nhl95.md', 'nhl95.gen'],
      romBytes: 0x200000,
      sheet: {
        record: '95',
        boundsAt: 0,
        sprites: 0xCA56A,
        hotlist: 0x137B66,
        palette: 0x14BEFA
      }
    },
    {
      id: 'nhl96',
      title: 'NHL 96',
      frames: 'frames96.asm',
      source: 'NHL96Genesis',
      platform: 'genesis',
      kind: 'sheet',
      paletteKind: 'genesis',
      banks: sheetGameBanks(stampLogos('nhl96', generated.nhl96)),
      images: stampLogos('nhl96', generated.nhl96),
      palettes: '96',
      romNames: ['nhl96.bin', 'nhl96.md', 'nhl96.gen'],
      romBytes: 0x200000,
      sheet: {
        record: '95',
        boundsAt: 0,
        sprites: 0x9aa9e,
        hotlist: 0x13938e,
        palette: 0x12f588
      }
    },
    {
      id: 'nhlpa93snes',
      title: 'NHLPA 93 (SNES)',
      frames: 'frames93snes.asm',
      source: 'NHLPA93SNES',
      platform: 'snes',
      kind: 'snes93',
      paletteKind: 'snes',
      banks: [{ id: 'sprites', label: 'Sprites' }],
      palettes: 'snes',
      romNames: ['nhlpa93snes.sfc', 'nhlpa93snes.smc', 'nhlpa93snes.bin'],
      romBytes: 0x80000,
      snes: {
        format: '93',
        hotlist: 0x26F3C,
        hotBytes: 0x44A,
        hotSkip: 6,
        hotCut: 377,
        sets: [
          snes93(96, 445, 896, 4, 0x60526),
          snes93(48, 258, 512, 4, 0x790F1),
          snes93(40, 209, 512, 4, 0x3805C),
          snes93(40, 344, 640, 4, 0x70447),
          snes93(48, 334, 640, 4, 0x2806C),
          snes93(64, 533, 896, 4, 0x5847A),
          snes93(16, 110, 256, 4, 0x3D231),
          snes93(31, 191, 384, 4, 0x43CA0),
          snes93(22, 75, 128, 4, 0x40A47),
          snes93(56, 365, 640, 4, 0x2007C),
          snes93(56, 388, 768, 4, 0x688B8),
          snes93(14, 50, 128, 4, 0x48028),
          snes93(74, 504, 896, 4, 0x500A0),
          snes93(53, 345, 640, 4, 0x493F9),
          snes93(62, 742, 151, 6, 0x75A2F)
        ]
      },
      images: [
        { id: 'setup', label: 'Game Set Up', group: 'Screens', kind: 'snes93-screen', start: 0x40000, end: 0x40000 + 559, mapW: 32, mapH: 32, mapSize: 0x800, pal: 0x800, tiles: 0x900, fileNames: ['GameSetUp.map.sjim'] },
        { id: 'title', label: 'Title 1', group: 'Screens', kind: 'snes93-screen', start: 0x2D5C0, end: 0x2D5C0 + 9721, mapW: 32, mapH: 28, mapSize: 0x700, pal: 0x700, tiles: 0x800, fileNames: ['Title1.map.sjim'] },
        { id: 'easnbg', label: 'EASNBG', group: 'Screens', kind: 'snes93-screen', start: 0x3C3A0, end: 0x3C3A0 + 788, mapW: 32, mapH: 16, mapSize: 0x400, tiles: 0x400, palFrom: { start: 0x6D38, end: 0x6D38 + 1590, offset: 0x90, count: 64 }, fileNames: ['EASNBG.map.sjim'] },
        { id: 'framer', label: 'Framer', group: 'Screens', kind: 'snes93-map', mapStart: 0x4071C, mapSize: 18, mapW: 3, mapH: 3, tilesStart: 0x4072E, tilesEnd: 0x407AE, rawTiles: true, remap: [0, 6, 4, 6], clear: true, fileNames: ['Framer.chr', 'Framer.smap'] },
        { id: 'faceoff', label: 'Face Off', group: 'Screens', kind: 'snes93-map', mapStart: 0x26949, mapSize: 240, mapW: 12, mapH: 10, tilesStart: 0x3C6B4, tilesEnd: 0x3CABA, fileNames: ['FaceOff.chr.pak', 'FaceOff.smap'] },
        { id: 'energybar', label: 'Energy Bar', group: 'Screens', kind: 'snes93-tiles', tilesStart: 0x1C6D8, tilesEnd: 0x1C6D8 + 1332, tileList: [96, 97, 98], row: 4, remap: [4, 3, 4, 3, 2, 1, 4], fileNames: ['SmallFont.chr.pak (tiles $60-$62)'] },
        { id: 'teamblocks', label: 'Team Blocks', group: 'Screens', kind: 'snes93-frames', mapStart: 0x3CABA, frameBytes: 36, frames: 26, mapW: 9, mapH: 2, tilesStart: 0x41B73, tilesEnd: 0x43C56, fileNames: ['TeamBlocks.chr.pak', 'TeamBlocks.smap'] },
        { id: 'playoff', label: 'Arrows', group: 'Screens', kind: 'snes93-playoff', mapStart: 0x57880, mapSize: 552, mapW: 12, mapH: 23, tilesStart: 0x2779D, tilesEnd: 0x27816, fileNames: ['PlayoffTiles.chr.pak', 'Arrows.smap'] },
        { id: 'easn', label: 'EASN', group: 'Screens', kind: 'snes93-map', mapStart: 0x7824D, mapSize: 28, mapW: 7, mapH: 2, tilesStart: 0x27386, tilesEnd: 0x27532, fileNames: ['RinkLogoTiles.chr.pak', 'EASN.smap'] },
        { id: 'ronbarr', label: 'Ron Barr', group: 'Screens', kind: 'snes93-screen', start: 0x6D38, end: 0x6D38 + 1590, mapW: 8, mapH: 9, mapSize: 0x90, pal: 0x90, tiles: 0x190, fileNames: ['RonBarr.map.sjim'] },
        { id: 'nhlpa', label: 'NHLPA Logo', group: 'Screens', kind: 'snes93-screen', start: 0x60000, end: 0x60000 + 1114, mapW: 8, mapH: 10, mapSize: 0xA0, pal: 0xA0, tiles: 0x1A0, fileNames: ['NHLPALogo.map.sjim'] },
        { id: 'rink', label: 'Ice Rink', group: 'Ice', kind: 'snes93-map', mapStart: 0x1CCCB, mapSize: 8160, mapW: 48, mapH: 85, tilesStart: 0x14DA0, tilesEnd: 0x14DA0 + 11164, teamPalette: true, fileNames: ['IceRink.chr.pak', 'IceRink.smap'] },
        { id: 'horrink', label: 'Ice Rink Hor', group: 'Ice', kind: 'snes93-map', mapStart: 0x1ECAB, mapSize: 0xA80, mapW: 48, mapH: 28, tilesStart: 0x14DA0, tilesEnd: 0x14DA0 + 11164, teamPalette: true, fileNames: ['IceRink.chr.pak', 'IceRinkHor.smap'] },
        { id: 'refs', label: 'Refs', group: 'Ice', kind: 'snes93-frames', mapStart: 0x1FAEC, frameBytes: 0x70, frames: 7, mapW: 7, mapH: 8, tilesStart: 0x3F55E, tilesEnd: 0x3FF78, fileNames: ['Ref.chr.pak', 'Refs.smap'] },
        { id: 'refs2', label: 'Refs 2', group: 'Ice', kind: 'snes93-frames', mapStart: 0x4F3FB, frameBytes: 0x70, frames: 17, mapW: 7, mapH: 8, tilesStart: 0x4EB45, tilesEnd: 0x4F3FB, fileNames: ['Ref2.chr.pak', 'Refs2.smap'] },
        { id: 'bigfont', label: 'Big Font', group: 'Fonts', kind: 'snes93-font', start: 0x6EEC8, end: 0x6EEC8 + 2496, mapStart: 0x78000, columns: 76, bottom: 0x98, remap: [7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fileNames: ['BigFont.chr.pak', 'BigFont.smap'] },
        { id: 'smallfont', label: 'Small Font', group: 'Fonts', kind: 'snes93-font', start: 0x1C6D8, end: 0x1C6D8 + 1332, columns: 16, remap: [0, 3, 4, 3, 2, 1, 4], clear: false, fileNames: ['SmallFont.chr.pak', 'SmallFont.smap'] },
        { id: 'crowd', label: 'Crowd', group: 'Sprites', kind: 'snes93-sprites', first: 659, last: 720, fileNames: ['Sprites659_720.sanim'] },
        { id: 'faceoffsprites', label: 'Face Off sprites', group: 'Sprites', kind: 'snes93-sprites', first: 532, last: 541, teamPalette: true, fileNames: ['Sprites532_605.sanim (frames 532-541)'] },
        { id: 'zam', label: 'Zamboni', group: 'Sprites', kind: 'snes93-sprites', first: 557, last: 557, fileNames: ['Sprites532_605.sanim (frame 557)'] },
      ]
    },
    {
      id: 'nhl94snes',
      title: 'NHL 94 (SNES)',
      frames: 'frames94snes.asm',
      source: 'NHL94SNES',
      platform: 'snes',
      kind: 'snes94',
      paletteKind: 'snes',
      jerseyRow: 4,
      banks: [{ id: 'sprites', label: 'Sprites' }],
      palettes: 'snes',
      romNames: ['nhl94snes.sfc', 'nhl94snes.smc', 'nhl94snes.bin'],
      romBytes: 0x100000,
      snes: {
        format: '94',
        base: 0x828000,
        rinkTiles: 0x818000,
        rinkMap: 0x92E053,
        rinkPalette: 0x9AD0B6
      },
      images: [
        { id: 'title', label: 'Title letters', group: 'Screens', kind: 'snes94-sprites', addr: 0x91B188, packed: true, palette: 0x9AE0D5, fileNames: ['TitleSprites.spr.huf', 'TitleSpritePalette.pal.lz'] },
        { id: 'titlegoalie', label: 'Title goalie', group: 'Screens', kind: 'snes94-screen', tiles: 0x938000, map: 0x9AB7A1, palette: 0x9AE121, paletteCount: 16, fileNames: ['SetupBackTiles.chr.huf', 'SetupBackMap.map.huf'] },
        { id: 'titlepuck', label: 'Title puck', group: 'Screens', kind: 'snes94-screen', tiles: 0x948000, map: 0x9ADDC6, palette: 0x9ACCA9, paletteCount: 16, fileNames: ['TitlePuckTiles.chr.lz', 'TitlePuckMap.map.rle'] },
        { id: 'easports', label: 'EA Sports', group: 'Screens', kind: 'snes94-screen', tiles: 0x93B217, linear: true, map: 0x96C61F, mapW: 32, mapH: 28, palette: 0x9ADE57, palette2: 0x89FFC7, palette2At: 0x40, palette2Count: 16, fileNames: ['EALogoTiles.lz', 'EALogoMap.map.huf'] },
        { id: 'eabackdrop', label: 'EA Sports backdrop', group: 'Screens', kind: 'snes94-screen', tiles: 0x95F1AE, map: 0x9ABA95, palette: 0x9AE121, fileNames: ['MenuBackTiles.chr.lz', 'MenuBackMap.map.lz'] },
        { id: 'scout', label: 'Scouting report', group: 'Screens', kind: 'snes94-screen', tiles: 0x95F1AE, map: 0x9ABA95, palette: 0x9AE121, fileNames: ['MenuBackMap.map.lz (LoadScoutingScreen.asm)'] },
        { id: 'faceoff', label: 'Face Off', group: 'Screens', kind: 'snes94-screen', tiles: 0x96B2CF, map: 0x9AD6A6, rawMap: true, fileNames: ['FaceOffTiles.chr.lz', 'FaceOffMap.asm'] },
        { id: 'teamblocks', label: 'Team Blocks', group: 'Screens', kind: 'snes94-screen', tiles: 0x9AC1F3, map: 0x9AE99D, rawMap: true, fileNames: ['TeamBlocksTiles.chr.huf', 'TeamBlocksMap.asm'] },
        { id: 'easn', label: 'EASN', group: 'Screens', kind: 'snes94-screen', tiles: 0x9AC98B, map: 0x9AEA3A, rawMap: true, fileNames: ['RinkLogoTiles.chr.huf', 'EASNLogoMap.asm'] },
        { id: 'ronbarr', label: 'Ron Barr', group: 'Screens', kind: 'snes94-screen', tiles: 0x94D6A5, map: 0x9AC0CC, palette: 0x9AE946, fileNames: ['RonBarrTiles.chr.huf', 'RonBarrMap.map.huf'] },
        { id: 'stanley', label: 'Stanley Cup', group: 'Screens', kind: 'snes94-screen', tiles: 0x968C02, map: 0x95FF9B, palette: 0x9AE884, paletteCount: 16, fileNames: ['StanleyCupTiles.lz', 'StanleyCupMap.map.huf'] },
        { id: 'window', label: 'Window frame', group: 'Screens', kind: 'snes94-screen', tiles: 0x95E304, map: 0x9AE9C7, fileNames: ['RefTilesHor.chr.lz'] },
        { id: 'logos', label: 'Team logos', group: 'Logos', kind: 'snes94-sprites', addr: 0x81ABDE, packed: true, palTable: 0x9C8497, fileNames: ['TeamLogos.spr.huf'] },
        { id: 'rink', label: 'Ice Rink', group: 'Ice', kind: 'snes94-rink', fileNames: ['IceRink.chr.lz', 'IceRink.map.lz'] },
        { id: 'center', label: 'Center ice', group: 'Ice', kind: 'snes94-center' },
        { id: 'refs', label: 'Refs', group: 'Ice', kind: 'snes94-frames', tiles: 0x95BA96, map: 0x96F15D, header: false, mapW: 7, mapH: 8, frames: 7, fileNames: ['RefTiles.chr.lz', 'RefsMap.asm'] },
        { id: 'refs2', label: 'Refs 2', group: 'Ice', kind: 'snes94-frames', tiles: 0x95E304, map: 0x95DB8E, mapW: 7, mapH: 8, frames: 17, fileNames: ['RefTilesHor.chr.lz', 'RefsMapHor.asm'] },
        { id: 'bigfont', label: 'Big Font', group: 'Fonts', kind: 'snes94-screen', tiles: 0x96BABD, map: 0x9ABD3D, rawMap: true, clear: true, fileNames: ['BigFontTiles.chr.lz', 'BigFontMap.asm'] },
        { id: 'smallfont', label: 'Small Font', group: 'Fonts', kind: 'snes94-screen', tiles: 0x96A103, map: 0x9ACDB0, rawMap: true, remap: [0, 3, 4, 3, 2, 1, 4], fileNames: ['SmallFontTiles.chr.pairs', 'SmallFontMap.asm'] },
        { id: 'letters', label: 'Big letters', group: 'Fonts', kind: 'snes94-sprites', addr: 0x92A7B9, fileNames: ['LetterSprites.spr'] },
        { id: 'smallletters', label: 'Small letters', group: 'Fonts', kind: 'snes94-sprites', addr: 0x95A7F7, fileNames: ['SmallLetterSprites.spr'] },
        { id: 'framer', label: 'Framer', group: 'Screens', kind: 'snes94-screen', tiles: 0x9C8000, tilesEnd: 0x9C8080, rawTiles: true, map: 0x9C8080, rawMap: true, mapW: 3, mapH: 3, palette: 0x9ADE57, remap: [0, 6, 4, 6], clear: true, fileNames: ['FramerTiles.chr', 'FramerMap.asm'] },
        { id: 'energybar', label: 'Energy Bar', group: 'Screens', kind: 'snes94-tiles', tiles: 0x96A103, palette: 0x9ADE57, tileList: [96, 97, 98], row: 4, remap: [4, 3, 4, 3, 2, 1, 4], fileNames: ['SmallFontTiles.chr.pairs (tiles $60-$62)'] },
        { id: 'playoff', label: 'Arrows', group: 'Screens', kind: 'snes94-playoff', tiles: 0x9AE8BF, map: 0x99B726, palette: 0x9AE027, mapW: 12, mapH: 23, fileNames: ['PlayoffTiles.huf', 'PlayoffBracketMap.asm'] },
        { id: 'faceoffsprites', label: 'Face Off sprites', group: 'Sprites', kind: 'snes93-sprites', first: 423, last: 432, teamPalette: true, fileNames: ['SpriteFrames (frames 423-432)'] },
        { id: 'zam', label: 'Zamboni', group: 'Sprites', kind: 'snes93-sprites', first: 448, last: 448, fileNames: ['SpriteFrames (frame 448)'] },
        { id: 'crowd', label: 'Crowd', group: 'Sprites', kind: 'snes93-sprites', first: 658, last: 720, fileNames: ['SpriteFrames (658-720; showcrowd / SPAgready)'] },
        { id: 'cards', label: 'Player cards', group: 'Players', kind: 'snes94-cards' }
      ]
    },
    {
      id: 'nhl95snes',
      title: 'NHL 95 (SNES)',
      frames: 'frames95snes.asm',
      source: 'NHL95SNES',
      platform: 'snes',
      kind: 'snes95',
      paletteKind: 'snes',
      banks: [{ id: 'sprites', label: 'Sprites' }],
      palettes: 'snes',
      romNames: ['nhl95snes.sfc', 'nhl95snes.smc', 'nhl95snes.bin'],
      romBytes: 0x100000,
      snes: { format: '95' },
      images: (typeof require === 'function') ? require('./snes95-images') : []
    },
    {
      id: 'nhl94pc',
      title: 'NHL 94 (PC)',
      frames: 'frames94pc.asm',
      source: 'NHL94PC',
      platform: 'pc',
      kind: 'pc94',
      paletteKind: 'pc',
      jerseyRow: 9,
      paletteLabel: 'Team colors',
      tagline: 'DOS install under pc94/ — planar PPV sprite sheets, QPP pictures, AdLib songs, announcer speech, 876 player frames',
      hint: 'Copy the NHL 94 PC install into pc94/ (PPV, QPP, HOMEPALS.BIN, AWAYPALS.BIN, RINK.TIL, RINK.MAP, RINKPAL.QPP, *.KMS/*.CFG, PCFF*.TIM/*.DIG/*.PAT, XBRUCE2.VIV / XRBARR2.VIV). Player sheets are 000_049.PPV … 850_875.PPV; rink/crowd use F000_049.PPV and siblings. The Images tab Ice rink is RINK.TIL + RINK.MAP (no RINK.QFS): four concatenated Mode X planes (VgaStorePlanes), not 64-byte linear tiles. MAP 0x800 is a true 8-pixel reverse (VgaStamp8 plane 3-p). Jersey and centre ice use RINKPAL.QPP, not the bundled 95 rinkpal.act. QPP pictures are Huffman 30 FB or BTree 46 FB wrapping a Mode X planar bank — not 95 PC SHPI/RefPack. SPA scripts come from HOCKEY.EXE at 0x358A4. Restart the server after adding files.',
      banks: [
        { id: 'sprites', label: 'Players' },
        { id: 'rink', label: 'Rink and crowd' }
      ],
      images: [],
      palettes: 'pc94',
      romNames: [],
      romBytes: 0
    },
    {
      id: 'nhl95pc',
      title: 'NHL 95 (PC)',
      frames: 'frames95pc.asm',
      source: 'NHL95PC',
      platform: 'pc',
      kind: 'pc95',
      paletteKind: 'pc',
      jerseyRow: 9,
      paletteLabel: 'Team colors',
      tagline: 'DOS install under pc95/ or roms/nhl95.iso — SHPI PPV sheets, QFS pictures, AdLib songs',
      hint: 'Copy the NHL 95 PC install into pc95/, or put the PC CD at roms/nhl95.iso (or nhl95pc.iso). Player frames are the 000_049.PPV … 11001149.PPV series. On the Frame tab, Bank → Rink and crowd opens F000_049.PPV and siblings. Every other QFS is a picture. Songs are EACSNDF .KMS/.CFG from the EXE (not wiki Kris). VIV is C0 FB like 94; OpenSpeechBank splits per clip: 47 FB (G) is ReadSpeechSample DPCM; .NUM / .COR rink calls are mixer flag 1 D7414 (same expander as desk IFF). IFF FORM 8SVX BODY is word_D7414 Fibonacci-delta at the VHDR rate, volume 0x4C (AFAN.IFF ≥ 7 s), with VHDR oneShot/repeat as intro then looping tail. RIFF WAVE XOR 80h, then 8-bit unless fmt bits is 16. Restart the server after adding files.',
      banks: [{ id: 'sprites', label: 'Players' }],
      images: [],
      palettes: 'pc95',
      romNames: [],
      romBytes: 0
    },
    {
      id: 'nhl96pc',
      title: 'NHL 96 (PC)',
      frames: 'frames96pc.asm',
      source: 'NHL96PC',
      platform: 'pc',
      kind: 'pc96',
      paletteKind: 'pc',
      jerseyRow: 9,
      paletteLabel: 'Team colors',
      tagline: 'DOS install under pc96/ or roms/nhl96.iso — SHPI FSH pictures, ASF songs, VIV art packs',
      hint: 'Copy the NHL 96 PC install into pc96/, or put the PC CD at roms/nhl96.iso (or nhl96pc.iso). Names come from NHL96PC HOCKEY.EXE (SHA-1 426fb8c0c80088c6a2c56a9dac50509cb9c24540): locateshape opens .FSH / .vsh / .qfs / .qvs / .ref SHPI banks, not 94/95 PPV sheets. Images list DATA then GERMAN, each VIV as a folder, and each FSH or REF as one item (SHPI tags in the filmstrip). Player sprites are GAMEART.VIV total.ref, fight.ref, and cup.ref (sub_61F2E / sub_622CD, packed 10 FB after the 16-byte header is raw pixels; sub_AF85C skips a Copyright prefix). Ice and ARENAART.VIV borrow rinkpal.qfs. ICELOGO keeps each FSH in-file !pal (sub_25E4D locateshape icelogo — not newpal). Calendar day-box logos are SETLOGO.REF team tags (sub_1B05E) with PNT.FSH !lgo (sub_1B6BC). CALNDxx.FSH is the month background (bkgd); CALBUTT.FSH holds DK%02d chrome. AWARDS team logos use newpal.qfs tags (off_11BB4C). The BASEFILE.VIV intro NHLPA logo (nhlp) uses !pl1; other intro.fsh images keep !pl0. Banners a0000000–a0000027 / h0000000–h0000027 keep the palettes in those files. setlogo.ref is one list item. Art packs are GAMEART.VIV, ARENAART.VIV, and the other .VIV names in the EXE — locatebig C0 FB (or BI/BIGF) unit files, not 94/95 speech VIV. Songs are EA 1SNh .ASF wrapping an EACS header (MENU1, DIT00–DIT47, INTRO, …): EACS+0x0B is the voice slot, EACS+0x0A==2 is EA IMA ADPCM (sub_D57B4 / sub_D585C), EACS+8 is bits and EACS+9 is channels. Compressed 1SNh/1SNd payloads start with a 20-byte IMA block (dwOutSize, idxL, idxR, predL, predR; loc_CC55E). 1SNh size includes the header (sample frames = (size-0x28)/(bits*ch), dword_123BEC=4 for ADPCM); 1SNd size includes its 8-byte id; 1SNl+8 is the loop jump in samples; padding past those sizes is not decoded. FRONT1.BNK / GAME11.BNK stay listed. Jersey colors come from newpal.qfs (teampal.qda if newpal is missing). SPA scripts are unk_117A9C in HOCKEY.EXE (file 0x1502f0): flags, pair count, (frame, time), facing added to the frame. Restart the server after adding files.',
      banks: [
        { id: 'sprites', label: 'Players' },
        { id: 'fight', label: 'Fight' },
        { id: 'cup', label: 'Cup' }
      ],
      images: [],
      palettes: 'pc96',
      romNames: [],
      romBytes: 0
    },
    {
      id: 'nhl97pc',
      title: 'NHL 97 (PC)',
      frames: 'frames97pc.asm',
      source: 'NHL97PC',
      platform: 'pc',
      kind: 'pc97',
      paletteKind: 'pc',
      jerseyRow: 9,
      paletteLabel: 'Team colors',
      tagline: 'DOS / Windows CD under pc97/ or roms/nhl97.iso: SHPI FSH pictures in the VIV art packs, ASF songs',
      hint: 'Copy the NHL 97 PC install into pc97/, or put the PC CD at roms/nhl97.iso (or nhl97pc.iso). Pictures are the SHPI .FSH files inside the DATA and GAMEDATA .VIV packs (BIGF / C0 FB containers, as in NHL 96 PC): menu art, logos, trophies, faces, masks, arena and the per-team UNI####.VIV uniform packs. The players are polygon models (ANIMS.VIV .4da animations), not sprites, so there are no SPA sequences. Names come from the files themselves. Restart the server after adding files.',
      banks: [],
      images: [],
      palettes: 'pc96',
      romNames: [],
      romBytes: 0
    }
  ];

  function gameById(id) {
    return GAMES.find((game) => game.id === id) || null;
  }

  // NHLPA 93 Rev A (header date 1992.OCT) places every slice at or after the
  // Z80 driver ($16E53) 0x2E bytes later than retail. That includes the
  // pictures and the player sprite sheet.
  function revAAdjust(game, date) {
    const images = (game && game.images) || [];
    const sheet = (game && game.sheet) || null;
    if (!game || game.id !== 'nhlpa93' || date !== '1992.OCT') return { images, sheet };
    const delta = 0x2E;
    const floor = 0x16E53;
    const bump = (value) => (typeof value === 'number' && value >= floor ? value + delta : value);
    return {
      images: images.map((image) => {
        const next = Object.assign({}, image, {
          start: bump(image.start),
          end: bump(image.end)
        });
        if (image.paletteAt != null) next.paletteAt = bump(image.paletteAt);
        return next;
      }),
      sheet: sheet ? Object.assign({}, sheet, {
        sprites: bump(sheet.sprites),
        hotlist: bump(sheet.hotlist),
        palette: bump(sheet.palette)
      }) : null
    };
  }

  // NHLPA 93 Rev B (header date 1993.FEB): the EA Sports pictures replace the EASN ones and everything else moved by
  // its own amount, so the offsets come from lib/rev-b.js.
  function revBAdjust(game, date) {
    const images = (game && game.images) || [];
    const sheet = (game && game.sheet) || null;
    const RevB = typeof require === 'function' ? require('./rev-b') : null;
    if (!RevB || !game || game.id !== 'nhlpa93' || date !== RevB.DATE) return { images, sheet };
    const out = RevB.adjustGameStatus({ id: game.id, images, sheet, banks: [] }, date);
    return { images: out.images, sheet: out.sheet };
  }

  // The revision a header date names: Rev 0 (1992.JUL), Rev A (1992.OCT) or Rev B (1993.FEB).
  function revAdjust(game, date) {
    return date === '1993.FEB' ? revBAdjust(game, date) : revAAdjust(game, date);
  }

  return { GAMES, gameById, revAAdjust, revBAdjust, revAdjust, sheetGameBanks, frameBanksFromImages };
});
