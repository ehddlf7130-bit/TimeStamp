// Geometry and shadow calculations ported from TimeStamp-v1.1.
import { stampDate, stampTime, type Wall } from '../core/patrol';

export interface Glyph { file: string; coreLeft: number; y: number; w: number; h: number }
export interface Element { key: string; x: number; y: number; w: number; h: number }
export interface ShadowStyle { sigmaPixels: number; opacity: number }
export interface StampData {
  referenceSize: number;
  glyphs: Record<string, Glyph>;
  logo: { file: string; x: number; y: number; w: number; h: number };
  date: Record<string, number>;
  time: Record<string, number>;
  textShadow: ShadowStyle;
  logoShadow: ShadowStyle;
  samples: { id: string; datetime: string }[];
}

/** Place original glyph PNGs using v1.1's ink bearings, advances, and per-glyph Y. */
export function layoutStamp(data: StampData, time: Wall): Element[] {
  const line = (text: string, date: boolean): Element[] => {
    const metrics = date ? data.date : data.time;
    let cursor = date ? 170 : 172;
    const placed: Element[] = [];
    for (const token of text.match(/\([^)]*\)|오전|오후|\s|./gu) ?? []) {
      if (token === ' ') { cursor += metrics['advance: ']; continue; }
      const category = token.startsWith('(') ? 'weekday_token' : token.startsWith('오') ? 'period_token' : date ? 'date_glyph' : 'time_glyph';
      const key = `${category}:${token}`;
      const glyph = data.glyphs[key];
      if (!glyph || !Number.isFinite(metrics['bearing:' + token])) throw new Error('스탬프 글자 자료가 없습니다: ' + key);
      placed.push({ key, x: cursor + metrics['bearing:' + token] - glyph.coreLeft, y: glyph.y, w: glyph.w, h: glyph.h });
      const group = /^[0-9]/.test(token) ? 'digit' : token.startsWith('오') ? 'period' : token;
      cursor += metrics['advance:' + group] ?? 0;
    }
    return placed;
  };
  return [...line(stampDate(time), true), ...line(stampTime(time), false)];
}

/** Preserve the complete finite support of v1.1's three box-filter shadow. */
export function shadowTile(elements: Element[], sigma: number) {
  const padding = boxWidths(sigma).reduce((sum, width) => sum + (width - 1) / 2, 3);
  const left = Math.floor(Math.min(...elements.map((e) => e.x))) - padding;
  const top = Math.floor(Math.min(...elements.map((e) => e.y))) - padding;
  return {
    left, top,
    width: Math.ceil(Math.max(...elements.map((e) => e.x + e.w))) - left + padding,
    height: Math.ceil(Math.max(...elements.map((e) => e.y + e.h))) - top + padding,
  };
}

/** .NET Math.Round default (banker's rounding), kept from the original shadow port. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Three box-filter widths whose combination approximates a Gaussian of `sigma`. */
export function boxWidths(sigma: number): number[] {
  let lower = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
  if (lower % 2 === 0) lower--;
  lower = Math.max(1, lower);
  const lowerCount = roundHalfEven((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return [0, 1, 2].map((i) => (i < lowerCount ? lower : lower + 2));
}

export function blurAlpha(alpha: Float32Array, width: number, height: number, sigma: number): void {
  const work = new Float32Array(alpha.length);
  for (const w of boxWidths(sigma)) {
    boxHorizontal(alpha, work, width, height, w);
    boxVertical(work, alpha, width, height, w);
  }
}

function boxHorizontal(src: Float32Array, dst: Float32Array, width: number, height: number, boxWidth: number) {
  const radius = boxWidth >> 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= radius && x < width; x++) sum += src[row + x];
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum / boxWidth;
      const remove = x - radius, add = x + radius + 1;
      if (remove >= 0) sum -= src[row + remove];
      if (add < width) sum += src[row + add];
    }
  }
}

function boxVertical(src: Float32Array, dst: Float32Array, width: number, height: number, boxWidth: number) {
  const radius = boxWidth >> 1;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y <= radius && y < height; y++) sum += src[y * width + x];
    for (let y = 0; y < height; y++) {
      dst[y * width + x] = sum / boxWidth;
      const remove = y - radius, add = y + radius + 1;
      if (remove >= 0) sum -= src[remove * width + x];
      if (add < height) sum += src[add * width + x];
    }
  }
}
