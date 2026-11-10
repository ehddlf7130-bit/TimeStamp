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
  for (const r of await diagnostics.evaluate(() => window.__results)) check(r.ok, r.name);
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
  await visible().locator('input[type=time]').nth(0).fill('20:00');
  await visible().locator('input[type=time]').nth(1).fill('20:30');
  const patrolLabel = visible().locator('input[type=text]');
  await patrolLabel.fill('야간 순찰');
  await patrolLabel.blur();
  check(await page.evaluate(() => localStorage.getItem('stampLabel')) === '야간 순찰', 'editing the label persists it');
  await tab('스탬프 찍기');
  check(await visible().locator('input[type=text]').inputValue() === '야간 순찰', 'batch and camera label fields stay in sync');
  await tab('순찰 촬영');
  await visible().getByRole('button', { name: '순찰 시작', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  const capture = async (iso) => {
    await clock(iso);
    await page.locator('.shutter').click();
    await page.waitForFunction(() => !document.querySelector('.shutter').classList.contains('working'));
  };
  await capture('2026-11-09T11:05:10Z');
  await page.waitForFunction(() => document.querySelector('.cam-title')?.textContent.includes('확인 1 / 6'));
  check(await page.locator('.cam-strip .cell.taken').count() === 1, 'live photo confirms the current patrol slot');
  await capture('2026-11-09T11:05:30Z');
  check(await page.locator('.cam-strip .cell.taken').count() === 1, 'two photos in one window confirm only one slot');
  await capture('2026-11-09T11:10:20Z');
  check(await page.locator('.cam-strip .cell.taken').count() === 2, 'a later real-time photo confirms the next slot');
  const shutterBox = await page.locator('.shutter').boundingBox();
  const thumbnailBox = await page.locator('.cam-last').boundingBox();
  check(Math.abs(shutterBox.x + shutterBox.width / 2 - 195) < 2 && thumbnailBox.x + thumbnailBox.width < shutterBox.x,
    'the shutter stays centered and the gallery thumbnail does not overlap it');
  await page.screenshot({ path: join(out, 'mobile-camera.png') });
  await capture('2026-11-09T11:40:00Z');
  check(await page.locator('.cam-strip .cell.taken').count() === 2, 'outside-window photos do not confirm a patrol slot');
  await page.locator('.cam-top').getByRole('button', { name: '보관함', exact: true }).click();
  check(await visible().locator('.grid .tile').count() === 4, 'all four photos, including repeated and outside-window shots, are retained');
  check(await page.evaluate(() => document.querySelector('.camera video').srcObject === null), 'leaving the camera releases the media stream');
  await page.reload();
  await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 4, 'reload restores the session and all photos from IndexedDB');
  await page.screenshot({ path: join(out, 'mobile-gallery.png'), fullPage: true });
  const files = await zipFiles(visible().getByRole('button', { name: 'ZIP 다운로드', exact: true }));
  const names = Object.keys(files).sort();
  check(names.join() === '001_20261109_200510.jpg,002_20261109_200530.jpg,003_20261109_201020.jpg,004_20261109_204000.jpg', 'patrol ZIP uses actual Korean capture times, including seconds');
  const first = files[names[0]];
  check(first[0] === 0xff && first[1] === 0xd8 && first.length > 10_000, 'patrol ZIP contains real JPEG photos');
  writeFileSync(join(out, 'patrol-001.jpg'), first);

  await visible().getByRole('button', { name: '새 순찰 시작', exact: true }).click();
  check(await visible().locator('input[type=text]').inputValue() === '야간 순찰', 'reload restores the saved label');
  await visible().locator('input[type=time]').nth(0).fill('21:00');
  await visible().locator('input[type=time]').nth(1).fill('21:30');
  await visible().getByRole('button', { name: '순찰 시작', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0);
  check((await page.locator('.cam-strip').innerText()).includes('9:05'), 'starting another plan updates the camera time strip');
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
