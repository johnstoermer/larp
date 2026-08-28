import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COOKOUT_PORTAL_URL || 'https://herm.cool/games/cookout-2';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

  const response = await page.goto(baseUrl, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  const iframe = page.locator('iframe[title="Cookout 2"]');
  await iframe.waitFor();
  const frame = page.frames().find((candidate) =>
    candidate.url().startsWith('https://hermcool-cookout-2.fly.dev/'),
  );
  if (!frame) throw new Error('The production game iframe did not load.');
  await frame.locator('#title-screen.active').waitFor({ timeout: 60_000 });

  const report = {
    baseUrl,
    status: response?.status() ?? null,
    iframeUrl: frame.url(),
    allow: await iframe.getAttribute('allow'),
    game: await frame.evaluate(() => ({
      title: document.title,
      webgl: Boolean(window.__COOKOUT_2_GAME__?.rendering?.renderer),
      quickDuel: Boolean(document.querySelector('#online-button')),
      privateRoom: Boolean(document.querySelector('#private-button')),
      practice: Boolean(document.querySelector('#start-button')),
    })),
    errors,
  };
  await page.screenshot({
    path: new URL('portal-production.png', output).pathname.slice(1),
    fullPage: true,
  });
  await writeFile(
    new URL('portal-report.json', output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (report.status !== 200) throw new Error(`Portal returned ${report.status}.`);
  if (!report.allow?.includes('clipboard-write')) {
    throw new Error(`Portal iframe permissions are incomplete: ${report.allow}`);
  }
  if (
    !report.game.webgl ||
    !report.game.quickDuel ||
    !report.game.privateRoom ||
    !report.game.practice
  ) {
    throw new Error(`Embedded game did not initialize: ${JSON.stringify(report.game)}`);
  }
  if (errors.length) throw new Error(`Browser diagnostics failed: ${errors.join('\n')}`);
} finally {
  await browser.close();
}
