import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/visual-review/', import.meta.url);
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

const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('#title-screen.active').waitFor();
await page.screenshot({
  path: new URL('menu.png', output).pathname.slice(1),
  fullPage: true,
});

await page.evaluate(async () => {
  const game = window.__LARP_GAME__;
  await game.audio.init();
  game.mode = 'visual-review';
  game.phase = 'review';
  game.ui.showHUD();
  game.player.viewRoot.visible = true;
  game.bot.root.visible = true;
  game.arena.load(0, 8800);
  game.pickups.reset(game.arena.weaponSlots, [
    'shortbow', 'ember', 'crossbow', 'lightning', 'longbow', 'greatsword', 'fireball',
  ]);
});

await page.waitForFunction(() =>
  [...window.__LARP_GAME__.player.viewmodelFrames.values()]
    .every((image) => image.complete && image.naturalWidth > 0),
);
const edgeReport = await page.evaluate(() => {
  const frames = window.__LARP_GAME__.player.viewmodelFrames;
  return [...frames.entries()].map(([key, image]) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let minimumX = canvas.width;
    let minimumY = canvas.height;
    let maximumX = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 16) continue;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
      }
    }
    return {
      key,
      size: [canvas.width, canvas.height],
      margins: {
        top: minimumY,
        left: minimumX,
        right: canvas.width - 1 - maximumX,
      },
    };
  });
});

const mapShots = [
  { name: 'arena-spawn', position: [0, 0, 16], yaw: 0, weapon: 'knives', state: 'idle' },
  { name: 'arena-center', position: [0, 0, 5.4], yaw: 0, weapon: 'crossbow', state: 'idle' },
];

const weaponShots = [
  ['knives', ['idle', 'fire', 'reload']],
  ['shortbow', ['idle', 'draw', 'fire', 'reload']],
  ['ember', ['idle', 'fire', 'reload']],
  ['crossbow', ['idle', 'fire', 'reload']],
  ['lightning', ['idle', 'fire', 'reload']],
  ['longbow', ['idle', 'draw', 'fire', 'reload']],
  ['greatsword', ['idle', 'fire', 'reload']],
  ['fireball', ['idle', 'fire', 'reload']],
].flatMap(([weapon, states]) => states.map((state) => ({
  name: `${weapon}-${state}`,
  position: [-8.5, 0, 8],
  yaw: -0.55,
  weapon,
  state,
})));

const shots = [...mapShots, ...weaponShots];

const report = [];
for (const shot of shots) {
  const state = await page.evaluate((entry) => {
    const game = window.__LARP_GAME__;
    const player = game.player;
    player.position.set(...entry.position);
    player.velocity.set(0, 0, 0);
    player.yaw = entry.yaw;
    player.pitch = -0.08;
    player.dead = false;
    player.equip(entry.weapon, false);
    player.shotFrameTime = entry.state === 'fire' ? 0.1 : 0;
    player.bowDrawTime = entry.state === 'draw' ? 0.7 : 0;
    player.reloading = entry.state === 'reload';
    player.reloadDuration = entry.state === 'reload' ? 1 : 0;
    player.reloadRemaining = entry.state === 'reload' ? 0.5 : 0;
    player.updateView(0, {
      moving: false,
      speed: 0,
      sprinting: false,
      sliding: false,
      wallRunning: false,
    });
    player.syncCamera(0.5);
    game.updateHUD();
    return {
      name: entry.name,
      map: game.arena.map.name,
      position: player.position.toArray(),
      weapon: player.weaponType,
      requestedState: entry.state,
      renderedState: player.viewmodelSprite?.dataset.state,
      frameUrl: player.viewmodelSprite?.style.backgroundImage,
      spawnOverlaps: game.arena.getOverlaps(player.position, 0.42, 1.8).length,
      loadedMaterialSizes: Object.fromEntries(
        Object.entries(game.arena.materials).map(([name, material]) => [
          name,
          [material.map?.image?.width || 0, material.map?.image?.height || 0],
        ]),
      ),
    };
  }, shot);
  await page.waitForTimeout(350);
  await page.screenshot({
    path: new URL(`${shot.name}.png`, output).pathname.slice(1),
    fullPage: true,
  });
  report.push(state);
}

const fighterReport = [];
for (const weapon of ['knives', 'shortbow', 'ember', 'crossbow', 'lightning', 'longbow', 'greatsword', 'fireball']) {
  await page.evaluate((weaponType) => {
    const game = window.__LARP_GAME__;
    game.player.viewRoot.visible = false;
    game.player.viewmodelLayer?.classList.remove('active');
    game.camera.position.set(-9, 1.45, 5.5);
    game.camera.rotation.set(-0.02, 0, 0);
    game.bot.position.set(-9, 0, 0);
    game.bot.velocity.set(0, 0, 0);
    game.bot.dead = false;
    game.bot.root.visible = true;
    game.bot.equip(weaponType);
  }, weapon);
  await page.waitForFunction(
    (weaponType) => {
      const game = window.__LARP_GAME__;
      return game.bot.sprite.userData.weapon === weaponType &&
        (game.bot.spriteMaterial.map?.image?.naturalWidth || 0) > 0;
    },
    weapon,
  );
  const state = await page.evaluate((weaponType) => {
    const game = window.__LARP_GAME__;
    return {
      weapon: weaponType,
      renderedWeapon: game.bot.sprite.userData.weapon,
      textureUrl: game.bot.spriteMaterial.map?.image?.currentSrc || game.bot.spriteMaterial.map?.image?.src,
      imageSize: [
        game.bot.spriteMaterial.map?.image?.naturalWidth || 0,
        game.bot.spriteMaterial.map?.image?.naturalHeight || 0,
      ],
    };
  }, weapon);
  await page.screenshot({
    path: new URL(`fighter-${weapon}.png`, output).pathname.slice(1),
    fullPage: true,
  });
  fighterReport.push(state);
}

const projectileReport = await page.evaluate(() => {
  const game = window.__LARP_GAME__;
  const cases = [
    ['shortbow', 'arrow.webp'],
    ['crossbow', 'bolt.webp'],
    ['knives', 'knife.webp'],
  ];
  return cases.map(([weapon, expectedAsset], index) => {
    const start = game.camera.position.clone().add({ x: index * 0.2, y: 0, z: -1 });
    const end = start.clone().add({ x: 1.2 + index, y: 0.35, z: -8 });
    const firstIndex = game.vfx.transients.length;
    game.vfx.spawnFlyingProp(start, end, weapon);
    const transient = game.vfx.transients[firstIndex];
    transient.update(0.5);
    const travel = end.clone().sub(start).normalize();
    const renderedDirection = start.clone().set(1, 0, 0)
      .applyQuaternion(transient.object.quaternion)
      .normalize();
    const result = {
      weapon,
      expectedAsset,
      objectType: transient.object.type,
      objectName: transient.object.name,
      directionAlignment: renderedDirection.dot(travel),
      textureUrl: transient.object.material.map?.image?.currentSrc || transient.object.material.map?.image?.src,
      geometry: transient.object.geometry?.type,
    };
    game.vfx.root.remove(transient.object);
    transient.dispose?.();
    game.vfx.transients.splice(firstIndex, 1);
    return result;
  });
});

if (report.some((entry) => entry.renderedState !== entry.requestedState)) {
  throw new Error(`Viewmodel state mismatch: ${JSON.stringify(report)}`);
}
if (edgeReport.some((entry) =>
  entry.margins.top < 48 || entry.margins.left < 48 || entry.margins.right < 48
)) {
  throw new Error(`A first-person photo has a hard top or side edge: ${JSON.stringify(edgeReport)}`);
}
if (report.some((entry) => Object.values(entry.loadedMaterialSizes).some(([width]) => width < 1))) {
  throw new Error(`A photographic material did not load: ${JSON.stringify(report)}`);
}
if (
  new Set(fighterReport.map((entry) => entry.textureUrl)).size !== fighterReport.length ||
  fighterReport.some((entry) => entry.renderedWeapon !== entry.weapon || entry.imageSize.some((size) => size < 1))
) {
  throw new Error(`Third-person weapon presentation is not unique: ${JSON.stringify(fighterReport)}`);
}
if (projectileReport.some((entry) =>
  entry.objectType !== 'Mesh' ||
  entry.geometry !== 'PlaneGeometry' ||
  entry.directionAlignment < 0.999 ||
  !entry.textureUrl?.endsWith(entry.expectedAsset)
)) {
  throw new Error(`Directional photographic projectile failed: ${JSON.stringify(projectileReport)}`);
}
if (errors.length) throw new Error(errors.join('\n'));

await writeFile(
  new URL('report.json', output),
  JSON.stringify({
    frames: report,
    edgeReport,
    fighters: fighterReport,
    projectiles: projectileReport,
  }, null, 2),
);
await browser.close();
console.log(JSON.stringify({
  frameCount: report.length,
  minimumViewmodelMargins: edgeReport.reduce(
    (minimums, entry) => ({
      top: Math.min(minimums.top, entry.margins.top),
      left: Math.min(minimums.left, entry.margins.left),
      right: Math.min(minimums.right, entry.margins.right),
    }),
    { top: Infinity, left: Infinity, right: Infinity },
  ),
  fighterReport,
  projectileReport,
}, null, 2));
