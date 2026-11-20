/**
 * NHLPA 93 sound names, lined up with NHL 92 (nhl92-sfx-names.js). The 93 labels are the ones in NHLPA93Genesis sound93.asm
 * (sfx_<label>_cmdstream, fmtune_<label>_cmdstream, sfx_<label>_pcm) and its ram93.asm equates. Where 93 keeps a sound that
 * 92 has, `link` is the 92 SFX or song it corresponds to: the same equate name (SFXsiren, SFXwhistle, ...), which is how 93's
 * own comments tie them together. 93 sounds 0-$2F are effects (variants share a label with a number), $30-$37 are songs.
 * The PCM table lists each 93 sample file and the 92 sample file whose recording it contains (checked byte for byte against
 * the 92 ROM), so a sample that has a 92 name shows it.
 */
(function (root, factory) {
  var names92 = typeof module === 'object' && module.exports ? require('./nhl92-sfx-names') : root.Nhl92SfxNames;
  var api = factory(names92);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Nhl93Names = api;
})(typeof self !== 'undefined' ? self : this, function (N92) {
  /** [label, ram93.asm equate or '', 92 equate it shares or '']; index = sound number. */
  const SFX = [
    ['siren', 'SFXsiren', 'SFXsiren'], ['beep1', 'SFXbeep1', 'SFXbeep1'], ['beep2', 'SFXbeep2', 'SFXbeep2'],
    ['whistle', 'SFXwhistle', 'SFXwhistle'], ['horn', 'SFXhorn', 'SFXhorn'], ['shotwiff', 'SFXshotwiff', 'SFXshotwiff'],
    ['stdef', 'SFXstdef', 'SFXstdef'], ['puckget', 'SFXpuckget', 'SFXpuckget'], ['oooh', 'SFXoooh', 'SFXoooh'],
    ['hithigh', 'SFXhithigh', 'SFXhithigh'], ['hitlow', 'SFXhitlow', 'SFXhitlow'], ['crowdcheer', 'SFXcrowdcheer', 'SFXcrowdcheer'],
    ['crowdboo', 'SFXcrowdboo', 'SFXcrowdboo'], ['oooh2', 'SFXoooh2', ''], ['bglass', 'SFXbglass', ''], ['homewin', 'SFXhomewin', ''],
    ['pass1', 'SFXpass', 'SFXpass'], ['pass2', '', 'SFXpass'], ['pass3', '', 'SFXpass'], ['pass4', '', 'SFXpass'],
    ['shotbh1', 'SFXshotbh', 'SFXshotbh'], ['shotbh2', '', 'SFXshotbh'], ['shotbh3', '', 'SFXshotbh'], ['shotbh4', '', 'SFXshotbh'],
    ['shotfh1', 'SFXshotfh', 'SFXshotfh'], ['shotfh2', '', 'SFXshotfh'], ['shotfh3', '', 'SFXshotfh'], ['shotfh4', '', 'SFXshotfh'],
    ['check1', 'SFXcheck', 'SFXcheck'], ['check2', '', 'SFXcheck'], ['check3', '', 'SFXcheck'], ['check4', '', 'SFXcheck'],
    ['playerwall', 'SFXplayerwall', 'SFXplayerwall'], ['playerwall2', 'SFXplayerwall2', ''], ['playerwall3', 'SFXplayerwall3', ''], ['playerwall4', 'SFXplayerwall4', ''],
    ['puckbody', 'SFXpuckbody', 'SFXpuckbody'], ['puckpost', 'SFXpuckpost', 'SFXpuckpost'], ['empty', '', ''],
    ['empty', '', ''], ['puckwall1', 'SFXpuckwall1', 'SFXpuckwall1'], ['puckwall2', 'SFXpuckwall2', 'SFXpuckwall2'], ['puckwall3', 'SFXpuckwall3', 'SFXpuckwall3'],
    ['puckwall4', 'SFXpuckwall4', ''], ['puckice1', 'SFXpuckice', 'SFXpuckice'], ['puckice2', '', ''], ['puckice3', '', ''], ['puckice4', '', '']
  ];

  /** [label, ram93.asm equate, 92 song label, description]; index = song number - $30. */
  const SONGS = [
    ['goal', 'SngGoal', '', 'Goal song'],
    ['periodstart', 'SngPeriodStart', '', 'Period start song'],
    ['lategame', 'SngLateGame', '', 'Late game song, once in the third period'],
    ['powerplay', 'SngPP', '', 'Home power play song'],
    ['faceoff', 'SngFaceoff', '', 'Face-off song, once per period'],
    ['title', 'SngTitle', 'SngTitle', ''],
    ['eop', 'SngEOP', '', 'End of period song; 93 also plays it at the end of the game, on the playoff screen and when the highlights start (92 SngEOP, SngEOG, SngPO)'],
    ['scouting', 'SngScouting', '', 'Scouting report song']
  ];

  /** NHL 94 Genesis: the three songs after the team songs ($30-$77), [equate in equals.inc, 92 song label, description]. */
  const SONGS94 = [
    ['SngTitle', 'SngTitle', 'Title song: one stream that loops to its start (93 has an intro and a loop body)'],
    ['SngEOP', '', 'End of period song (IntermissionStart, StartHL2)'],
    ['SngScouting', '', 'Scouting report song']
  ];

  /** NHL 95 Genesis: driver songs $00-$03 (the menu songs; $00-$03 in the effect table are other sounds), [name, 94 equivalent, description]. */
  const SONGS95 = [
    ['SngTitle', 'SngTitle', 'Title song (Opening2, newTitleScreen); 94 SngTitle'],
    ['Song1 (unsure)', '', 'No caller found in the NHL95Genesis source; unused or not yet traced'],
    ['SngEOP', 'SngEOP', 'End of period song (IntermissionStart); 94 SngEOP'],
    ['SngScouting', 'SngScouting', 'Scouting report song, also the playoff and Stanley Cup screens; 94 SngScouting']
  ];

  /** The 93 sample files (sfx_<name>_pcm, retail ROM ranges; unsigned 8-bit, a 00 ends a sample), the 92 sample file they are an excerpt or copy of, and the sounds that start them. */
  const PCM = [
    { name: 'sfx_puckget_pcm', start: 0x280AA, end: 0x2830A, from92: 'sfx_sam_puck2_slap_pcm', uses: [7] },
    { name: 'sfx_pass_pcm', start: 0x1734A, end: 0x18077, from92: 'sfx_sam_pass1_pcm', uses: [0x10, 0x11, 0x12, 0x13] },
    { name: 'sfx_shotbh_pcm', start: 0x17156, end: 0x1734A, from92: 'sfx_sam_pass1_pcm', uses: [0x14, 0x15, 0x16, 0x17] },
    { name: 'sfx_shotfh_pcm', start: 0x274F2, end: 0x280AA, from92: 'sfx_sam_puck2_slap_pcm', uses: [0x18, 0x19, 0x1a, 0x1b] },
    { name: 'sfx_check2_pcm', start: 0x2656C, end: 0x26F9B, from92: 'sfx_sam_hitboard_pcm', uses: [0x1d, 0x1f] },
    { name: 'sfx_check_pcm', start: 0x1D80A, end: 0x1F75C, from92: 'sfx_skating34_pcm', uses: [0x1c, 0x1e] },
    { name: 'sfx_playerwall_pcm', start: 0x260BC, end: 0x2656C, from92: 'sfx_sam_hitboard_pcm', uses: [0x20, 0x21, 0x22, 0x23] },
    { name: 'sfx_hithigh_pcm', start: 0x26F9C, end: 0x274F2, from92: 'sfx_sam_punch_pcm', uses: [9, 0xa] },
    { name: 'sfx_crowdboo_pcm', start: 0x1B2BC, end: 0x1D809, from92: 'sfx_sam_booing_pcm', uses: [0xc] },
    { name: 'sfx_oooh_pcm', start: 0x18078, end: 0x1B2BC, from92: '', uses: [8, 0xd, 0xe] },
    { name: 'sfx_crowdcheer_pcm', start: 0x1F75C, end: 0x2263C, from92: 'sfx_sam_crowdgoal_pcm', uses: [0xb, 0xf] },
    { name: 'sfx_bglass_pcm', start: 0x2263C, end: 0x260BB, from92: 'sfx_sam_crowdgoal_pcm', uses: [0xe] }
  ];

  PCM.sort((a, b) => a.start - b.start);

  /** The 92 SFX number for a 92 equate name, or -1. */
  function id92(equate) {
    if (!equate) return -1;
    for (const k of Object.keys(N92.EQUATES)) if (N92.EQUATES[k].indexOf(equate) >= 0) return Number(k);
    return -1;
  }

  /** Display name of an effect: the 93 label (the game's own equate, SFX[id][1], is the label with a prefix). */
  function sfxName(id) {
    return SFX[id][0];
  }

  /** The ram93.asm equate when it is not just the label with its prefix (pass1 is SFXpass), else ''. */
  function equateNote(e, prefix) {
    return e[1] && e[1].toLowerCase() !== prefix + e[0] ? 'ram93 ' + e[1] : '';
  }

  /** The 92 sound this effect corresponds to: "92 label (number) · description", or '' when 92 has no such sound. */
  function sfxDescribe(id) {
    const n = id92(SFX[id][2]);
    const pcm = PCM.find((p) => p.uses.indexOf(id) >= 0 && p.from92);
    const sample = pcm ? 'sample from 92 ' + pcm.from92.replace(/^sfx_/, '').replace(/_pcm$/, '') : '';
    const equate = equateNote(SFX[id], 'sfx');
    const parts = [];
    if (equate) parts.push(equate);
    if (n >= 0) parts.push('92 ' + N92.label(n) + ' (' + n + ') · ' + N92.describe(n));
    if (sample) parts.push(sample);
    return parts.join(' · ');
  }

  /** Display name of a song: the game's own equate (SngGoal, SngEOP, ...). */
  function songName(id) {
    return id >= 0x78 ? SONGS94[id - 0x78][0] : SONGS[id - 0x30][1];
  }

  function songDescribe(id) {
    if (id >= 0x78) {
      const s = SONGS94[id - 0x78];
      const i = N92.SONG_LABELS.indexOf(s[1]);
      return (i >= 0 ? '92 ' + s[1] + ' · ' : '') + s[2];
    }
    const e = SONGS[id - 0x30];
    if (e[3]) return e[3];
    const i = N92.SONG_LABELS.indexOf(e[2]);
    return i >= 0 ? '92 ' + e[2] + ' · ' + N92.SONG_DESCRIPTIONS[i] : '';
  }

  /** "sfx_sam_pass1_pcm" style name for the 92 file; the 93 file name stays the primary one. */
  function pcmDescribe(sample) {
    const used = sample.uses.map((id) => '$' + id.toString(16).toUpperCase() + ' ' + SFX[id][0]).join(', ');
    return (sample.from92 ? 'Audio from 92 ' + sample.from92 + '. ' : 'No 92 equivalent. ') + 'Started by ' + used + '.';
  }

  return { SFX, SONGS, SONGS94, SONGS95, PCM, sfxName, sfxDescribe, songName, songDescribe, pcmDescribe, id92 };
});
