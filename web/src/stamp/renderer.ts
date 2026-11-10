// The original v1.1 logo and glyph PNGs, bearings, coordinates, and calibrated shadows.
import { stampDate, stampTime, type Wall } from '../core/patrol';
import { blurAlpha, layoutStamp, roundHalfEven, shadowTile, type Element, type ShadowStyle, type StampData } from './layout';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Free backing stores promptly on Safari. */
export function release(c: HTMLCanvasElement) { c.width = 0; c.height = 0; }

function context(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

export interface Crop { sx: number; sy: number; s: number }
interface Shadow { canvas: HTMLCanvasElement; left: number; top: number; width: number; height: number }

export class StampRenderer {
  private shadowKey = '';
  private textShadow?: Shadow;
  private logoShadow?: Shadow;
  private readonly logo: Element;

  private constructor(readonly data: StampData, private images: Map<string, HTMLImageElement>) {
    this.logo = { key: 'logo', ...data.logo };
  }

  static async load(): Promise<StampRenderer> {
    const root = new URL('stamp/', new URL(import.meta.env.BASE_URL, document.baseURI));
    const response = await fetch(new URL('stamp-data.json', root));
    if (!response.ok) throw new Error('원본 스탬프 자료를 불러오지 못했습니다.');
    const data = await response.json() as StampData;
    if (data.referenceSize !== 3240 || !data.glyphs || !data.logo) throw new Error('스탬프 자료 형식이 올바르지 않습니다.');
    const images = new Map<string, HTMLImageElement>();
    await Promise.all([...Object.entries(data.glyphs), ['logo', data.logo] as const].map(async ([key, asset]) => {
      const img = new Image();
      img.src = new URL(asset.file, root).href;
      await img.decode();
      if (img.naturalWidth !== asset.w || img.naturalHeight !== asset.h) throw new Error('원본 스탬프 이미지 크기가 다릅니다: ' + key);
      images.set(key, img);
    }));
    return new StampRenderer(data, images);
  }

  private drawElements(ctx: CanvasRenderingContext2D, elements: Element[]) {
    for (const e of elements) ctx.drawImage(this.images.get(e.key)!, e.x, e.y, e.w, e.h);
  }

  private makeShadow(elements: Element[], style: ShadowStyle): Shadow {
    const tile = shadowTile(elements, style.sigmaPixels);
    const canvas = makeCanvas(tile.width, tile.height);
    const ctx = context(canvas, { willReadFrequently: true });
    ctx.translate(-tile.left, -tile.top);
    this.drawElements(ctx, elements);
    const img = ctx.getImageData(0, 0, tile.width, tile.height);
    const alpha = new Float32Array(tile.width * tile.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    blurAlpha(alpha, tile.width, tile.height, style.sigmaPixels);
    for (let i = 0; i < alpha.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = Math.min(255, roundHalfEven(alpha[i] * style.opacity));
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, ...tile };
  }

  private drawStamp(ctx: CanvasRenderingContext2D, time: Wall, size: number) {
    const elements = layoutStamp(this.data, time);
    this.logoShadow ??= this.makeShadow([this.logo], this.data.logoShadow);
    const key = `${stampDate(time)} ${stampTime(time)}`;
    if (key !== this.shadowKey) {
      if (this.textShadow) release(this.textShadow.canvas);
      this.textShadow = this.makeShadow(elements, this.data.textShadow);
      this.shadowKey = key;
    }
    ctx.save();
    ctx.scale(size / this.data.referenceSize, size / this.data.referenceSize);
    for (const shadow of [this.logoShadow, this.textShadow!]) {
      ctx.drawImage(shadow.canvas, shadow.left, shadow.top, shadow.width, shadow.height);
    }
    this.drawElements(ctx, [this.logo, ...elements]);
    ctx.restore();
  }

  render(source: CanvasImageSource, crop: Crop, time: Wall, size: number): HTMLCanvasElement {
    if (crop.s < 1) throw new Error('사진 크기가 올바르지 않습니다.');
    if (size < 1 || size > 12000) throw new RangeError('size');
    const canvas = makeCanvas(size, size);
    const ctx = context(canvas);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, crop.sx, crop.sy, crop.s, crop.s, 0, 0, size, size);
    this.drawStamp(ctx, time, size);
    return canvas;
  }

  renderOverlay(target: HTMLCanvasElement, time: Wall) {
    const ctx = context(target);
    ctx.clearRect(0, 0, target.width, target.height);
    this.drawStamp(ctx, time, target.width);
  }
}

export function centerCrop(w: number, h: number): Crop {
  const s = Math.min(w, h);
  return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), s };
}

export function canvasToBlob(canvas: HTMLCanvasElement, png: boolean): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 저장하지 못했습니다. 출력 크기를 줄여 보세요.'))), png ? 'image/png' : 'image/jpeg', 0.95),
  );
}
