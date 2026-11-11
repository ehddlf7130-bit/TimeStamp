import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Test production UI with generated photos and a fake camera; never uses personal photos. */
export async function verifyWorkflow(page, out, check) {
  let accept = true;
  page.on('dialog', (dialog) => accept ? dialog.accept() : dialog.dismiss());
  const visible = () => page.locator('section.page:visible');
  const button = (name) => visible().getByRole('button', { name, exact: true });
  const next = () => button('다음').click();
  const back = () => button('이전').click();
  const heading = () => visible().locator('h1:visible').innerText();
  const screenshot = (name) => page.screenshot({ path: join(out, name + '.png'), fullPage: true });
  const configure = async (mode, start, end, task) => {
    await visible().getByLabel('날짜', { exact: true }).fill('2026-11-11');
    await visible().getByLabel('시간 지정 방식').selectOption(mode);
    await visible().getByLabel(mode === 'single' ? '시각' : '시작', { exact: true }).fill(start);
    if (mode === 'range') await visible().getByLabel('종료', { exact: true }).fill(end);
    await visible().getByRole('radio', { name: task }).check();
  };
  const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('patrol-camera', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction(['shots', 'meta']);
      const shots = tx.objectStore('shots').getAll(), session = tx.objectStore('meta').get('session');
      tx.oncomplete = () => { db.close(); resolve({ shots: shots.result.map(({ id, time, slotIndex }) => ({ id, time, slotIndex })), session: session.result }); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const dimensions = async (bytes) => page.evaluate(async (bytes) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    const size = `${image.width}x${image.height}`; image.close(); return size;
  }, [...bytes]);
  const downloaded = async (locator) => {
    const [download] = await Promise.all([page.waitForEvent('download'), locator.click()]);
    return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
  };
  const shareMode = (mode) => page.evaluate((mode) => {
    window.__shareMode = mode;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => window.__shareMode !== 'unsupported' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
      if (window.__shareMode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
      if (window.__shareMode === 'failure') throw new Error('Simulated sharing failure');
      window.__shared = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, size: file.size, signature: [...new Uint8Array(await file.slice(0, 4).arrayBuffer())] })));
    } });
  }, mode);
  await page.clock.setFixedTime(new Date('2026-11-11T11:05:10Z'));
  await page.goto('http://127.0.0.1:5199/TimeStamp/');
  await page.waitForSelector('[data-page=calc]:visible');
  check(await heading() === '순찰 계산기' && await page.locator('nav.tabs').count() === 0, 'production app starts at the common calculator without free-navigation tabs');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  check(manifest.start_url === './' && manifest.scope === './', 'home-screen manifest stays within the project path');
  await next();
  check(await heading() === '순찰 계산기', 'a task must be selected before advancing');
  await visible().getByRole('radio', { name: '순찰 촬영' }).check();
  await visible().getByLabel('시작', { exact: true }).fill('23:00');
  await visible().getByLabel('종료', { exact: true }).fill('23:00');
  await next();
  check((await visible().locator('.result').innerText()).includes('서로 달라야'), 'invalid range cannot advance');
  await visible().locator('.chip', { hasText: '20:00~01:00' }).click();
  check(await visible().locator('.result .big strong').textContent() === '60', 'overnight calculator still requires 60 photos');
  await screenshot('mobile-calculator');
  await configure('range', '23:00', '23:30', '순찰 촬영'); await next();
  check(await heading() === '촬영 준비' && await visible().locator('input[type=time]:visible').count() === 0, 'patrol preparation shares the calculator plan without asking for times again');
  check(await visible().locator('select').inputValue() === '3240', 'camera defaults to original 3240 resolution');
  await button('순찰 시작').click();
  const cameraReady = () => page.waitForFunction(() => document.querySelector('.camera:not([hidden]) video')?.videoWidth > 0);
  await cameraReady();
  const capture = async () => {
    await page.locator('.shutter').click();
    await page.waitForFunction(() => !document.querySelector('.shutter').classList.contains('working'));
  };
  const title = () => page.locator('.cam-title').innerText();
  check((await title()).includes('1 / 6') && (await title()).includes('오후 11:05'), '23:00–23:30 starts at planned 23:05 regardless of the current clock');
  await page.evaluate(() => {
    window.__stampGlyphFiles = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.width === 3240 && args.length === 9 && args[0] instanceof HTMLCanvasElement) window.__captureCanvas = this.canvas;
      if (this.canvas === window.__captureCanvas && args[0] instanceof HTMLImageElement) window.__stampGlyphFiles.push(args[0].src.split('/stamp/')[1]);
      return draw.apply(this, args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'meta') { IDBObjectStore.prototype.put = put; throw new DOMException('Simulated full storage', 'QuotaExceededError'); }
      return put.apply(this, args);
    };
  });
  await capture();
  check((await stored()).shots.length === 0 && (await stored()).session.nextSlot === 0 && (await title()).includes('1 / 6'), 'failed save rolls back both photo and cursor');
  await capture();
  check((await title()).includes('2 / 6') && (await title()).includes('오후 11:10'), 'first successful shot advances immediately to 23:10');
  check(await page.evaluate(() => window.__stampGlyphFiles.includes('assets/logo.png') && window.__stampGlyphFiles.slice(-6).join() === [
    'assets/canonical/period_token/c624_d6c4.png', 'assets/canonical/time_glyph/0031.png', 'assets/canonical/time_glyph/0031.png',
    'assets/canonical/time_glyph/003a.png', 'assets/canonical/time_glyph/0030.png', 'assets/canonical/time_glyph/0035.png',
  ].join()), 'capture retains original logo and glyph PNGs');
  await capture(); await capture();
  check(await page.locator('.cam-strip .taken').count() === 3 && (await title()).includes('오후 11:20'), 'three immediate captures advance without waiting');
  const shutterBox = await page.locator('.shutter').boundingBox(), thumbnailBox = await page.locator('.cam-last').boundingBox();
  check(Math.abs(shutterBox.x + shutterBox.width / 2 - 195) < 2 && thumbnailBox.x + thumbnailBox.width < shutterBox.x, 'camera controls fit the mobile viewport without overlap');
  await screenshot('mobile-camera');
  await page.goBack();
  check(await heading() === '촬영 준비' && await page.evaluate(() => document.querySelector('.camera video').srcObject === null), 'browser Back from camera releases its stream and returns to preparation');
  await page.goForward(); await cameraReady();
  check((await title()).includes('오후 11:20'), 'browser Forward restores the current patrol camera time');
  const before = await stored();
  await page.locator('.cam-strip .cell').nth(1).click(); await capture();
  check((await stored()).shots.map((s) => s.id).join() === before.shots.map((s) => s.id).join() && (await title()).includes('오후 11:20'), 'retake replaces only its photo and resumes the next pending time');
  await page.reload(); await page.waitForSelector('[data-page=calc]:visible');
  await button('보관함').click(); await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 3, 'reload starts at calculator and restores the saved patrol gallery');
  await screenshot('mobile-gallery');
  await button('이어서 촬영').click(); await cameraReady();
  check((await title()).includes('4 / 6') && (await title()).includes('오후 11:20'), 'saved patrol resumes at the correct planned time');
  for (let i = 0; i < 3; i++) await capture();
  await page.waitForSelector('.grid .tile');
  check(await visible().locator('.grid .tile').count() === 6 && (await stored()).session.nextSlot === 6, 'sixth photo finishes the plan and opens the gallery');
  check(await page.evaluate(() => document.querySelector('.camera video').srcObject === null), 'finishing releases the camera');
  await shareMode('success'); await button('모두 저장 (공유)').click();
  await page.waitForFunction(() => window.__shared?.length === 6);
  check(await page.evaluate(() => window.__shared.length === 6 && window.__shared.every((f) => f.type === 'image/jpeg' && f.signature[0] === 255 && f.signature[1] === 216)), 'gallery shares six actual JPEG Blobs');
  const patrolNames = [];
  for (let i = 0; i < 6; i++) {
    await visible().locator('.grid .tile').nth(i).click();
    const file = await downloaded(page.locator('dialog').getByRole('button', { name: '이미지 다운로드', exact: true }));
    patrolNames.push(file.name);
    if (i === 0) { check(await dimensions(file.bytes) === '3240x3240', 'individual camera download retains 3240 dimensions'); writeFileSync(join(out, 'patrol-001.jpg'), file.bytes); }
    await page.locator('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  }
  check(patrolNames.join() === '001_20261111_2305.jpg,002_20261111_2310.jpg,003_20261111_2315.jpg,004_20261111_2320.jpg,005_20261111_2325.jpg,006_20261111_2330.jpg', 'individual patrol downloads retain all planned filenames');
  await visible().locator('.grid .tile').nth(1).click();
  await page.locator('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await button('이어서 촬영').click(); await cameraReady();
  check((await title()).includes('오후 11:10'), 'deleting a photo makes only that planned slot pending');
  await capture();
  const retained = (await stored()).shots.map((s) => s.id).join();
  await button('새 순찰 시작').click();
  check(await heading() === '순찰 계산기' && (await stored()).shots.map((s) => s.id).join() === retained, 'new patrol returns to calculator without deleting saved photos');
  await configure('range', '23:50', '00:10', '순찰 촬영'); await next();
  accept = false; await button('순찰 시작').click(); accept = true;
  check(await heading() === '촬영 준비' && (await stored()).shots.length === 6, 'cancelling replacement keeps the previous patrol');
  await button('순찰 시작').click(); await cameraReady();
  for (let i = 0; i < 4; i++) await capture();
  check((await stored()).shots.map((s) => s.time).join() === [Date.UTC(2026, 10, 11, 23, 55), Date.UTC(2026, 10, 12, 0, 0), Date.UTC(2026, 10, 12, 0, 5), Date.UTC(2026, 10, 12, 0, 10)].join(), 'range captures still roll the date over at midnight');
  await button('새 순찰 시작').click(); await configure('single', '23:17', '', '순찰 촬영');
  check(await visible().getByLabel('종료', { exact: true }).isVisible() === false, 'single mode hides the unused end field');
  await next(); await button('순찰 시작').click(); await cameraReady();
  check((await title()).includes('1 / 1') && (await title()).includes('오후 11:17'), 'single patrol starts at exactly 23:17');
  await capture();
  check((await stored()).shots.length === 1 && (await stored()).shots[0].time === Date.UTC(2026, 10, 11, 23, 17) && await heading() === '순찰 보관함', 'one single-time capture finishes and opens the gallery');
  await page.reload(); await page.waitForSelector('[data-page=calc]:visible'); await button('보관함').click();
  check((await stored()).session.mode === 'single' && await visible().locator('.grid .tile').count() === 1, 'single-time patrol survives reload');

  // Seed one legacy real-time photo and old 1080 settings, using only a generated camera image.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('patrol-camera', 1);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction(['shots', 'meta'], 'readwrite'), store = tx.objectStore('shots');
      const read = store.getAll();
      read.onsuccess = () => {
        const shot = read.result[0]; store.clear();
        store.put({ id: 1, time: Date.UTC(2026, 10, 11, 20, 5), blob: shot.blob, thumb: shot.thumb });
        tx.objectStore('meta').put({ date: '2026-11-11', start: '23:00', end: '23:30', size: 1080, autoShare: false }, 'session');
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload(); await page.waitForSelector('[data-page=calc]:visible'); await button('이어서 촬영').click(); await cameraReady();
  await capture(); await page.locator('.cam-top').getByRole('button', { name: '보관함', exact: true }).click();
  const migrated = await stored();
  check(migrated.shots.length === 2 && migrated.shots.some((s) => s.id === 1 && s.slotIndex === undefined) && migrated.session.size === 3240 && migrated.session.resolutionVersion === 1, 'legacy photos remain intact and new captures upgrade old resolution settings');
  await button('계산기로').click();
  await configure('range', '00:00', '00:30', '스탬프 찍기'); await next();
  check(await heading() === '사진 선택' && await visible().locator('[data-step=placement]:visible').count() === 0, 'stamp photo selection is a distinct screen');
  await next(); check(await heading() === '사진 선택', 'stamp cannot advance without selected photos');
  const fixtures = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').fillStyle = '#476d85'; c.getContext('2d').fillRect(0, 0, 256, 256);
    const square = c.toDataURL('image/png').split(',')[1]; c.width = 384;
    return { square, rectangle: c.toDataURL('image/png').split(',')[1] };
  });
  const photos = Array.from({ length: 6 }, (_, i) => ({ name: `${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(fixtures.square, 'base64') }));
  await visible().locator('input[type=file]').setInputFiles([...photos, { name: 'not-square.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.rectangle, 'base64') }]);
  await page.waitForFunction(() => document.querySelectorAll('.photo-grid .thumb').length === 6 && !document.querySelector('[data-page=batch]').classList.contains('busy'));
  const library = () => visible().locator('.photo-grid .thumb');
  check(await library().count() === 6 && await library().locator('..').count() === 6, 'multiple square photos load and non-square input is rejected');
  await library().nth(1).click();
  check(await visible().locator('.photo-grid .thumb.selected').count() === 5 && await library().nth(0).getAttribute('aria-pressed') === 'true' && await library().nth(1).getAttribute('aria-pressed') === 'false', 'toggling B preserves all other selected photos');
  await library().nth(1).click();
  await next();
  check(await visible().locator('.strip .thumb').count() === 6, 'the selected source library is handed to placement');
  await back();
  await library().nth(1).click(); await next();
  check(await visible().locator('.strip .thumb').count() === 5, 'deselected source photos are excluded from placement');
  await back(); await library().nth(1).click();
  await screenshot('mobile-photo-selection');
  await next();
  check(await heading() === '시간별 배치' && await visible().locator('[data-step=photos]:visible').count() === 0 && await page.evaluate(() => document.activeElement.tagName === 'H1'), 'placement replaces selection screen and focuses its heading');
  const thumbs = () => visible().locator('.strip .thumb');
  const slots = () => visible().locator('.slot');
  const slotState = async () => (await visible().locator('.slot .when small:last-child').allTextContents()).map((s) => s.replace('선택됨 · ', ''));
  await next(); check(await heading() === '시간별 배치', 'empty times block result screen');
  for (let i = 0; i < 3; i++) { await thumbs().nth(i).click(); await slots().nth(i).click(); }
  await thumbs().nth(1).click(); await slots().nth(1).click();
  check(await visible().locator('.strip .thumb.selected').count() === 2 && await visible().locator('.slot.selected').count() === 2, 'photos and times independently support toggle multi-selection');
  const countBeforePreview = await visible().locator('.strip .thumb.selected').count();
  await visible().getByRole('button', { name: '1.png 미리보기', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  check(await visible().locator('.strip .thumb.selected').count() === countBeforePreview, 'preview does not toggle the photo selection');
  await button('선택 시간에 배치').click();
  check((await slots().nth(0).innerText()).includes('1.png') && (await slots().nth(2).innerText()).includes('3.png') && await visible().locator('.slot.selected').count() === 0, 'multi-selection places in list order and clears selection markers');
  const originalPlacement = (await slotState()).join();
  await thumbs().nth(3).click(); await slots().nth(3).click(); await slots().nth(4).click(); await button('선택 시간에 배치').click();
  check((await slotState()).join() === originalPlacement, 'mismatched counts leave every placement unchanged');
  await thumbs().nth(3).click(); await button('선택 시간 비우기').click();
  await button('순서대로').click();
  check(await visible().locator('.slot:not(.empty)').count() === 6, 'whole-plan sequential placement uses the selected source library');
  for (const i of [0, 2]) await thumbs().nth(i).click();
  for (const i of [1, 3]) await slots().nth(i).click();
  await button('선택 시간에 배치').click();
  check((await slots().nth(1).innerText()).includes('1.png') && (await slots().nth(3).innerText()).includes('3.png') && await visible().locator('.slot.empty').count() === 2, 'moving already placed photos frees their old slots without duplication');
  await slots().nth(1).click(); await slots().nth(3).click(); await button('선택 시간 비우기').click();
  check(await visible().locator('.slot.empty').count() === 4 && await thumbs().count() === 6, 'clearing multiple times keeps all photos available');
  await button('순서대로').click();
  await thumbs().nth(0).click(); await slots().nth(1).click(); await button('선택 시간에 배치').click();
  check((await slots().nth(0).innerText()).includes('2.png') && (await slots().nth(1).innerText()).includes('1.png') && await visible().locator('.slot.empty').count() === 0, 'one-photo placement retains swap semantics');
  await button('랜덤 배치').click();
  check(await visible().locator('.slot:not(.empty)').count() === 6, 'random arrangement fills all six times');
  await screenshot('mobile-placement');
  await page.goBack(); check(await heading() === '사진 선택', 'browser Back returns to the prior workflow screen');
  check(await library().count() === 6 && await visible().locator('.photo-grid .thumb.selected').count() === 6, 'back navigation preserves uploads and source selection');
  await next(); check(await visible().locator('.slot:not(.empty)').count() === 6, 'returning with unchanged source selection preserves placements');
  accept = false; await button('초기화').click(); accept = true;
  check(await heading() === '시간별 배치' && await visible().locator('.slot:not(.empty)').count() === 6, 'cancelling reset leaves screen and placements unchanged');
  await next();
  check(await heading() === '결과 확인·저장' && await visible().locator('select').first().inputValue() === '3240', 'results are a separate screen with original output resolution');
  await shareMode('unsupported'); await button('사진 준비').click();
  await page.waitForFunction(() => document.querySelectorAll('.result-list button').length === 12 && !document.querySelector('[data-page=batch]').classList.contains('busy'));
  check(await button('저장').isVisible() === false && (await visible().locator('.status').innerText()).includes('이미지 다운로드'), 'unsupported share offers individual image downloads');
  const batchFiles = [];
  for (let i = 0; i < 6; i++) batchFiles.push(await downloaded(visible().locator('.result-item').nth(i).getByRole('button', { name: '이미지 다운로드', exact: true })));
  check(batchFiles.map((f) => f.name).join() === '001_20261111_0005.jpg,002_20261111_0010.jpg,003_20261111_0015.jpg,004_20261111_0020.jpg,005_20261111_0025.jpg,006_20261111_0030.jpg', 'individual batch image names follow chronological planned times');
  check(batchFiles.every((f) => f.bytes[0] === 255 && f.bytes[1] === 216) && await dimensions(batchFiles[0].bytes) === '3240x3240', 'batch downloads are real JPEGs at original 3240 resolution');
  writeFileSync(join(out, 'batch-001.jpg'), batchFiles[0].bytes);
  await shareMode('cancel'); await button('사진 준비').click(); await page.waitForSelector('[data-page=batch]:not(.busy)');
  await button('저장').click();
  check((await visible().locator('.status').innerText()).includes('취소') && await button('이미지 다운로드').count() === 6, 'share cancellation does not report a completed save or discard prepared images');
  await shareMode('failure'); await button('저장').click();
  check((await visible().locator('.status').innerText()).includes('Simulated sharing failure'), 'real sharing failure is reported without losing prepared outputs');
  await shareMode('success'); await button('저장').click();
  await page.waitForFunction(() => window.__shared?.length === 6);
  check(await page.evaluate(() => window.__shared.length === 6 && window.__shared[0].name === '001_20261111_0005.jpg'), 'fresh save button shares prepared photo Blobs');
  await screenshot('mobile-results');
  await visible().getByLabel('형식').selectOption('png'); await visible().getByLabel('해상도').selectOption('1080');
  check(await button('이미지 다운로드').count() === 0, 'format or resolution changes invalidate previously prepared files');
  await button('사진 준비').click(); await page.waitForSelector('[data-page=batch]:not(.busy)');
  const png = await downloaded(visible().locator('.result-item').first().getByRole('button', { name: '이미지 다운로드', exact: true }));
  check(png.name.endsWith('.png') && png.bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) && await dimensions(png.bytes) === '1080x1080', 'PNG download respects explicit smaller resolution');
  await back(); await back(); await back();
  await configure('range', '00:05', '00:35', '스탬프 찍기'); await next(); await next();
  check(await thumbs().count() === 6 && await visible().locator('.slot:not(.empty)').count() === 5 && (await slots().last().innerText()).includes('비어 있음'), 'changing the plan preserves only placements with identical date and time');
  await button('초기화').click();
  check(await heading() === '사진 선택' && await library().count() === 0 && (await stored()).shots.length === 2, 'placement reset returns to empty photo selection and preserves the patrol gallery');
  await visible().locator('input[type=file]').setInputFiles(photos.slice(0, 1));
  await page.waitForSelector('.photo-grid .thumb');
  accept = false; await button('초기화').click(); accept = true;
  check(await library().count() === 1, 'photo-selection reset cancellation preserves uploads');
  await button('초기화').click(); check(await library().count() === 0, 'photo-selection reset clears all uploads too');
  await back(); await configure('single', '23:17', '', '스탬프 찍기'); await next();
  await visible().locator('input[type=file]').setInputFiles(photos.slice(0, 1)); await page.waitForSelector('.photo-grid .thumb');
  await next(); await button('순서대로').click();
  check(await slots().count() === 1 && (await slots().innerText()).includes('오후 11:17'), 'single-time batch creates exactly one 23:17 slot');
  await next(); await visible().getByLabel('해상도').selectOption('1080'); await button('사진 준비').click(); await page.waitForSelector('[data-page=batch]:not(.busy)');
  const single = await downloaded(button('이미지 다운로드'));
  check(single.name === '001_20261111_2317.png', 'single-time export keeps the exact selected date and minute');
  check(await page.locator('button', { hasText: 'ZIP' }).count() === 0 && !(await page.locator('body').innerText()).includes('ZIP'), 'all production ZIP controls and fallback guidance are removed');
  await page.setViewportSize({ width: 320, height: 700 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'workflow fits a 320px mobile viewport without horizontal overflow');
  await page.emulateMedia({ colorScheme: 'dark' }); await screenshot('mobile-results-dark');
}
