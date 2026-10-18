/**
 * NHLPA 93 Rev B (header date 1993.FEB, GM T-50396 -00).
 *
 * EA changed the EASN branding to EA Sports in this version and recompressed the pictures that carried it, so unlike
 * Rev A (every slice after the Z80 driver 0x2E bytes later) the pictures and the sheet moved by different amounts.
 * RANGES are the ROM offsets of each picture. The spinning EASN animation and the second EASN bitmap set are gone;
 * the EA Sports logo (EASports.map.jim) and the Stanley Cup screen picture (EASports2.map.jim) replace them.
 * Offsets come from the NHLPA93Genesis REV=2 build (tools/extractAssets93.js, REVB_SLICES).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NhlRevB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DATE = '1993.FEB';
  const RANGES = {
    "GameSetUp.map.jim": [0x2E1F4, 0x2EF9A],
    "GameSetup.anim": [0x2EF9A, 0x2F0A6],
    "Title1.map.jim": [0x2F0A6, 0x3127E],
    "Title2.map.jim": [0x3127E, 0x31F06],
    "Title3.anim": [0x31F06, 0x322C2],
    "TitleLogo.anim": [0x322C2, 0x32852],
    "Scouting.map.jim": [0x32852, 0x335AC],
    "Framer.map.jim": [0x335AC, 0x33624],
    "FaceOff.map.jim": [0x33624, 0x33A88],
    "IceRink.map.jim": [0x33A88, 0x38A90],
    "Refs.map.jim": [0x38A90, 0x395EC],
    "Refs2.map.jim": [0x395EC, 0x3A502],
    "Crowd.anim": [0x74A6A, 0x772F6],
    "FaceOff.anim": [0x772F6, 0x78368],
    "Zam.anim": [0x78368, 0x78E52],
    "BigFont.map.jim": [0x78E52, 0x79708],
    "SmallFont.map.jim": [0x79708, 0x7A3D6],
    "EnergyBar.map.jim": [0x7A3D6, 0x7A4CA],
    "TeamBlocks.map.jim": [0x7A4CA, 0x7C6A2],
    "Arrows.map.jim": [0x7C7B2, 0x7CA0E],
    "EASports.map.jim": [0x7C6A2, 0x7C7B2],
    "RonBarr.map.jim": [0x7CA0E, 0x7CFE6],
    "Scores.map.jim": [0x7CFE6, 0x7D3CC],
    "EASports2.map.jim": [0x7D3CC, 0x7E2F4],
  };
  const SHEET = { sprites: 0x3A502, hotlist: 0x74556, palette: 0x35FAC, boundsAt: 0, tableBias: -1 };

  function adjustGameStatus(status, date) {
    if (!status || status.id !== 'nhlpa93' || date !== DATE) return status;
    const images = [];
    for (const image of status.images || []) {
      if (image.id === 'EASN.anim' || image.id === 'EASN2.map.jim') continue;
      const id = image.id === 'EASN.map.jim' ? 'EASports.map.jim' : image.id;
      const range = RANGES[id];
      if (!range) { images.push(image); continue; }
      images.push(Object.assign({}, image, {
        id,
        label: id === 'EASports.map.jim' ? 'EA Sports' : image.label,
        start: range[0],
        end: range[1]
      }));
    }
    const first = images.findIndex((image) => image.id === 'EASports.map.jim');
    if (first >= 0) {
      const base = images[first];
      images.push(Object.assign({}, base, { id: 'EASports2.map.jim', label: 'EA Sports 2', start: RANGES['EASports2.map.jim'][0], end: RANGES['EASports2.map.jim'][1] }));
    }
    const sheet = status.sheet ? Object.assign({}, status.sheet, SHEET) : null;
    const banks = (status.banks || []).filter((bank) => bank.id !== 'EASN.anim').map((bank) => {
      const range = bank.start == null ? null : RANGES[bank.id];
      return range ? Object.assign({}, bank, { start: range[0], end: range[1] }) : bank;
    });
    return Object.assign({}, status, { images, sheet, banks });
  }

  return { DATE, RANGES, SHEET, adjustGameStatus };
});
