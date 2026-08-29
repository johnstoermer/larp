import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await launchChromium();
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
  path: pathFromUrl(new URL('title.png', output)),
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

await page.locator('#callsign').fill('');
await page.locator('#callsign').focus();
await page.evaluate(() => {
  window.__LARP_NAME_KEY_EVENTS__ = [];
  window.addEventListener('keydown', (event) => {
    if (event.target?.id !== 'callsign') return;
    const player = window.__LARP_GAME__?.player;
    window.__LARP_NAME_KEY_EVENTS__.push({
      code: event.code,
      routedAsHeld: player?.keys.has(event.code) || false,
      routedAsPressed: player?.pressed.has(event.code) || false,
      defaultPrevented: event.defaultPrevented,
    });
  });
});
await page.keyboard.type('wasdr c');
const callsignInput = await page.evaluate(() => ({
  value: document.querySelector('#callsign')?.value,
  events: window.__LARP_NAME_KEY_EVENTS__,
}));
if (
  callsignInput.value !== 'wasdr c' ||
  callsignInput.events.some((event) =>
    event.defaultPrevented || event.routedAsHeld || event.routedAsPressed
  )
) {
  throw new Error(`Callsign consumed gameplay keys: ${JSON.stringify(callsignInput)}`);
}
await page.locator('#callsign').fill('ROOKIE');

await page.locator('#start-button').click();
await page.waitForFunction(() => window.__LARP_GAME__?.mode === 'match');
await page.evaluate(() => window.__LARP_GAME__.beginTake());
await page.waitForFunction(() => window.__LARP_GAME__?.phase === 'playing');
await page.locator('#hud:not(.hidden)').waitFor();
await page.locator('#world').click({ position: { x: 760, y: 430 } });
await page.waitForTimeout(350);
await page.evaluate(() => {
  const game = window.__LARP_GAME__;
  game.player.lastShotAt = -Infinity;
  // Keep the browser-input probe deterministic. Combat authority and bot
  // attacks are exercised elsewhere; a lucky bot hit must not terminate the
  // take while this smoke test is measuring keyboard movement.
  game.bot.lastShotAt = Infinity;
});

const before = await page.evaluate(() => {
  const game = window.__LARP_GAME__;
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
await page.waitForFunction(
  () => {
    const keys = window.__LARP_GAME__?.player?.keys;
    return keys?.has('ShiftLeft') && keys?.has('KeyW');
  },
  null,
  { timeout: 3000 },
);
await page.waitForFunction(
  (start) => {
    const position = window.__LARP_GAME__?.player?.position;
    return position && Math.hypot(position.x - start[0], position.z - start[2]) >= 0.2;
  },
  before.position,
  { timeout: 10_000 },
);
await page.waitForTimeout(200);
await page.keyboard.up('KeyW');
await page.keyboard.up('ShiftLeft');
await page.waitForTimeout(250);
const after = await page.evaluate(() => {
  const game = window.__LARP_GAME__;
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

await page.evaluate(() => {
  const game = window.__LARP_GAME__;
  game.resetCombatants();
  game.beginTake();
  const player = game.player;
  player.equip('shortbow', false);
  player.lastShotAt = -Infinity;
});
const bowAmmoBefore = await page.evaluate(() => window.__LARP_GAME__.player.ammo);
await page.mouse.down();
await page.waitForFunction(
  () =>
    window.__LARP_GAME__.player.bowDrawTime >= 0.16 &&
    window.__LARP_GAME__.player.viewmodelSprite?.dataset.state === 'draw',
  null,
  { timeout: 3000 },
);
const bowHeld = await page.evaluate(() => ({
  ammo: window.__LARP_GAME__.player.ammo,
  drawTime: window.__LARP_GAME__.player.bowDrawTime,
  frame: window.__LARP_GAME__.player.viewmodelSprite?.dataset.state,
}));
await page.mouse.up();
await page.waitForFunction(
  () => window.__LARP_GAME__.player.viewmodelSprite?.dataset.state === 'fire',
  null,
  { timeout: 3000 },
);
const bowReleased = await page.evaluate(() => ({
  ammo: window.__LARP_GAME__.player.ammo,
  reserve: window.__LARP_GAME__.player.reserve,
  usesAmmo: window.__LARP_GAME__.player.definition.usesAmmo,
  frame: window.__LARP_GAME__.player.viewmodelSprite?.dataset.state,
}));
await page.keyboard.press('KeyR');
await page.waitForTimeout(120);
const bowReload = await page.evaluate(() => ({
  reloading: window.__LARP_GAME__.player.reloading,
  hasReloadFrames: Boolean(
    window.__LARP_GAME__.player.getViewmodelFrameSet(
      window.__LARP_GAME__.player.definition,
    ).reload,
  ),
}));
await page.waitForFunction(() => {
  const player = window.__LARP_GAME__?.player;
  return player?.viewmodelBottomMargins.has(player.viewmodelFrameKey);
});
const viewmodelFraming = await page.evaluate(() => {
  const player = window.__LARP_GAME__.player;
  const sprite = player.viewmodelSprite;
  const style = getComputedStyle(sprite);
  const measurement = player.viewmodelBottomMargins.get(player.viewmodelFrameKey);
  return {
    frame: player.viewmodelFrameKey,
    bottomMarginRatio: measurement?.ratio,
    bottomShift: Number.parseFloat(style.getPropertyValue('--vm-frame-bottom-shift')),
    layerActive: player.viewmodelLayer.classList.contains('active'),
    backgroundImage: style.backgroundImage,
  };
});

await page.screenshot({
  path: pathFromUrl(new URL('gameplay.png', output)),
  fullPage: true,
});

const mechanics = await page.evaluate(() => {
  const game = window.__LARP_GAME__;
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

const fighterPresentation = await page.evaluate(async () => {
  const game = window.__LARP_GAME__;
  const bot = game.bot;
  bot.equip('crossbow');
  bot.root.visible = true;
  const cases = [
    { state: 'idle', speed: 0, attackTime: 0, flashHit: 0, dead: false },
    { state: 'walk', speed: 2, attackTime: 0, flashHit: 0, dead: false },
    { state: 'attack', speed: 2, attackTime: 0.2, flashHit: 0, dead: false },
    { state: 'hit', speed: 2, attackTime: 0.2, flashHit: 0.1, dead: false },
    { state: 'death', speed: 2, attackTime: 0.2, flashHit: 0.1, dead: true },
  ];
  const results = [];
  for (const entry of cases) {
    bot.velocity.set(entry.speed, 0, 0);
    bot.attackTime = entry.attackTime;
    bot.flashHit = entry.flashHit;
    bot.dead = entry.dead;
    bot.animate(0, null, false);
    const image = bot.spriteMaterial.map?.image;
    if (typeof image?.decode === 'function') await image.decode().catch(() => {});
    results.push({
      requestedState: entry.state,
      renderedState: bot.sprite.userData.state,
      visible: bot.root.visible,
      textureUrl: image?.currentSrc || image?.src || '',
      imageSize: [image?.naturalWidth || 0, image?.naturalHeight || 0],
    });
  }
  bot.dead = false;
  bot.health = 100;
  bot.velocity.set(0, 0, 0);
  bot.attackTime = 0;
  bot.flashHit = 0;
  bot.updateFighterState();
  return results;
});

const combatFeedback = await page.evaluate(() => {
  const game = window.__LARP_GAME__;
  const player = game.player;
  const bot = game.bot;
  bot.reset(bot.position.clone(), bot.yaw);
  bot.root.visible = true;
  player.dead = false;
  player.equip('knives', false);
  player.lastShotAt = -Infinity;
  game.elapsed += 1;
  const originalTrace = game.traceAgainstBot;
  game.traceAgainstBot = () => ({
    kind: 'bot',
    point: bot.getBodyCenter(),
    normal: player.getAim().direction.clone().negate(),
    distance: 4,
    headshot: false,
  });
  try {
    game.firePlayerWeapon();
  } finally {
    game.traceAgainstBot = originalTrace;
  }
  const number = [...game.vfx.transients]
    .reverse()
    .find((entry) => entry.object?.name === 'damage-number')?.object;
  return {
    botHealth: bot.health,
    healthBarName: bot.healthBar?.name,
    healthRatio: bot.healthBar?.userData.ratio,
    healthFillVisible: bot.healthBarFill?.visible,
    damageNumber: number?.userData.damage,
    damageNumberHeadshot: number?.userData.headshot,
    hitmarkerActive: game.ui.hitMarker.classList.contains('active'),
  };
});

if (after.ammo >= before.ammo) throw new Error('Firing did not consume ammunition.');
if (
  bowHeld.ammo !== bowAmmoBefore ||
  bowHeld.drawTime < 0.12 ||
  bowHeld.frame !== 'draw' ||
  bowReleased.ammo !== bowAmmoBefore ||
  bowReleased.reserve !== 0 ||
  bowReleased.usesAmmo !== false ||
  bowReleased.frame !== 'fire' ||
  bowReload.reloading ||
  bowReload.hasReloadFrames
) {
  throw new Error(`Ammo-free bow draw/release contract failed: ${JSON.stringify({
    bowAmmoBefore,
    bowHeld,
    bowReleased,
    bowReload,
  })}`);
}
if (
  !viewmodelFraming.layerActive ||
  viewmodelFraming.bottomMarginRatio > 0.02 ||
  viewmodelFraming.bottomShift > 180 ||
  !viewmodelFraming.backgroundImage.includes('/assets/larp/viewmodels/shortbow-')
) {
  throw new Error(`Viewmodel alpha anchoring failed: ${JSON.stringify(viewmodelFraming)}`);
}
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
if (
  fighterPresentation.length !== 5 ||
  new Set(fighterPresentation.map((entry) => entry.textureUrl)).size !== 5 ||
  fighterPresentation.some((entry) =>
    entry.renderedState !== entry.requestedState ||
    new URL(entry.textureUrl).pathname !== `/assets/larp/fighters/crossbow-${entry.requestedState}.webp` ||
    entry.imageSize.some((size) => size < 1) ||
    (entry.requestedState === 'death' && !entry.visible)
  )
) {
  throw new Error(`Third-person fighter animation failed: ${JSON.stringify(fighterPresentation)}`);
}
if (
  combatFeedback.botHealth !== 72 ||
  combatFeedback.healthBarName !== 'character-health-bar' ||
  Math.abs(combatFeedback.healthRatio - 0.72) > 0.001 ||
  !combatFeedback.healthFillVisible ||
  combatFeedback.damageNumber !== 28 ||
  combatFeedback.damageNumberHeadshot !== false ||
  !combatFeedback.hitmarkerActive
) {
  throw new Error(`Combat feedback failed: ${JSON.stringify(combatFeedback)}`);
}
if (pageErrors.length || consoleErrors.length) {
  throw new Error(
    `Browser errors:\n${[...pageErrors, ...consoleErrors].join('\n')}`,
  );
}

const report = {
  baseUrl,
  titleState,
  callsignInput,
  before,
  after,
  mechanics,
  bow: { bowAmmoBefore, held: bowHeld, released: bowReleased, reload: bowReload },
  viewmodelFraming,
  fighterPresentation,
  combatFeedback,
  movementDistance,
  pageErrors,
  consoleErrors,
};
await writeFile(new URL('smoke-report.json', output), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
