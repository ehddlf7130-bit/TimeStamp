// Draws the stamp: Korean date/time bottom-left and a label with a clock mark top-right,
// white with a soft black halo, laid out on a 3240px reference square and scaled to the output.
import { stampDate, stampTime, type Wall } from '../core/patrol';
import { blurAlpha, cleanLabel, DEFAULT_LABEL } from './layout';

const REF = 3240;
const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif';
/** Shadows are computed on a quarter-size canvas; they are soft, so this costs nothing visible. */
const SHADOW_RES = 810;
const TEXT_SHADOW = { sigma: 35, opacity: 0.38 };
const LOGO_SHADOW = { sigma: 45, opacity: 0.3 };

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Free a canvas's backing store right away (iOS Safari caps total canvas memory). */
export function release(c: HTMLCanvasElement) { c.width = 0; c.height = 0; }

function context(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

export interface Crop { sx: number; sy: number; s: number }

function drawText(ctx: CanvasRenderingContext2D, time: Wall) {
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 168px ${FONT}`;
  ctx.fillText(stampDate(time), 172, 2598);
  ctx.fillText(stampTime(time), 172, 2800);
}

function drawLogo(ctx: CanvasRenderingContext2D, label: string) {
  const cx = 2972, cy = 302, r = 64;
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 15;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 40); ctx.moveTo(cx, cy); ctx.lineTo(cx + 30, cy + 16); ctx.stroke();
  if (!label) return;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `700 112px ${FONT}`;
  ctx.fillText(label, cx - r - 40, cy + 6, 2000);
}

export class StampRenderer {
  private labelText = DEFAULT_LABEL;
  private shadowKey = '';
  private textShadow?: HTMLCanvasElement;
  private logoShadow?: HTMLCanvasElement;

  get label() { return this.labelText; }
  set label(v: string) { this.labelText = cleanLabel(v); }

  private makeShadow(draw: (ctx: CanvasRenderingContext2D) => void, style: { sigma: number; opacity: number }) {
    const c = makeCanvas(SHADOW_RES, SHADOW_RES);
    const ctx = context(c, { willReadFrequently: true });
    ctx.scale(SHADOW_RES / REF, SHADOW_RES / REF);
    draw(ctx);
    const img = ctx.getImageData(0, 0, SHADOW_RES, SHADOW_RES);
    const d = img.data;
    const alpha = new Float32Array(SHADOW_RES * SHADOW_RES);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    blurAlpha(alpha, SHADOW_RES, SHADOW_RES, (style.sigma * SHADOW_RES) / REF);
    for (let i = 0; i < alpha.length; i++) {
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
      d[i * 4 + 3] = Math.min(255, Math.round(alpha[i] * style.opacity));
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Stamp layer (no photo) onto ctx, which is `size` pixels square. */
  private drawStamp(ctx: CanvasRenderingContext2D, time: Wall, size: number) {
    const key = `${stampDate(time)} ${stampTime(time)}`;
    if (this.shadowKey !== key + '|' + this.labelText) {
      for (const c of [this.textShadow, this.logoShadow]) if (c) release(c);
      this.textShadow = this.makeShadow((g) => drawText(g, time), TEXT_SHADOW);
      this.logoShadow = this.makeShadow((g) => drawLogo(g, this.labelText), LOGO_SHADOW);
      this.shadowKey = key + '|' + this.labelText;
    }
    ctx.drawImage(this.logoShadow!, 0, 0, size, size);
    ctx.drawImage(this.textShadow!, 0, 0, size, size);
    ctx.save();
    ctx.scale(size / REF, size / REF);
    drawLogo(ctx, this.labelText);
    drawText(ctx, time);
    ctx.restore();
  }

  /** Stamp a square crop of `source` at `size`×`size`. */
  render(source: CanvasImageSource, crop: Crop, time: Wall, size: number): HTMLCanvasElement {
    if (crop.s < 1) throw new Error('사진 크기가 올바르지 않습니다.');
    if (size < 1 || size > 12000) throw new RangeError('size');
    const canvas = makeCanvas(size, size);
    const ctx = context(canvas);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, crop.sx, crop.sy, crop.s, crop.s, 0, 0, size, size);
    this.drawStamp(ctx, time, size);
    return canvas;
  }

  /** Transparent stamp-only layer for the live camera preview. */
  renderOverlay(target: HTMLCanvasElement, time: Wall) {
    const ctx = context(target);
    ctx.clearRect(0, 0, target.width, target.height);
    this.drawStamp(ctx, time, target.width);
  }
}

/** Largest centred square of a w×h image. */
export function centerCrop(w: number, h: number): Crop {
  const s = Math.min(w, h);
  return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), s };
}

export function canvasToBlob(canvas: HTMLCanvasElement, png: boolean): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 저장하지 못했습니다. 출력 크기를 줄여 보세요.'))), png ? 'image/png' : 'image/jpeg', 0.95),
  );
}
