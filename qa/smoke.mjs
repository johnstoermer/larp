import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COOKOUT_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('#title-screen.active').waitFor();
await page.locator('#game-title').waitFor();
await page.screenshot({
  path: new URL('title.png', output).pathname.slice(1),
  fullPage: true,
});

const titleState = await page.evaluate(() => ({
  webgl: Boolean(document.querySelector('#world')?.getContext('webgl2')),
  title: document.title,
  canvasWidth: document.querySelector('#world')?.width,
  canvasHeight: document.querySelector('#world')?.height,
  errorVisible: document.querySelector('#error-screen')?.classList.contains('active'),
}));
if (!titleState.webgl || titleState.errorVisible) {
  throw new Error(`Renderer did not initialize: ${JSON.stringify(titleState)}`);
}

await page.locator('#start-button').click();
await page.waitForFunction(() => window.__COOKOUT_2_GAME__?.mode === 'match');
await page.evaluate(() => window.__COOKOUT_2_GAME__.beginTake());
await page.waitForFunction(() => window.__COOKOUT_2_GAME__?.phase === 'playing');
await page.locator('#hud:not(.hidden)').waitFor();
await page.locator('#world').click({ position: { x: 760, y: 430 } });
await page.waitForTimeout(350);
await page.evaluate(() => {
  window.__COOKOUT_2_GAME__.player.lastShotAt = -Infinity;
});

const before = await page.evaluate(() => {
  const game = window.__COOKOUT_2_GAME__;
  return {
    ammo: game.player.ammo,
    position: game.player.position.toArray(),
  };
});
await page.mouse.down();
await page.waitForTimeout(450);
await page.mouse.up();
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(250);
const after = await page.evaluate(() => {
  const game = window.__COOKOUT_2_GAME__;
  return {
    ammo: game.player.ammo,
    position: game.player.position.toArray(),
    phase: game.phase,
    renderCalls: game.rendering.renderer.info.render.calls,
    arenaMeshes: game.arena.raycastMeshes.length,
    colliders: game.arena.colliders.length,
    pickups: game.pickups.pickups.length,
    botHealth: game.bot.health,
  };
});

await page.screenshot({
  path: new URL('gameplay.png', output).pathname.slice(1),
  fullPage: true,
});

const mechanics = await page.evaluate(() => {
  const game = window.__COOKOUT_2_GAME__;
  const player = game.player;
  player.reset(game.arena.getSpawn('player'), game.arena.getSpawnYaw('player'));
  player.grounded = true;
  player.velocity.set(7, 0, 0);
  player.pressed.add('ControlLeft');
  const slideState = player.update(1 / 60, true);
  const slideActivated = slideState.sliding && player.slideTime > 0;

  player.reset(game.arena.getSpawn('player'), game.arena.getSpawnYaw('player'));
  player.grounded = true;
  player.pressed.add('Space');
  player.update(1 / 60, true);
  const jumpActivated = player.velocity.y > 5 && !player.grounded;

  return {
    slideActivated,
    jumpActivated,
    weaponCount: Object.keys(game.weapons).length,
  };
});

if (after.ammo >= before.ammo) throw new Error('Firing did not consume ammunition.');
if (
  after.renderCalls < 1 ||
  after.arenaMeshes < 10 ||
  after.colliders < 15 ||
  after.pickups < 5
) {
  throw new Error(`Game scene is incomplete: ${JSON.stringify(after)}`);
}
const movementDistance = Math.hypot(
  after.position[0] - before.position[0],
  after.position[2] - before.position[2],
);
if (movementDistance < 0.2) throw new Error('Movement input did not move the player.');
if (!mechanics.slideActivated || !mechanics.jumpActivated || mechanics.weaponCount < 8) {
  throw new Error(`Core mechanics did not activate: ${JSON.stringify(mechanics)}`);
}
if (pageErrors.length || consoleErrors.length) {
  throw new Error(
    `Browser errors:\n${[...pageErrors, ...consoleErrors].join('\n')}`,
  );
}

const report = {
  baseUrl,
  titleState,
  before,
  after,
  mechanics,
  movementDistance,
  pageErrors,
  consoleErrors,
};
await writeFile(new URL('smoke-report.json', output), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
