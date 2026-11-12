import { describe, expect, it } from 'vitest';
import { koreaTimestamp, readCaptureTime, withCaptureTime } from '../src/core/exif';
import { wall } from '../src/core/patrol';

// JPEG marker fixture with JFIF, a non-EXIF APP1, a scan and escaped image bytes.
const jpeg = new Blob([new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0, 7, 0x4a, 0x46, 0x49, 0x46, 0,
  0xff, 0xe1, 0, 6, 0x58, 0x4d, 0x50, 0,
  0xff, 0xda, 0, 2, 1, 2, 0xff, 0, 3, 0xff, 0xd9,
])], { type: 'image/jpeg' });

describe('exported photo dates', () => {
  it('records the visible planned time as EXIF with the Korean time zone', async () => {
    const time = wall(2026, 11, 11, 23, 55);
    const result = await withCaptureTime(jpeg, time);
    expect(result.type).toBe('image/jpeg');
    expect(readCaptureTime(await jpeg.arrayBuffer())).toBeNull();
    expect(readCaptureTime(await result.arrayBuffer())).toEqual(time);
    const bytes = new Uint8Array(await result.arrayBuffer());
    const v = new DataView(bytes.buffer);
    const base = 12; // SOI + APP1 marker/length + "Exif\0\0"
    const ascii = (offset: number, count: number) => new TextDecoder().decode(bytes.slice(base + offset, base + offset + count));
    expect(v.getUint16(base, false)).toBe(0x4949);
    expect(v.getUint16(base + 2, true)).toBe(42);
    const tags = new Map<number, string>();
    for (const ifd of [8, 38]) {
      const count = v.getUint16(base + ifd, true);
      for (let i = 0; i < count; i++) {
        const e = base + ifd + 2 + i * 12;
        if (v.getUint16(e + 2, true) === 2)
          tags.set(v.getUint16(e, true), ascii(v.getUint32(e + 8, true), v.getUint32(e + 4, true)));
      }
    }
    for (const tag of [0x0132, 0x9003, 0x9004]) expect(tags.get(tag)).toBe('2026:11:11 23:55:00\0');
    for (const tag of [0x9010, 0x9011, 0x9012]) expect(tags.get(tag)).toBe('+09:00\0');
  });

  it('retains all compressed image bytes and non-EXIF metadata without re-encoding', async () => {
    const result = await withCaptureTime(jpeg, wall(2026, 11, 11, 23, 55));
    const original = new Uint8Array(await jpeg.arrayBuffer());
    const output = new Uint8Array(await result.arrayBuffer());
    const app1Length = new DataView(output.buffer).getUint16(4) + 2;
    expect(output.slice(0, 2)).toEqual(original.slice(0, 2));
    expect(output.slice(2 + app1Length)).toEqual(original.slice(2));
  });

  it('replaces old EXIF on reload or retake without growing the file', async () => {
    const initial = await withCaptureTime(jpeg, wall(2026, 11, 11, 23, 55));
    const time = wall(2026, 11, 12, 0, 5);
    const retimed = await withCaptureTime(initial, time);
    expect(retimed.size).toBe(initial.size);
    expect(readCaptureTime(await retimed.arrayBuffer())).toEqual(time);
    expect(await (await withCaptureTime(retimed, time)).arrayBuffer()).toEqual(await retimed.arrayBuffer());
  });

  it('keeps chronological dates across midnight, year boundaries and device time zones', async () => {
    const times = [wall(2026, 12, 31, 23, 55), wall(2027, 1, 1), wall(2027, 1, 1, 0, 5)];
    const output = await Promise.all(times.map((time) => withCaptureTime(jpeg, time)));
    expect(await Promise.all(output.map(async (blob) => readCaptureTime(await blob.arrayBuffer())))).toEqual(times);
    expect(times.map((time) => new Date(koreaTimestamp(time)).toISOString())).toEqual([
      '2026-12-31T14:55:00.000Z', '2026-12-31T15:00:00.000Z', '2026-12-31T15:05:00.000Z',
    ]);
  });

  it('rejects non-JPEG data, invalid dates and truncated JPEG metadata', async () => {
    await expect(withCaptureTime(new Blob(['invalid']), wall(2026, 11, 11))).rejects.toThrow('JPEG');
    await expect(withCaptureTime(jpeg, new Date(NaN))).rejects.toThrow('날짜');
    await expect(withCaptureTime(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 20])]), wall(2026, 11, 11))).rejects.toThrow('손상');
  });
});
