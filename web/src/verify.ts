// Browser checks for the current font-based renderer. No WPF fixtures are required.
import { wall } from './core/patrol';
import { centerCrop, makeCanvas, release, StampRenderer } from './stamp/renderer';

interface Result { name: string; ok: boolean }
const results: Result[] = [];
const check = (name: string, ok: boolean) => results.push({ name, ok });

function run() {
  const renderer = new StampRenderer();
  const time = wall(2026, 11, 9, 20, 5);
  check('landscape crop is centered', JSON.stringify(centerCrop(1920, 1080)) === JSON.stringify({ sx: 420, sy: 0, s: 1080 }));
  check('portrait crop is centered', JSON.stringify(centerCrop(1080, 1920)) === JSON.stringify({ sx: 0, sy: 420, s: 1080 }));

  for (const size of [640, 1080, 1536, 3240]) {
    const overlay = makeCanvas(size, size);
    renderer.renderOverlay(overlay, time);
    const g = overlay.getContext('2d', { willReadFrequently: true })!;
    const pixels = g.getImageData(0, 0, size, size).data;
    let dateInk = 0, logoInk = 0, shadow = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (pixels[i] > 200 && pixels[i + 3] > 200) {
        if (y > size * 0.7 && x < size * 0.8) dateInk++;
        if (y < size * 0.2 && x > size * 0.3) logoInk++;
      }
      if (pixels[i] === 0 && pixels[i + 3] > 0) shadow++;
    }
    check(`${size}px date and time are visible`, dateInk > size);
    check(`${size}px label and clock are visible`, logoInk > size / 4);
    check(`${size}px soft black shadow is present`, shadow > size);
    check(`${size}px photo center stays transparent`, g.getImageData(size / 2, size / 2, 1, 1).data[3] === 0);
    release(overlay);
  }

  const photo = makeCanvas(8, 8);
  const pg = photo.getContext('2d')!;
  pg.fillStyle = '#336699'; pg.fillRect(0, 0, 8, 8);
  const out = renderer.render(photo, centerCrop(8, 8), time, 1080);
  check('export preserves the photo away from the stamp',
    [...out.getContext('2d')!.getImageData(540, 540, 1, 1).data].join() === '51,102,153,255');
  const overlay = makeCanvas(1080, 1080);
  renderer.renderOverlay(overlay, time);
  const before = overlay.toDataURL();
  renderer.label = '경비 순찰';
  renderer.renderOverlay(overlay, time);
  check('changing the label updates the stamp', overlay.toDataURL() !== before);
  release(photo); release(out); release(overlay);

  (window as unknown as { __results: Result[] }).__results = results;
  document.getElementById('out')!.textContent = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`).join('\n');
}

try { run(); } catch (e) {
  (window as unknown as { __error: string }).__error = String(e);
  document.getElementById('out')!.textContent = String(e);
}
