// DOM-free helpers: the three-box Gaussian approximation used for the stamp's soft shadow.

/** .NET Math.Round default (banker's rounding), kept from the original shadow port. */
function roundHalfEven(x: number): number {
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

export const DEFAULT_LABEL = '순찰 기록';
export const MAX_LABEL = 16;

export function cleanLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}
