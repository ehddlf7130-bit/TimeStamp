import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, OrderedShare, shareFiles, type NamedBlob } from '../src/stamp/export';

const items = [{ name: '001_20261111_2317.jpg', blob: new Blob(['photo bytes'], { type: 'image/jpeg' }) }];
afterEach(() => vi.unstubAllGlobals());

describe('photo sharing', () => {
  it('shares the actual image Blob with its planned filename and type', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    expect(await shareFiles(items)).toBe(true);
    const [file] = share.mock.calls[0][0].files as File[];
    expect(file.name).toBe(items[0].name); expect(file.type).toBe('image/jpeg');
    expect(await file.text()).toBe('photo bytes');
  });
  it('preserves planned file dates instead of assigning the time of the share tap', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const dates = ['2026-11-11T14:55:00Z', '2026-11-11T15:00:00Z', '2026-11-11T15:05:00Z'].map(Date.parse);
    await shareFiles(dates.map((lastModified, i) => ({ ...items[0], name: `${i + 1}.jpg`, lastModified })));
    const files = share.mock.calls[0][0].files as File[];
    expect(files.map((file) => file.lastModified)).toEqual(dates);
    expect(files.map((file) => file.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);
  });
  it('reports cancellation as false instead of a completed save', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: () => Promise.reject(new DOMException('Cancelled', 'AbortError')) });
    expect(await shareFiles(items)).toBe(false);
  });
  it('offers individual image downloads if files cannot be shared', async () => {
    vi.stubGlobal('navigator', { canShare: () => false, share: vi.fn() });
    await expect(shareFiles(items)).rejects.toThrow('이미지 다운로드');
  });
  it('handles missing or throwing capability APIs', () => {
    vi.stubGlobal('navigator', {}); expect(canShareFiles([])).toBe(false);
    vi.stubGlobal('navigator', { share: () => {}, canShare: () => { throw new TypeError(); } });
    expect(canShareFiles([])).toBe(false);
  });
  it('propagates a real sharing failure', async () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: () => Promise.reject(new Error('Sharing failed')) });
    await expect(shareFiles(items)).rejects.toThrow('Sharing failed');
  });
});

describe('ordered saving', () => {
  const photos: NamedBlob[] = ['001.jpg', '002.jpg', '003.jpg'].map((name) => ({ name, blob: new Blob([name], { type: 'image/jpeg' }) }));

  it('shares one photo per call, in the given chronological order', async () => {
    const share = vi.fn().mockResolvedValue(true);
    const saver = new OrderedShare(photos, share);
    while (!saver.done) await saver.next();
    expect(share.mock.calls.map(([files]) => files.map((f: NamedBlob) => f.name))).toEqual([['001.jpg'], ['002.jpg'], ['003.jpg']]);
    expect(saver.saved).toBe(3);
  });
  it('starts the share synchronously so the native sheet keeps the tap activation', () => {
    const share = vi.fn().mockResolvedValue(true);
    void new OrderedShare(photos, share).next();
    expect(share).toHaveBeenCalledTimes(1);
  });
  it('retries the same photo after a cancellation or failure', async () => {
    const share = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('Sharing failed')).mockResolvedValue(true);
    const saver = new OrderedShare(photos, share);
    expect(await saver.next()).toBe(true);
    expect(await saver.next()).toBe(false);
    await expect(saver.next()).rejects.toThrow('Sharing failed');
    expect(saver.current?.name).toBe('002.jpg');
    await saver.next(); await saver.next();
    expect(share.mock.calls.map(([files]) => files[0].name)).toEqual(['001.jpg', '002.jpg', '002.jpg', '002.jpg', '003.jpg']);
    expect(saver.done).toBe(true);
  });
  it('ignores a second tap while a share sheet is still open', async () => {
    let finish!: (v: boolean) => void;
    const share = vi.fn().mockReturnValueOnce(new Promise<boolean>((r) => { finish = r; })).mockResolvedValue(true);
    const saver = new OrderedShare(photos, share);
    const first = saver.next();
    expect(await saver.next()).toBe(false);
    finish(true); await first;
    expect(share).toHaveBeenCalledTimes(1); expect(saver.saved).toBe(1);
  });
});
