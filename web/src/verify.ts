// Compare against PNGs produced by the user's saved TimeStamp-v1.1 executable.
import { wall, type Wall } from './core/patrol';
import { centerCrop, makeCanvas, release, StampRenderer } from './stamp/renderer';

interface Result { name: string; ok: boolean; stampMean?: number; fullMean?: number; max?: number }
const results: Result[] = [];
const check = (name: string, ok: boolean) => results.push({ name, ok });

async function compare(renderer: StampRenderer, file: string, time: Wall, size: number, white = false) {
  const source = makeCanvas(8, 8);
  const sourceContext = source.getContext('2d')!;
  sourceContext.fillStyle = white ? '#fff' : '#000'; sourceContext.fillRect(0, 0, 8, 8);
  const actual = renderer.render(source, centerCrop(8, 8), time, size);
  const referenceImage = new Image();
  referenceImage.src = new URL('./tests/fixtures/v1.1/' + file, document.baseURI).href;
  await referenceImage.decode();
  if (referenceImage.naturalWidth !== size || referenceImage.naturalHeight !== size) throw new Error('Reference size mismatch: ' + file);
  const reference = makeCanvas(size, size);
  reference.getContext('2d')!.drawImage(referenceImage, 0, 0);
  const a = actual.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
  const b = reference.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, size, size).data;
  const background = white ? 255 : 0;
  let sum = 0, stampSum = 0, stampPixels = 0, max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const difference = Math.abs(a[i] - b[i]);
    sum += difference; max = Math.max(max, difference);
    if (Math.abs(a[i] - background) > 2 || Math.abs(b[i] - background) > 2) {
      stampSum += difference; stampPixels++;
    }
  }
  const stampMean = stampSum / stampPixels;
  // Original PNG bytes/coordinates are independently locked by unit tests. Canvas
  // edge interpolation differs across Windows Edge and Linux Chromium (observed
  // native-size maxima: 1 and 8/255); keep a narrow cross-platform edge allowance.
  const tolerance = size === 3240 ? 0.5 : white ? 1 : size === 1080 ? 6 : 5;
  results.push({ name: 'v1.1 pixel comparison: ' + file,
    ok: Number.isFinite(stampMean) && stampMean < tolerance && (size !== 3240 || max <= 10),
    stampMean, fullMean: sum / (size * size), max });
  if (file === 'stamp-1080.png') {
    (window as unknown as { __stampPreview: string }).__stampPreview = actual.toDataURL('image/png');
  }
  release(source); release(actual); release(reference);
}

async function run() {
  const renderer = await StampRenderer.load();
  check('landscape crop is centered', JSON.stringify(centerCrop(1920, 1080)) === JSON.stringify({ sx: 420, sy: 0, s: 1080 }));
  check('portrait crop is centered', JSON.stringify(centerCrop(1080, 1920)) === JSON.stringify({ sx: 0, sy: 420, s: 1080 }));
  for (const sample of renderer.data.samples) {
    const [date, time] = sample.datetime.split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    await compare(renderer, sample.id + '-dynamic.png', wall(y, mo, d, hh, mm), 3240);
  }
  for (const size of [1080, 1536, 3240]) {
    await compare(renderer, 'stamp-' + size + '.png', wall(2026, 11, 9, 0, 5), size);
  }
  await compare(renderer, 'white-background.png', wall(2027, 3, 3, 9, 7), 1080, true);

  // At equal viewing size the 1080/1536 stamp must retain the edge weight and
  // placement of the 3240 original, including the date/time from the reported case.
  const black = makeCanvas(8, 8); black.getContext('2d')!.fillRect(0, 0, 8, 8);
  const sampleTime = wall(2026, 11, 11, 0, 35);
  const native = renderer.render(black, centerCrop(8, 8), sampleTime, 3240);
  for (const size of [1080, 1536]) {
    const expected = makeCanvas(size, size), g = expected.getContext('2d')!;
    g.imageSmoothingQuality = 'high'; g.drawImage(native, 0, 0, size, size);
    const actual = renderer.render(black, centerCrop(8, 8), sampleTime, size);
    const a = actual.getContext('2d')!.getImageData(0, 0, size, size).data;
    const b = g.getImageData(0, 0, size, size).data;
    let max = 0;
    for (let i = 0; i < a.length; i += 4) max = Math.max(max, Math.abs(a[i] - b[i]));
    check(`${size}px stamp matches the reduced 3240 original (max ${max}/255)`, max <= 1);
    release(expected); release(actual);
  }
  release(black); release(native);

  const photo = makeCanvas(8, 8);
  const pg = photo.getContext('2d')!; pg.fillStyle = '#336699'; pg.fillRect(0, 0, 8, 8);
  const time = wall(2026, 11, 9, 23, 5);
  const out = renderer.render(photo, centerCrop(8, 8), time, 1080);
  check('export preserves the photo away from the stamp', [...out.getContext('2d')!.getImageData(540, 540, 1, 1).data].join() === '51,102,153,255');
  const overlay = makeCanvas(1080, 1080);
  renderer.renderOverlay(overlay, time);
  check('camera overlay leaves the photo center transparent', overlay.getContext('2d')!.getImageData(540, 540, 1, 1).data[3] === 0);
  release(photo); release(out); release(overlay);

  (window as unknown as { __results: Result[] }).__results = results;
  document.getElementById('out')!.textContent = results.map((r) => (r.ok ? 'PASS' : 'FAIL') + ' ' + r.name).join('\n');
}

run().catch((e) => {
  (window as unknown as { __error: string }).__error = String(e);
  document.getElementById('out')!.textContent = String(e);
});
