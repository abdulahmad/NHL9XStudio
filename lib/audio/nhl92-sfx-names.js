/**
 * NHL '92 SFX names by ID. The IDs are what the game passes to `sfx`
 * (middle.asm). Names come from the original EA sound list and the src/ram.asm
 * equates; the handler labels in sound.asm's sfx_pointer_table (and that
 * table's comments) are shifted against the IDs and are kept only as findings.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl92SfxNames = api;
})(typeof self !== 'undefined' ? self : this, function () {
  /** Original EA sound list (as given for this project). */
  const EA = {
    0: 'siren', 1: 'skating', 2: 'skating', 3: 'skating', 4: 'skating', 5: 'hit puck', 6: 'hit board', 7: 'hit board',
    8: 'puck faceoff', 9: 'post', 10: 'whistle', 11: 'pass sample', 12: 'pass sample', 13: 'slap shot', 14: 'whiff',
    15: 'player hits boards', 16: 'player hits boards', 17: 'player hits boards', 18: 'check', 19: 'check', 20: 'check',
    21: 'punch', 22: 'punch', 23: 'punch', 24: 'foghorn', 25: 'crowd cheer', 26: 'boo',
    27: 'hitboard (quieter)', 28: 'hitboard (quieter)', 29: 'hitboard (quieter)', 30: 'hitboard (quieter)', 31: 'SFXoooh'
  };
  /** src/ram.asm equates (lines 33-63), by value. */
  const EQUATES = {
    0: ['SFXsiren'], 1: ['SFXbeep1'], 2: ['SFXbeep2'], 3: ['SFXcheck2'], 5: ['SFXstdef', 'SFXpuckbody'],
    7: ['SFXpuckwall1'], 8: ['SFXpuckget', 'SFXpuckice'], 9: ['SFXpuckpost'], 10: ['SFXwhistle'], 11: ['SFXpass'],
    12: ['SFXshotbh'], 13: ['SFXshotfh'], 14: ['SFXshotwiff'], 15: ['SFXplayerwall'], 18: ['SFXcheck'],
    21: ['SFXhithigh'], 23: ['SFXhitlow'], 24: ['SFXhorn'], 25: ['SFXcrowdcheer'], 26: ['SFXcrowdboo'],
    29: ['SFXpuckwall2'], 30: ['SFXpuckwall3'], 31: ['SFXoooh']
  };
  /** sfx_pointer_table entry comments in sound.asm (line 570 on), by table position. */
  const TABLE_COMMENTS = [
    'SFXsiren = 0', 'SFXbeep1 = 1', 'SFXbeep2 = 2', 'SFXcheck2 = 3', '(Unused)', 'SFXstdef, SFXpuckbody = 5', '(Unused)',
    'SFXpuckwall1 = 7', 'SFXpuckget, SFXpuckice = 8', 'SFXpuckpost = 9', 'SFXwhistle = 10', 'SFXpass = 11',
    'SFXshotbh = 12', 'SFXshotfh = 13', 'SFXshotwiff = 14', 'SFXplayerwall = 15', '(Unused)', '(Unused)', '(Unused)',
    'SFXcheck = 18', '(Unused)', 'SFXhithigh = 21', 'SFXhitlow = 23', 'SFXhorn = 24', 'SFXcrowdcheer = 25',
    'SFXcrowdboo = 26', '(Unused)', '(Unused)', 'SFXpuckwall2 = 29', 'SFXpuckwall3 = 30', 'SFXoooh = 31', '(Unused)',
    '(Duplicate)', '(Duplicate)', '(Duplicate)'
  ];

  /** Display name: "ID · EA name (equates)". IDs 32-34 are not in the EA list. */
  function name(id) {
    const ea = EA[id] || 'not in the EA list';
    const eq = EQUATES[id] ? ' (' + EQUATES[id].join(', ') + ')' : '';
    return id + ' · ' + ea + eq;
  }

  return { EA, EQUATES, TABLE_COMMENTS, name };
});
