// Reads when a JPEG was actually taken: EXIF DateTimeOriginal (+ OffsetTimeOriginal), as Korean wall time.
import { wall, type Wall } from './patrol';

const KST_MINUTES = 9 * 60;

/** Returns the capture time in Korean wall-clock time, or null if the file carries none. */
export function readCaptureTime(buf: ArrayBuffer): Wall | null {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return null;
    const marker = v.getUint8(p + 1);
    if (marker === 0xda || marker === 0xd9) return null; // image data starts: no more metadata
    const len = v.getUint16(p + 2);
    if (marker === 0xe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 /* "Exif" */) {
      return parseTiff(v, p + 10, Math.min(v.byteLength, p + 2 + len));
    }
    p += 2 + len;
  }
  return null;
}

function parseTiff(v: DataView, base: number, end: number): Wall | null {
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o: number) => v.getUint16(base + o, le);
  const u32 = (o: number) => v.getUint32(base + o, le);
  if (u16(2) !== 42) return null;
  const ascii = (count: number, valueOffset: number) => {
    const at = count <= 4 ? valueOffset : u32(valueOffset);
    let s = '';
    for (let i = 0; i < count && base + at + i < end; i++) {
      const c = v.getUint8(base + at + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const readIfd = (offset: number) => {
    const tags = new Map<number, string | number>();
    if (base + offset + 2 > end) return tags;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (base + e + 12 > end) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      if (type === 2) tags.set(tag, ascii(count, e + 8));
      else if (type === 4) tags.set(tag, u32(e + 8));
    }
    return tags;
  };
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = typeof exifPtr === 'number' ? readIfd(exifPtr) : new Map();
  const text = (exif.get(0x9003) ?? ifd0.get(0x0132)) as string | undefined;
  const offset = exif.get(0x9011) as string | undefined;
  return text ? parseExifDate(text, offset) : null;
}

/** "2026:11:09 20:05:12" with optional "+09:00" offset → Korean wall time. */
export function parseExifDate(text: string, offset?: string): Wall | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, hh, mi, ss] = m.slice(1).map(Number);
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const local = wall(y, mo, d, hh, mi);
  local.setUTCSeconds(ss);
  // Without an offset the camera's local clock is assumed to be Korean time.
  const o = offset && /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!o) return local;
  const minutes = (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3]));
  return new Date(local.getTime() + (KST_MINUTES - minutes) * 60_000);
}
