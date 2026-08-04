const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const cd = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cd), 0);
  return Buffer.concat([len, cd, crc]);
}
function buildPNG(w, h, idat) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
function makeIcon(size, bg, fg, radiusRatio) {
  const w = size, h = size;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 4 + 1);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      const i = off + 1 + x * 4;
      raw[i] = bg[0]; raw[i + 1] = bg[1]; raw[i + 2] = bg[2]; raw[i + 3] = 255;
    }
  }
  const cx = w / 2, cy = h / 2, R = w * radiusRatio;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= R * R) {
      const off = y * (w * 4 + 1); const i = off + 1 + x * 4;
      raw[i] = fg[0]; raw[i + 1] = fg[1]; raw[i + 2] = fg[2]; raw[i + 3] = 255;
    }
  }
  return buildPNG(w, h, zlib.deflateSync(raw));
}

const BG = [91, 155, 232];   // brand blue #5B9BE8
const FG = [255, 255, 255];  // white
const out = path.join(__dirname, 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), makeIcon(192, BG, FG, 0.30));
fs.writeFileSync(path.join(out, 'icon-512.png'), makeIcon(512, BG, FG, 0.30));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), makeIcon(512, BG, FG, 0.22)); // smaller for safe zone
console.log('icons generated');
