import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
mkdirSync('public', { recursive: true });
function crc32(b) { let c = 0xffffffff; for (const n of b) { c ^= n; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(name, data) { const n = Buffer.from(name); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([n, data]))); return Buffer.concat([len, n, data, crc]); }
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  const bytes = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 192, v = y / size * 192;
    const ring = Math.abs(Math.hypot(u - 84, v - 94) - 42) < 8;
    const line = u > 106 && u < 122 && v > 56 && v < 132 || u > 106 && u < 150 && v > 116 && v < 132;
    const dot = Math.hypot(u - 144, v - 52) < 9;
    const color = ring || line ? [255,255,255,255] : dot ? [214,205,255,255] : [107,78,255,255];
    const i = y * (size * 4 + 1) + 1 + x * 4; color.forEach((c,j) => { bytes[i+j]=c; });
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  writeFileSync(`public/${name}`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(bytes)),chunk('IEND',Buffer.alloc(0))]));
}
