/**
 * Renders the generated tables of docs/NHL92-GM-MAP.md from data/audio/nhl92-gm-map.json and
 * data/audio/nhl92-patch-analysis.json, so the doc cannot drift from the files. Node only.
 *
 * The doc marks each generated block with
 *   <!-- GENERATED:name --> ... <!-- /GENERATED:name -->
 * and `apply()` replaces what is between the markers. Prose outside the markers is hand-written.
 */
const G = require('./nhl92-gm-map');

const esc = (s) => String(s).replace(/\|/g, '\\|');
const noteName = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);

function target(t) {
  if (!t) return 'none';
  if (t.kind === 'program') return 'GM ' + t.program + ' ' + t.name;
  if (t.kind === 'drum') return 'Drum ' + t.note + ' ' + t.name;
  if (t.kind === 'patch') return 'Patch ' + t.patch + (t.midi != null ? ' @ ' + noteName(t.midi) + ' (MIDI ' + t.midi + ')' : '');
  if (t.kind === 'dac') return 'DAC SFX ' + t.sfx + (t.label ? ' (' + t.label.replace(/, DAC sample$/, '') + ')' : '');
  return String(t.kind);
}

function opCell(o) {
  const mul = o.multiple === 0.5 ? '×½' : '×' + o.multiple;
  const dt = o.detune ? ' dt' + (o.detune > 0 ? '+' : '') + o.detune : '';
  const rs = o.rateScaling ? ' RS' + o.rateScaling : '';
  const text = mul + dt + '<br>TL ' + o.totalLevel + '<br>AR ' + o.attackRate + rs + '<br>D1R ' + o.decay1Rate + ' D2R ' + o.decay2Rate + '<br>SL ' + o.sustainLevel + ' RR ' + o.releaseRate;
  return o.carrier ? '**' + text.replace(/<br>/g, '**<br>**') + '**' : text;
}

function paramsTable(analysis) {
  const lines = ['| Patch | Alg | FB | Operator 1 | Operator 2 | Operator 3 | Operator 4 |', '|---|---|---|---|---|---|---|'];
  analysis.patches.forEach((p) => {
    lines.push('| ' + p.id + ' | ' + p.algorithm + ' | ' + p.feedback + ' | ' + p.operators.map(opCell).join(' | ') + ' |');
  });
  return lines.join('\n');
}

function measuredTable(analysis) {
  const lines = ['| Patch | Probe | Shape | Attack | Level at 100 / 400 ms | Release | Brightness | Noisiness | Periodicity |', '|---|---|---|---|---|---|---|---|---|'];
  analysis.patches.forEach((p) => {
    const m = p.measured;
    lines.push('| ' + p.id + ' | ' + p.probe.name + ' | ' + m.shape + ' | ' + m.attackMs + ' ms | ' + m.level100msDb + ' / ' + m.level400msDb + ' dB | ' + m.releaseMs + ' ms | ' +
      m.brightness + '× (' + m.centroidHz + ' Hz) | ' + m.flatness + ' | ' + m.periodicity + ' |');
  });
  return lines.join('\n');
}

function usageTable(analysis) {
  const chan = (c) => 'FM' + (c.channel + 1);
  const lines = ['| Patch | Songs: channels (notes) | Range | SFX |', '|---|---|---|---|'];
  analysis.patches.forEach((p) => {
    let songs = 'none';
    let range = '–';
    if (p.music) {
      const bySong = {};
      p.music.channels.forEach((c) => {
        (bySong[c.songName] = bySong[c.songName] || []).push(chan(c) + ' (' + c.notes + ')');
      });
      songs = Object.keys(bySong).map((k) => k + ': ' + bySong[k].join(', ')).join('; ');
      range = noteName(p.music.midiMin) + '–' + noteName(p.music.midiMax) + ', median ' + noteName(Math.round(p.music.midiMedian));
    }
    lines.push('| ' + p.id + ' | ' + songs + ' | ' + range + ' | ' + (p.sfx.length ? p.sfx.join(', ') : 'none') + ' |');
  });
  return lines.join('\n');
}

function nhl92ToGmTable(map) {
  const lines = ['| Patch | Character | GM match | Why | Runner-up | Sure? |', '|---|---|---|---|---|---|'];
  map.nhl92ToGm.patches.forEach((e) => {
    lines.push('| ' + e.patch + ' | ' + esc(e.character) + ' | **' + target(e.target) + '** | ' + esc(e.reason) + ' | ' + target(e.runnerUp) + ' | ' + e.confidence + ' |');
  });
  return lines.join('\n');
}

function familiesTable(map) {
  const lines = ['| Family | Programs | Default patch | Why | Runner-up | Sure? |', '|---|---|---|---|---|---|'];
  G.FAMILIES.forEach((f, i) => {
    const e = map.gmToNhl92.families[i];
    const overridden = map.gmToNhl92.overrides.filter((o) => o.program >= f.first && o.program <= f.last).length;
    lines.push('| ' + f.name + ' | ' + f.first + '–' + f.last + ' (' + overridden + ' overridden) | **' + target(e.target) + '** | ' + esc(e.reason) + ' | ' + target(e.runnerUp) + ' | ' + e.confidence + ' |');
  });
  return lines.join('\n');
}

function programsTable(map) {
  const lines = ['| GM | Program | NHL 92 match | From | Why | Runner-up | Sure? |', '|---|---|---|---|---|---|---|'];
  for (let p = 0; p < 128; p++) {
    const r = G.resolveProgram(map, p);
    const fam = G.familyOf(p).name.toLowerCase();
    lines.push('| ' + p + ' | ' + r.name + ' | **' + target(r.target) + '** | ' + (r.source === 'override' ? 'override' : 'family default') + ' | ' +
      (r.source === 'override' ? esc(r.reason) : '(' + fam + ' default)') + ' | ' + target(r.runnerUp) + ' | ' + r.confidence + ' |');
  }
  return lines.join('\n');
}

function drumsTable(map) {
  const lines = ['| Note | GM drum | NHL 92 match | Fit | Why | Runner-up |', '|---|---|---|---|---|---|'];
  map.gmToNhl92.drums.forEach((d) => {
    lines.push('| ' + d.note + ' | ' + d.name + ' | **' + target(d.target) + '** | ' + d.fit + ' | ' + esc(d.reason) + ' | ' + target(d.runnerUp) + ' |');
  });
  return lines.join('\n');
}

function drumSummary(map) {
  const by = (fit) => map.gmToNhl92.drums.filter((d) => d.fit === fit).map((d) => d.note + ' ' + d.name);
  const none = by('none');
  const good = by('good');
  return [
    '- **No good match (' + none.length + '):** ' + none.join('; ') + '.',
    '- **Good match (' + good.length + '):** ' + good.join('; ') + '.',
    '- **Rough (' + by('rough').length + '):** every other drum note from 35 to 81.'
  ].join('\n');
}

function leastSure(map) {
  const lowPatches = map.nhl92ToGm.patches.filter((e) => e.confidence === 'low').map((e) => e.patch);
  const lowFam = map.gmToNhl92.families.filter((e) => e.confidence === 'low').map((e) => e.family);
  return [
    '- NHL 92 → GM patches marked low: ' + lowPatches.join(', ') + '.',
    '- GM families whose default is marked low: ' + lowFam.join(', ') + '.',
    '- Overrides marked low: ' + map.gmToNhl92.overrides.filter((e) => e.confidence === 'low').length + ' of ' + map.gmToNhl92.overrides.length + '.'
  ].join('\n');
}

function sections(map, analysis) {
  return {
    params: paramsTable(analysis),
    measured: measuredTable(analysis),
    usage: usageTable(analysis),
    'nhl92-to-gm': nhl92ToGmTable(map),
    families: familiesTable(map),
    programs: programsTable(map),
    drums: drumsTable(map),
    'drum-summary': drumSummary(map),
    'least-sure-counts': leastSure(map)
  };
}

/** Replace each GENERATED block in `text`. Throws if a block named in `sec` is missing. */
function apply(text, sec) {
  let out = text;
  Object.keys(sec).forEach((name) => {
    const re = new RegExp('(<!-- GENERATED:' + name + ' -->)[\\s\\S]*?(<!-- /GENERATED:' + name + ' -->)');
    if (!re.test(out)) throw new Error('docs/NHL92-GM-MAP.md has no GENERATED:' + name + ' block');
    out = out.replace(re, (m, a, b) => a + '\n' + sec[name] + '\n' + b);
  });
  return out;
}

module.exports = { sections, apply, target, noteName };
