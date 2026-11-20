/**
 * Minimal store-only (no compression) ZIP writer. PNGs are already deflated,
 * so storing them costs almost nothing. entries: [{ name, data: Uint8Array }].
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NhlZipStore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  let table = null;
  function crc32(bytes) {
    if (!table) {
      table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(entries) {
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const entry of entries) {
      const name = enc.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 names
      lv.setUint16(8, 0, true); // stored
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x21, true); // 1980-01-01
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      locals.push(local, data);
      centrals.push(central);
      offset += local.length + data.length;
    }
    const centralSize = centrals.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centralSize + 22);
    let at = 0;
    for (const part of locals.concat(centrals, [end])) { out.set(part, at); at += part.length; }
    return out;
  }

  function unzipStore(buffer) {
    const src = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const entries = [];
    let i = 0;
    while (i + 30 <= src.length) {
      const sig = view.getUint32(i, true);
      if (sig === 0x02014b50 || sig === 0x06054b50) break;
      if (sig !== 0x04034b50) break;
      const method = view.getUint16(i + 8, true);
      const comp = view.getUint32(i + 18, true);
      const nameLen = view.getUint16(i + 26, true);
      const extraLen = view.getUint16(i + 28, true);
      const nameBytes = src.subarray(i + 30, i + 30 + nameLen);
      let name = '';
      for (let n = 0; n < nameBytes.length; n++) name += String.fromCharCode(nameBytes[n]);
      const dataStart = i + 30 + nameLen + extraLen;
      if (dataStart + comp > src.length) break;
      if (method !== 0) throw new Error('ZIP entry ' + name + ' is compressed; only store-only archives open here');
      if (name && !/\/$/.test(name)) entries.push({ name: name, data: src.subarray(dataStart, dataStart + comp) });
      i = dataStart + comp;
    }
    return entries;
  }

  return { zipStore, unzipStore, crc32 };
});
