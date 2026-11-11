// Renderer checks plus production-browser flows, including a GitHub Pages subpath.
// Uses installed Edge/Chrome, BROWSER, or `npx playwright-core install chromium`.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWorkflow } from './verify-workflow.mjs';

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
  await verifyWorkflow(page, out, check);
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
