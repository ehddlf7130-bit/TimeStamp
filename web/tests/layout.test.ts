import { describe, expect, it } from 'vitest';
import { blurAlpha, boxWidths, cleanLabel, DEFAULT_LABEL, MAX_LABEL } from '../src/stamp/layout';

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

describe('stamp label', () => {
  it('normalizes whitespace and trims the label', () => expect(cleanLabel('  야간\n  순찰  ')).toBe('야간 순찰'));
  it('allows an empty label for a clock-only stamp', () => expect(cleanLabel('  ')).toBe(''));
  it('limits a long label', () => expect(cleanLabel('가'.repeat(40))).toHaveLength(MAX_LABEL));
  it('keeps the default label unchanged', () => expect(cleanLabel(DEFAULT_LABEL)).toBe(DEFAULT_LABEL));
});
