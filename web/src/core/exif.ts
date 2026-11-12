// JPEG capture dates: read or write EXIF as Korean wall time, matching the visible stamp.
import { wall, type Wall } from './patrol';

const KST_MINUTES = 9 * 60;

/** Convert our UTC-field Korean wall time to a real Unix timestamp for file metadata. */
export function koreaTimestamp(time: Wall): number {
  return time.getTime() - KST_MINUTES * 60_000;
}

/**
 * Give a rendered JPEG the same date as its visible stamp, without re-encoding pixels.
 * Photos apps can sort by EXIF rather than filenames or the order files were imported.
 * Run before capture storage and when restoring older, metadata-free photos, so share
 * buttons can open the native sheet synchronously within the user's tap.
 */
export async function withCaptureTime(blob: Blob, time: Wall): Promise<Blob> {
  if (!Number.isFinite(time.getTime())) throw new Error('사진 날짜가 올바르지 않습니다.');
  const start = new DataView(await blob.slice(0, 2).arrayBuffer());
  if (blob.size < 4 || start.getUint16(0) !== 0xffd8) throw new Error('JPEG 사진이 아닙니다.');

  // Replace prior EXIF instead of accumulating headers on every session restore.
  // Retain all other segments (JFIF, ICC, etc.) and the compressed image verbatim.
  const parts: BlobPart[] = [blob.slice(0, 2), captureTimeSegment(time)];
  let p = 2, keep = 2;
  while (p + 4 <= blob.size) {
    // Only read marker headers, not every full-resolution image on mobile restore.
    const v = new DataView(await blob.slice(p, p + 10).arrayBuffer());
    if (v.getUint8(0) !== 0xff) throw new Error('JPEG 사진 정보가 손상되었습니다.');
    const marker = v.getUint8(1);
    if (marker === 0xda || marker === 0xd9) break;
    const len = v.getUint16(2);
    if (len < 2 || p + 2 + len > blob.size) throw new Error('JPEG 사진 정보가 손상되었습니다.');
    if (marker === 0xe1 && len >= 8 && v.getUint32(4) === 0x45786966 && v.getUint16(8) === 0) {
      parts.push(blob.slice(keep, p));
      keep = p + 2 + len;
    }
    p += 2 + len;
  }
  parts.push(blob.slice(keep));
  return new Blob(parts, { type: 'image/jpeg' });
}

function captureTimeSegment(time: Wall): Uint8Array {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const date = `${pad(time.getUTCFullYear(), 4)}:${pad(time.getUTCMonth() + 1)}:${pad(time.getUTCDate())} ${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}:${pad(time.getUTCSeconds())}\0`;
  // TIFF offsets: IFD0 at 8 (2 entries), Exif IFD at 38 (6 entries), then ASCII.
  const bytes = new Uint8Array(153);
  const v = new DataView(bytes.buffer);
  bytes.set([0xff, 0xe1, 0, 151, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49]);
  const u16 = (offset: number, value: number) => v.setUint16(10 + offset, value, true);
  const u32 = (offset: number, value: number) => v.setUint32(10 + offset, value, true);
  const entry = (offset: number, tag: number, type: number, count: number, value: number) => {
    u16(offset, tag); u16(offset + 2, type); u32(offset + 4, count); u32(offset + 8, value);
  };
  u16(2, 42); u32(4, 8);
  u16(8, 2);
  entry(10, 0x0132, 2, 20, 116); // DateTime
  entry(22, 0x8769, 4, 1, 38); // ExifIFDPointer
  u16(38, 6);
  entry(40, 0x9000, 7, 4, 0x31333230); // ExifVersion "0231", inline
  entry(52, 0x9003, 2, 20, 116); // DateTimeOriginal
  entry(64, 0x9004, 2, 20, 116); // DateTimeDigitized
  entry(76, 0x9010, 2, 7, 136); // OffsetTime
  entry(88, 0x9011, 2, 7, 136); // OffsetTimeOriginal
  entry(100, 0x9012, 2, 7, 136); // OffsetTimeDigitized
  bytes.set(new TextEncoder().encode(date), 126);
  bytes.set(new TextEncoder().encode('+09:00\0'), 146);
  return bytes;
}

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
