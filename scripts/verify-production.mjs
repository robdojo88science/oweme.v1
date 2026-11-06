import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve('dist');
const base = process.env.VITE_BASE_PATH || '/';
assert(base.startsWith('/') && base.endsWith('/'), 'VITE_BASE_PATH must start and end with /.');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(base.length) || 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}${base}`;
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'chrome' : undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'en-PH', timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('heading', { level: 1 }).waitFor();
  const before = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open('OweMe');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const count = database.transaction('borrowers').objectStore('borrowers').count();
      count.onsuccess = () => { resolve(count.result); database.close(); };
      count.onerror = () => reject(count.error);
    };
  }));
  assert.equal(before, 0, 'A production install must contain no demo borrowers.');
  const manifest = await page.evaluate(async () => {
    const href = globalThis.document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    if (!href) throw new Error('Missing web app manifest.');
    const response = await fetch(href);
    if (!response.ok) throw new Error('Manifest did not load.');
    return { data: await response.json(), href: new URL(href, globalThis.location.href).href };
  });
  assert.equal(new URL(manifest.data.scope, manifest.href).pathname, base);
  assert.equal(new URL(manifest.data.start_url, manifest.href).pathname, base);
  for (const icon of manifest.data.icons) {
    const result = await page.request.get(new URL(icon.src, manifest.href).href);
    assert(result.ok(), `Missing manifest icon: ${icon.src}`);
  }
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const registration = await page.evaluate(async () => {
    const item = await navigator.serviceWorker.ready;
    return { scope: item.scope, script: item.active?.scriptURL };
  });
  assert.equal(new URL(registration.scope).pathname, base);
  assert.equal(new URL(registration.script).pathname, `${base}sw.js`);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Add borrower', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add borrower', exact: true });
  await add.getByLabel('Full name', { exact: true }).fill('Offline verification');
  await add.getByRole('button', { name: 'Save borrower', exact: true }).click();
  await page.getByRole('heading', { name: 'Offline verification', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Offline verification', exact: true }).waitFor();
  await page.locator('a[href^="#/loan?borrower="]:visible').first().click();
  await page.getByLabel('Total they will repay', { exact: true }).fill('3000');
  await page.getByLabel('One-time charge (%)', { exact: true }).fill('10');
  assert.equal(await page.getByTestId('cash-preview').innerText(), '₱2,700.00');
  await page.getByRole('button', { name: 'Agreement', exact: true }).click();
  const pdf = page.getByRole('dialog', { name: /Agreement preview/ });
  const downloadPromise = page.waitForEvent('download');
  await pdf.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await downloadPromise;
  const receipt = await download.path();
  assert(receipt);
  assert.equal((await readFile(receipt)).subarray(0, 4).toString(), '%PDF');
  await pdf.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await mkdir('qa', { recursive: true });
  const suffix = base === '/' ? 'root' : base.replaceAll('/', '');
  await page.screenshot({ path: `qa/production-offline-${suffix}.png`, fullPage: true });
  assert.deepEqual(errors, [], 'Production must have no uncaught browser errors.');
  console.log(JSON.stringify({ base, manifest: true, icons: true, serviceWorkerScope: registration.scope,
    offlineReload: true, offlinePersistence: true, offlineCalculator: true, offlineAgreementPdf: true,
    zeroDemoBorrowers: true, browserErrors: errors.length }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
