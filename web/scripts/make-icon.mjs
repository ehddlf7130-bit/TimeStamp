// Draws the home-screen icon (clock face on the app's dark teal) as PNGs with no dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function coverage(x, y) {
  // unit square coordinates, centre (0.5, 0.5)
  const dx = x - 0.5, dy = y - 0.5, r = Math.hypot(dx, dy);
  if (r > 0.30 && r < 0.36) return 1;                       // ring
  const seg = (ax, ay, bx, by, w) => {                        // clock hands
    const px = x - ax, py = y - ay, vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - t * vx, py - t * vy) < w;
  };
  if (seg(0.5, 0.5, 0.5, 0.27, 0.028) || seg(0.5, 0.5, 0.66, 0.58, 0.028)) return 1;
  return r < 0.04 ? 1 : 0;
}

function icon(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const bg = [0x15, 0x2d, 0x36], fg = [0xff, 0xd5, 0x4a];
  const ss = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) a += coverage((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
      a /= ss * ss;
      for (let ch = 0; ch < 3; ch++) raw[y * (size * 3 + 1) + 1 + x * 3 + ch] = Math.round(bg[ch] * (1 - a) + fg[ch] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [180, 192, 512]) writeFileSync(join(out, `icon-${s}.png`), icon(s));
console.log('icons written');
