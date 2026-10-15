const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'node_modules', '@dcorp80', 'z80cpu', 'dist', 'index.js');
const outPath = path.join(__dirname, '..', 'lib', 'audio', 'z80-cpu-core.js');
const src = fs.readFileSync(srcPath, 'utf8');
const m = src.match(/export\{([^}]+)\}/);
if (!m) throw new Error('no export block in z80cpu dist');
const parts = m[1].split(',').map((s) => s.trim());
const assigns = parts.map((p) => {
  const bits = p.split(/\s+as\s+/);
  const sym = bits[0];
  const alias = bits[1] || bits[0];
  return alias + ':' + sym;
}).join(',');
const body = src.replace(/export\{[^}]+\};?$/, '');
const header = [
  '/**',
  ' * Vendored @dcorp80/z80cpu (Apache-2.0) — half-cycle Z80 for NHL 92 sound.',
  ' * Regenerate: node tools/vendor-z80cpu.js',
  ' */',
  '(function (root, factory) {',
  '  if (typeof module === \'object\' && module.exports) module.exports = factory();',
  '  else root.NhlZ80CpuCore = factory();',
  '})(typeof self !== \'undefined\' ? self : this, function () {',
  body,
  '  return { ' + assigns + ' };',
  '});',
  ''
].join('\n');
fs.writeFileSync(outPath, header);
console.log('Wrote', outPath, '(' + header.length + ' bytes)');
