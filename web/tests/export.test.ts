import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareFiles } from '../src/stamp/export';

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
