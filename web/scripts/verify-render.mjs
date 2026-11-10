// Renderer checks plus production-browser flows, including a GitHub Pages subpath.
// Uses installed Edge/Chrome, BROWSER, or `npx playwright-core install chromium`.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(web, '.checks', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
if (!existsSync(join(web, 'dist/index.html'))) throw new Error('Run npm run build before npm run verify.');
const executablePath = process.env.BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', chromium.executablePath(),
].find(existsSync);
if (!executablePath) throw new Error('Install Chromium with npx playwright-core install chromium or set BROWSER.');

const lines = [];
let failed = 0;
const check = (ok, name) => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}`;
  console.log(line); lines.push(line);
  if (!ok) failed++;
};
process.env.NO_SSL = '1';
let server;
let production;
let browser;
const errors = [];
try {
  browser = await chromium.launch({
    executablePath, headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  server = await createServer({ root: web, configFile: join(web, 'vite.config.ts'), server: { port: 5199, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const diagnostics = await browser.newPage();
  await diagnostics.goto('http://127.0.0.1:5199/verify.html');
  await diagnostics.waitForFunction(() => window.__results || window.__error);
  const error = await diagnostics.evaluate(() => window.__error);
  if (error) throw new Error(error);
  for (const r of await diagnostics.evaluate(() => window.__results)) {
    check(r.ok, r.name + (r.stampMean === undefined ? '' : ` (stamp-area mean ${r.stampMean.toFixed(3)}/255; max ${r.max}/255)`));
  }
  const originalPreview = await diagnostics.evaluate(() => window.__stampPreview);
  if (originalPreview) writeFileSync(join(out, 'v1.1-web-1080.png'), Buffer.from(originalPreview.split(',')[1], 'base64'));
  await diagnostics.close();
  await server.close(); server = undefined;

  production = await preview({ root: web, base: '/TimeStamp/', configFile: join(web, 'vite.config.ts'), preview: { port: 5199, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ['camera'], acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());
  const tab = (label) => page.locator('nav.tabs button', { hasText: label }).click();
  const visible = () => page.locator('section.page:visible');
  const clock = (iso) => page.clock.setFixedTime(new Date(iso));
  const zipFiles = async (button) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const files = unzipSync(new Uint8Array(readFileSync(await dl.path())));
    return files;
  };

  await clock('2026-11-09T11:05:10Z');
  await page.goto('http://127.0.0.1:5199/TimeStamp/');
  await page.waitForSelector('nav.tabs');
  check(true, 'production app boots under /TimeStamp/');
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    return (await fetch(link.href)).json();
  });
  check(manifest.start_url === './' && manifest.scope === './', 'home-screen manifest stays within the project path');
  await tab('계산기');
  await visible().locator('.chip', { hasText: '20:00~01:00' }).click();
  check(await visible().locator('.result .big strong').textContent() === '60', 'calculator: overnight patrol requires 60 photos');
  await page.screenshot({ path: join(out, 'mobile-calculator.png'), fullPage: true });

  await tab('순찰 촬영');
  await visible().locator('input[type=date]').fill('2026-11-09');
  await visible().locator('input[type=time]').nth(0).fill('23:00');
  await visible().locator('input[type=time]').nth(1).fill('23:30');
  check(await visible().locator('input[type=text]').count() === 0, 'the original v1.1 logo is fixed without a replacement label field');
  await visible().getByRole('button', { name: '순찰 시작', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  const capture = async () => {
    await page.locator('.shutter').click();
    await page.waitForFunction(() => !document.querySelector('.shutter').classList.contains('working'));
  };
  const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('patrol-camera', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(['shots', 'meta'], 'readonly');
      const shots = t.objectStore('shots').getAll();
      const session = t.objectStore('meta').get('session');
      t.oncomplete = () => {
        resolve({ shots: shots.result.map(({ id, time, slotIndex }) => ({ id, time, slotIndex })), nextSlot: session.result?.nextSlot });
        db.close();
      };
      t.onerror = () => reject(t.error);
    };
  }));
  const title = () => page.locator('.cam-title').innerText();
  check((await title()).includes('1 / 6') && (await title()).includes('오후 11:05'), '23:00–23:30 starts at planned 23:05 despite the clock being 20:05');
  await page.evaluate(() => {
    window.__stampGlyphFiles = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.width === 1080 && args[0] instanceof HTMLImageElement) {
        window.__stampGlyphFiles.push(args[0].src.split('/stamp/')[1]);
      }
      return draw.apply(this, args);
    };
    // Fail the session write after the photo write has been queued: both must roll back.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Simulated full storage', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
  await capture();
  const failedCapture = await stored();
  check(failedCapture.shots.length === 0 && failedCapture.nextSlot === 0 && (await title()).includes('1 / 6'), 'a failed save rolls back the photo and does not advance the planned time');
  await capture();
  check((await title()).includes('2 / 6') && (await title()).includes('오후 11:10'), 'first saved photo advances immediately to 23:10');
  check(await page.evaluate(() => window.__stampGlyphFiles.includes('assets/logo.png') && window.__stampGlyphFiles.slice(-6).join() === [
    'assets/canonical/period_token/c624_d6c4.png', 'assets/canonical/time_glyph/0031.png', 'assets/canonical/time_glyph/0031.png',
    'assets/canonical/time_glyph/003a.png', 'assets/canonical/time_glyph/0030.png', 'assets/canonical/time_glyph/0035.png',
  ].join()), 'the exported canvas uses the original logo and glyph PNGs for planned 23:05');
  await capture();
  await capture();
  check(await page.locator('.cam-strip .cell.taken').count() === 3 && (await title()).includes('오후 11:20'), 'three immediate captures advance to 23:20 without waiting five minutes');
  const shutterBox = await page.locator('.shutter').boundingBox();
  const thumbnailBox = await page.locator('.cam-last').boundingBox();
  check(Math.abs(shutterBox.x + shutterBox.width / 2 - 195) < 2 && thumbnailBox.x + thumbnailBox.width < shutterBox.x,
    'the shutter stays centered and the gallery thumbnail does not overlap it');
  await page.screenshot({ path: join(out, 'mobile-camera.png') });
  const beforeRetake = await stored();
  await page.locator('.cam-strip .cell').nth(1).click();
  check((await title()).includes('오후 11:10') && (await title()).includes('다시 찍기'), 'tapping a filled time selects it for retaking');
  await capture();
  const afterRetake = await stored();
  check(afterRetake.shots.length === 3 && afterRetake.shots.map((s) => s.id).join() === beforeRetake.shots.map((s) => s.id).join() && (await title()).includes('오후 11:20'), 'retake replaces one photo and returns to the next pending time');
  await page.reload();
  await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 3, 'reload restores the session and three planned photos');
  await page.screenshot({ path: join(out, 'mobile-gallery.png'), fullPage: true });
  await visible().getByRole('button', { name: '이어서 촬영', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  check((await title()).includes('4 / 6') && (await title()).includes('오후 11:20'), 'resuming after reload continues at planned 23:20');
  for (let i = 0; i < 3; i++) await capture();
  await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 6 && (await stored()).nextSlot === 6, 'the sixth photo completes the plan and opens the gallery without a seventh slot');
  check(await page.evaluate(() => document.querySelector('.camera video').srcObject === null), 'completing the plan releases the camera');
  const files = await zipFiles(visible().getByRole('button', { name: 'ZIP 다운로드', exact: true }));
  const names = Object.keys(files).sort();
  check(names.join() === '001_20261109_2305.jpg,002_20261109_2310.jpg,003_20261109_2315.jpg,004_20261109_2320.jpg,005_20261109_2325.jpg,006_20261109_2330.jpg', 'patrol ZIP contains all six planned times from 23:05 through 23:30');
  const first = files[names[0]];
  check(first[0] === 0xff && first[1] === 0xd8 && first.length > 10_000, 'patrol ZIP contains real JPEG photos');
  writeFileSync(join(out, 'patrol-001.jpg'), first);

  await visible().locator('.grid .tile').nth(1).click();
  await page.locator('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  check(await visible().locator('.grid .tile').count() === 5, 'deleting a planned photo leaves its time available');
  await visible().getByRole('button', { name: '이어서 촬영', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  check((await title()).includes('오후 11:10'), 'resuming a completed plan after deletion finds the missing 23:10 slot');
  await capture();
  check(await visible().locator('.grid .tile').count() === 6, 'replacing the deleted time completes the plan again');

  await visible().getByRole('button', { name: '새 순찰 시작', exact: true }).click();
  await visible().locator('input[type=time]').nth(0).fill('23:50');
  await visible().locator('input[type=time]').nth(1).fill('00:10');
  await visible().getByRole('button', { name: '순찰 시작', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  check((await title()).includes('1 / 4') && (await title()).includes('오후 11:55'), 'starting an overnight plan replaces the camera time strip');
  for (let i = 0; i < 4; i++) await capture();
  const overnight = await zipFiles(visible().getByRole('button', { name: 'ZIP 다운로드', exact: true }));
  check(Object.keys(overnight).sort().join() === '001_20261109_2355.jpg,002_20261110_0000.jpg,003_20261110_0005.jpg,004_20261110_0010.jpg', 'planned captures roll over the date at midnight');

  // Restore a session created by the old real-time version, retaining its actual photo bytes.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('patrol-camera', 1);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction(['shots', 'meta'], 'readwrite');
      const s = t.objectStore('shots');
      const read = s.getAll();
      read.onsuccess = () => {
        const old = read.result[0];
        s.clear();
        s.put({ id: 1, time: Date.UTC(2026, 10, 9, 20, 5), blob: old.blob, thumb: old.thumb });
        t.objectStore('meta').put({ date: '2026-11-09', start: '23:00', end: '23:30', size: 1080, autoShare: false }, 'session');
      };
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  }));
  await page.reload();
  await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 1 && (await visible().innerText()).includes('이전 버전에서 찍은 사진 1장'), 'old real-time photos remain available after updating');
  await visible().getByRole('button', { name: '이어서 촬영', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  check((await title()).includes('1 / 6') && (await title()).includes('오후 11:05'), 'an old session resumes the new planned sequence at its first time');
  await capture();
  const migrated = await stored();
  check(migrated.shots.length === 2 && migrated.shots.some((s) => s.id === 1 && s.time === Date.UTC(2026, 10, 9, 20, 5) && s.slotIndex === undefined), 'new planned captures do not overwrite legacy photos or change their recorded time');
  await page.locator('.cam-top').getByRole('button', { name: '보관함', exact: true }).click();

  // Generate fixtures in the browser so CI never needs the user's source photos.
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#476d85'; g.fillRect(0, 0, 256, 256);
    const square = c.toDataURL('image/png').split(',')[1];
    c.width = 384;
    return { square, rectangle: c.toDataURL('image/png').split(',')[1] };
  });
  await tab('스탬프 찍기');
  await visible().locator('input[type=date]').fill('2026-11-09');
  await visible().locator('input[type=time]').nth(0).fill('00:00');
  await visible().locator('input[type=time]').nth(1).fill('00:30');
  await visible().getByRole('button', { name: '시간 적용', exact: true }).click();
  await visible().locator('input[type=file]').setInputFiles([
    ...Array.from({ length: 6 }, (_, i) => ({ name: `${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(image.square, 'base64') })),
    { name: 'not-square.png', mimeType: 'image/png', buffer: Buffer.from(image.rectangle, 'base64') },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.strip .thumb').length === 6 && !document.querySelector('section.page:not([hidden])').classList.contains('busy'));
  check(await visible().locator('.strip .thumb').count() === 6, 'batch accepts six square photos and rejects a non-square photo');
  await visible().getByRole('button', { name: '순서대로', exact: true }).click();
  check((await visible().locator('.card-head .muted').nth(1).textContent()).includes('모두 배치됨'), 'sequential batch placement fills every slot');
  const batchZip = await zipFiles(visible().getByRole('button', { name: 'ZIP 다운로드', exact: true }));
  const batchNames = Object.keys(batchZip).sort();
  check(batchNames.length === 6 && batchNames[0] === '001_20261109_0005.jpg' && batchNames[5] === '006_20261109_0030.jpg', 'batch ZIP names follow planned times');
  writeFileSync(join(out, 'batch-001.jpg'), batchZip[batchNames[0]]);
  await page.screenshot({ path: join(out, 'mobile-batch.png'), fullPage: true });
  await visible().locator('.strip .thumb').nth(0).click();
  await visible().locator('.slot').nth(1).click();
  await visible().getByRole('button', { name: '선택 사진을 이 시간에 배치', exact: true }).click();
  check(await visible().locator('.slot:not(.empty)').count() === 6, 'manual placement swaps occupied slots without losing a photo');
  await visible().getByRole('button', { name: '랜덤 배치', exact: true }).click();
  check(await visible().locator('.slot:not(.empty)').count() === 6, 'random placement fills all six slots');
  await visible().locator('select').nth(1).selectOption('png');
  const pngZip = await zipFiles(visible().getByRole('button', { name: 'ZIP 다운로드', exact: true }));
  check(Object.keys(pngZip).length === 6 && Object.values(pngZip).every((b) => b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71), 'PNG export contains six valid PNG images');
  check(errors.length === 0, 'no browser errors or failed HTTP responses' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
} catch (e) {
  check(false, e.stack ?? String(e));
} finally {
  await browser?.close();
  await server?.close();
  if (production) await new Promise((resolve, reject) => production.httpServer.close((e) => e ? reject(e) : resolve()));
  writeFileSync(join(out, 'results.txt'), lines.join('\n') + '\n');
}
console.log(failed ? `${failed} check(s) failed` : `${lines.length} checks passed`);
console.log(`Artifacts: ${out}`);
process.exitCode = failed ? 1 : 0;
