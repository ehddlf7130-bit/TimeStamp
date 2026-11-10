import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { blurAlpha, boxWidths, layoutStamp, shadowTile, type StampData } from '../src/stamp/layout';
import { wall } from '../src/core/patrol';

const root = new URL('../../handoff/timestamp_codex_handoff/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('metadata/manifest.json', root), 'utf8'));
const occurrences = new Map<string, { source_box: number[]; core_box_in_asset: number[] }>(
  JSON.parse(readFileSync(new URL('metadata/occurrences.json', root), 'utf8')).map((o: { id: string }) => [o.id, o]));
const data: StampData = JSON.parse(readFileSync(new URL('../public/stamp/stamp-data.json', import.meta.url), 'utf8'));

describe('stamp shadow', () => {
  it('uses the calibrated Gaussian box widths', () => {
    expect(boxWidths(35.25)).toEqual([69, 71, 71]);
    expect(boxWidths(45)).toEqual([89, 89, 91]);
  });

  it('preserves opacity and symmetry when blurring an isolated pixel', () => {
    const size = 41;
    const alpha = new Float32Array(size * size);
    const center = 20 * size + 20;
    alpha[center] = 255;
    blurAlpha(alpha, size, size, 2);
    expect(alpha.reduce((sum, x) => sum + x, 0)).toBeCloseTo(255, 3);
    expect(alpha[center]).toBeGreaterThan(0);
    expect(alpha[center]).toBeLessThan(255);
    for (let d = 1; d < 10; d++) {
      expect(alpha[center - d]).toBeCloseTo(alpha[center + d], 5);
      expect(alpha[center - d * size]).toBeCloseTo(alpha[center + d * size], 5);
    }
    expect(alpha[0]).toBe(0);
  });

  it('does not wrap pixels onto the opposite edge', () => {
    const alpha = new Float32Array(31 * 31);
    alpha[0] = 255;
    blurAlpha(alpha, 31, 31, 2);
    expect(alpha[0]).toBeGreaterThan(0);
    expect(alpha[30]).toBe(0);
    expect(alpha[30 * 31]).toBe(0);
    expect(alpha.every((x) => x >= 0 && x <= 255)).toBe(true);
  });

  it('keeps a transparent canvas transparent', () => {
    const alpha = new Float32Array(64);
    blurAlpha(alpha, 8, 8, 3);
    expect(alpha.every((x) => x === 0)).toBe(true);
  });
});

describe('original v1.1 glyph layout', () => {
  for (const sample of manifest.samples) {
    it(`matches measured glyph ink positions: ${sample.id}`, () => {
      const [date, time] = sample.datetime_local.split('T');
      const [y, mo, d] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      const placed = layoutStamp(data, wall(y, mo, d, hh, mm));
      const ids: string[] = sample.occurrence_ids;
      const observed = ids.map((id) => occurrences.get(id)!);
      expect(placed).toHaveLength(observed.length);
      placed.forEach((p, i) => {
        const expectedCoreX = observed[i].source_box[0] + observed[i].core_box_in_asset[0];
        expect(Math.abs(p.x + data.glyphs[p.key].coreLeft - expectedCoreX)).toBeLessThan(2);
        expect(p.y).toBe(data.glyphs[p.key].y);
      });
    });
  }

  it('keeps v1.1 shadow tile padding and coordinates', () => {
    expect(shadowTile([{ key: 'x', x: 10.5, y: 20, w: 100, h: 50 }], 35.25))
      .toEqual({ left: -97, top: -87, width: 315, height: 264 });
  });

  it('keeps all 43 assets and settings identical to the saved TimeStamp-v1.1 release', () => {
    const hashes = JSON.parse(readFileSync(new URL('./fixtures/v1.1/source-sha256.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(Object.keys(hashes)).toHaveLength(43);
    for (const [file, expectedHash] of Object.entries(hashes)) {
      const source = file.startsWith('Resources/') ? new URL(file.slice('Resources/'.length), root)
        : new URL('../../src/TimeStamp.App/' + file, import.meta.url);
      const bytes = readFileSync(source);
      const normalized = file.endsWith('.json') ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
      expect(createHash('sha256').update(normalized).digest('hex'), file).toBe(expectedHash);
    }
  });
});
