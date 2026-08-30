import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/visual-review/', import.meta.url);
await mkdir(output, { recursive: true });

const viewports = Object.freeze({
  desktop: { width: 1440, height: 900 },
  // The game intentionally replaces sub-700px layouts with a desktop-only
  // notice. Use the narrowest playable viewport so screenshots still expose
  // first-person framing and HUD clipping instead of only that notice.
  narrow: { width: 720, height: 900 },
});
const expectedCanonicalFrameCount = 53;
const fighterStates = Object.freeze(['idle', 'walk', 'attack', 'hit', 'death']);
const expectedFighterStateCount = 8 * fighterStates.length;
const runtimeSafetyGutterRatio = 0.04;
const bowLimbMinimumRightRatio = 0.04;
const bowActionMinimumRightRatio = 0.075;
const round = (value) => Math.round(value * 100) / 100;
for (const name of Object.keys(viewports)) {
  await mkdir(new URL(`${name}/`, output), { recursive: true });
}

const browser = await launchChromium();
try {
const page = await browser.newPage({
  viewport: viewports.desktop,
  deviceScaleFactor: 1,
});

async function useViewport(name) {
  await page.setViewportSize(viewports[name]);
  await page.waitForTimeout(120);
}

async function capture(name, viewportName) {
  await useViewport(viewportName);
  await page.screenshot({
    path: pathFromUrl(new URL(`${viewportName}/${name}.png`, output)),
    fullPage: true,
  });
}

const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('#title-screen.active').waitFor();
await capture('menu', 'desktop');
await capture('menu', 'narrow');
await useViewport('desktop');

await page.evaluate(async () => {
  const game = window.__LARP_GAME__;
  await game.audio.init();
  game.titleAttract?.stop();
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
      bounds: maximumX >= 0 ? {
        top: minimumY,
        left: minimumX,
        right: maximumX,
      } : null,
      margins: {
        top: minimumY,
        left: minimumX,
        right: canvas.width - 1 - maximumX,
      },
    };
  });
});

const animationFrameReport = await page.evaluate(() => {
  const player = window.__LARP_GAME__.player;
  const results = [];
  for (const [weapon, frameSet] of player.viewmodelFrameSets.entries()) {
    player.equip(weapon, false);
    for (const [state, frames] of Object.entries(frameSet)) {
      for (const frame of frames) {
        const progress = (frame.frameNumber - 0.5) / frames.length;
        player.setViewmodelAnimationProgress(state, progress);
        const image = player.viewmodelFrames.get(frame.key);
        results.push({
          weapon,
          state,
          expectedFrame: frame.frameNumber,
          expectedKey: frame.key,
          expectedUrl: frame.url,
          renderedState: player.viewmodelSprite?.dataset.state,
          renderedFrame: Number(player.viewmodelSprite?.dataset.frame),
          renderedUrl: player.viewmodelSprite?.style.backgroundImage,
          imageSize: [image?.naturalWidth || 0, image?.naturalHeight || 0],
        });
      }
    }
  }
  return results;
});

const runtimeViewmodelFrames = [];
for (const viewportName of Object.keys(viewports)) {
  await useViewport(viewportName);
  const viewportFrames = await page.evaluate(
    ({ name, safetyGutterRatio }) => {
      const game = window.__LARP_GAME__;
      const player = game.player;
      const sprite = player.viewmodelSprite;
      const results = [];
      const movement = {
        moving: false,
        speed: 0,
        sprinting: false,
        sliding: false,
        wallRunning: false,
      };
      const round = (value) => Math.round(value * 100) / 100;
      const resolveBackgroundOffset = (value, availableSpace) => {
        const token = String(value).split(',')[0].trim().toLowerCase();
        if (token.endsWith('%')) {
          return availableSpace * (parseFloat(token) / 100);
        }
        if (token.endsWith('px')) return parseFloat(token);
        if (token === 'center') return availableSpace / 2;
        if (token === 'right' || token === 'bottom') return availableSpace;
        if (token === 'left' || token === 'top') return 0;
        throw new Error(`Unsupported viewmodel background position: ${value}`);
      };

      for (const [weapon, frameSet] of player.viewmodelFrameSets.entries()) {
        for (const [state, frames] of Object.entries(frameSet)) {
          for (const frame of frames) {
            const progress = (frame.frameNumber - 0.5) / frames.length;
            player.position.set(-8.5, 0, 8);
            player.velocity.set(0, 0, 0);
            player.yaw = -0.55;
            player.pitch = -0.08;
            player.dead = false;
            player.focused = false;
            player.sway.set(0, 0);
            player.bob = 0;
            player.landKick = 0;
            player.weaponKick = 0;
            player.equip(weapon, false);
            player.shotFrameTime = state === 'fire' ? 0.1 : 0;
            player.bowDrawTime = state === 'draw' ? 0.72 * progress : 0;
            player.reloading = state === 'reload';
            player.reloadDuration = state === 'reload' ? 1 : 0;
            player.reloadRemaining = state === 'reload' ? 1 - progress : 0;
            player.setViewmodelAnimationProgress(state, progress);
            player.updateView(0, movement);

            const image = player.viewmodelFrames.get(frame.key);
            const style = getComputedStyle(sprite);
            if (!image || image.naturalWidth < 1 || image.naturalHeight < 1) {
              throw new Error(`Runtime viewmodel frame did not load: ${frame.key}`);
            }
            if (style.backgroundSize !== 'contain') {
              throw new Error(
                `Runtime clipping audit requires background-size: contain; ` +
                `${frame.key} rendered ${style.backgroundSize}`,
              );
            }

            const parentRect = sprite.offsetParent?.getBoundingClientRect() ?? {
              left: 0,
              top: 0,
              width: innerWidth,
              height: innerHeight,
            };
            const elementWidth = parseFloat(style.width);
            const elementHeight = parseFloat(style.height);
            const layoutLeft = parentRect.left + parseFloat(style.left);
            const layoutTop = parentRect.top + parentRect.height -
              parseFloat(style.bottom) - elementHeight;
            const [originX, originY] = style.transformOrigin
              .split(' ')
              .map((value) => parseFloat(value));
            const matrix = style.transform === 'none'
              ? new DOMMatrix()
              : new DOMMatrix(style.transform);
            const imageScale = Math.min(
              elementWidth / image.naturalWidth,
              elementHeight / image.naturalHeight,
            );
            const renderedImageWidth = image.naturalWidth * imageScale;
            const renderedImageHeight = image.naturalHeight * imageScale;
            const backgroundX = resolveBackgroundOffset(
              style.backgroundPositionX,
              elementWidth - renderedImageWidth,
            );
            const backgroundY = resolveBackgroundOffset(
              style.backgroundPositionY,
              elementHeight - renderedImageHeight,
            );

            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let opaquePixels = 0;
            let minimumX = Infinity;
            let minimumY = Infinity;
            let maximumX = -Infinity;
            let maximumY = -Infinity;
            let sourceMinimumY = Infinity;
            let sourceMaximumY = -Infinity;
            const pixelXAxisX = matrix.a * imageScale;
            const pixelXAxisY = matrix.b * imageScale;
            const pixelYAxisX = matrix.c * imageScale;
            const pixelYAxisY = matrix.d * imageScale;

            for (let y = 0; y < canvas.height; y += 1) {
              for (let x = 0; x < canvas.width; x += 1) {
                if (pixels[(y * canvas.width + x) * 4 + 3] <= 16) continue;
                opaquePixels += 1;
                sourceMinimumY = Math.min(sourceMinimumY, y);
                sourceMaximumY = Math.max(sourceMaximumY, y);
                const localX = backgroundX + x * imageScale - originX;
                const localY = backgroundY + y * imageScale - originY;
                const screenX = layoutLeft + originX +
                  matrix.a * localX + matrix.c * localY + matrix.e;
                const screenY = layoutTop + originY +
                  matrix.b * localX + matrix.d * localY + matrix.f;
                const oppositeX = screenX + pixelXAxisX + pixelYAxisX;
                const oppositeY = screenY + pixelXAxisY + pixelYAxisY;
                minimumX = Math.min(
                  minimumX,
                  screenX,
                  screenX + pixelXAxisX,
                  screenX + pixelYAxisX,
                  oppositeX,
                );
                minimumY = Math.min(
                  minimumY,
                  screenY,
                  screenY + pixelXAxisY,
                  screenY + pixelYAxisY,
                  oppositeY,
                );
                maximumX = Math.max(
                  maximumX,
                  screenX,
                  screenX + pixelXAxisX,
                  screenX + pixelYAxisX,
                  oppositeX,
                );
                maximumY = Math.max(
                  maximumY,
                  screenY,
                  screenY + pixelXAxisY,
                  screenY + pixelYAxisY,
                  oppositeY,
                );
              }
            }

            // Hands and sleeves dominate the full alpha silhouette. The upper
            // third of an occupied bow photograph isolates the actual curved
            // limb/string assembly, including the horizontal recovery pose.
            // Transform that source band independently so the placement gate
            // cannot pass merely because a forearm moved across the crosshair.
            let bowLimbBounds = null;
            if (
              (weapon === 'shortbow' || weapon === 'longbow') &&
              (state === 'draw' || state === 'fire') &&
              Number.isFinite(sourceMinimumY) &&
              Number.isFinite(sourceMaximumY)
            ) {
              const bandBottom = Math.min(
                canvas.height - 1,
                Math.ceil(sourceMinimumY + (sourceMaximumY - sourceMinimumY) * 0.32),
              );
              let limbMinimumX = Infinity;
              let limbMaximumX = -Infinity;
              for (let y = Math.floor(sourceMinimumY); y <= bandBottom; y += 1) {
                for (let x = 0; x < canvas.width; x += 1) {
                  if (pixels[(y * canvas.width + x) * 4 + 3] <= 16) continue;
                  const localX = backgroundX + x * imageScale - originX;
                  const localY = backgroundY + y * imageScale - originY;
                  const screenX = layoutLeft + originX +
                    matrix.a * localX + matrix.c * localY + matrix.e;
                  const oppositeX = screenX + pixelXAxisX + pixelYAxisX;
                  limbMinimumX = Math.min(
                    limbMinimumX,
                    screenX,
                    screenX + pixelXAxisX,
                    screenX + pixelYAxisX,
                    oppositeX,
                  );
                  limbMaximumX = Math.max(
                    limbMaximumX,
                    screenX,
                    screenX + pixelXAxisX,
                    screenX + pixelYAxisX,
                    oppositeX,
                  );
                }
              }
              if (Number.isFinite(limbMinimumX) && Number.isFinite(limbMaximumX)) {
                bowLimbBounds = {
                  left: round(limbMinimumX),
                  right: round(limbMaximumX),
                  center: round((limbMinimumX + limbMaximumX) / 2),
                  sourceBand: [Math.floor(sourceMinimumY), bandBottom],
                };
              }
            }

            const bounds = opaquePixels > 0 ? {
              top: round(minimumY),
              left: round(minimumX),
              right: round(maximumX),
              bottom: round(maximumY),
              width: round(maximumX - minimumX),
              height: round(maximumY - minimumY),
            } : null;
            const margins = bounds ? {
              top: bounds.top,
              left: bounds.left,
              right: round(innerWidth - bounds.right),
              // Forearms may intentionally leave through the bottom edge.
              bottom: round(innerHeight - bounds.bottom),
            } : null;
            const visibleHeight = bounds
              ? Math.max(0, Math.min(innerHeight, bounds.bottom) - Math.max(0, bounds.top))
              : 0;
            const requiredMargins = {
              top: round(innerHeight * safetyGutterRatio),
              left: round(innerWidth * safetyGutterRatio),
              right: round(innerWidth * safetyGutterRatio),
            };
            results.push({
              case: `${name}/${frame.key}`,
              viewport: name,
              viewportSize: [innerWidth, innerHeight],
              weapon,
              state,
              frame: frame.frameNumber,
              key: frame.key,
              url: frame.url,
              opaquePixels,
              bounds,
              margins,
              visibleHeight: round(visibleHeight),
              visibleHeightRatio: visibleHeight / innerHeight,
              marginRatios: margins ? {
                top: minimumY / innerHeight,
                left: minimumX / innerWidth,
                right: (innerWidth - maximumX) / innerWidth,
              } : null,
              bowLimbBounds,
              actionOffsetX: Number.parseFloat(
                style.getPropertyValue('--vm-action-x'),
              ),
              requiredMargins,
              layout: {
                element: {
                  left: round(layoutLeft),
                  top: round(layoutTop),
                  width: round(elementWidth),
                  height: round(elementHeight),
                },
                renderedImage: {
                  left: round(backgroundX),
                  top: round(backgroundY),
                  width: round(renderedImageWidth),
                  height: round(renderedImageHeight),
                },
                transform: style.transform,
                transformOrigin: style.transformOrigin,
                backgroundPosition: [
                  style.backgroundPositionX,
                  style.backgroundPositionY,
                ],
              },
            });
          }
        }
      }
      return results;
    },
    { name: viewportName, safetyGutterRatio: runtimeSafetyGutterRatio },
  );
  runtimeViewmodelFrames.push(...viewportFrames);
}

const minimumRuntimeViewmodelMargins = Object.fromEntries(
  ['top', 'left', 'right'].map((edge) => {
    const minimum = runtimeViewmodelFrames.reduce((current, entry) => {
      if (!entry.marginRatios) return current;
      if (!current || entry.marginRatios[edge] < current.marginRatios[edge]) {
        return entry;
      }
      return current;
    }, null);
    return [edge, minimum ? {
      case: minimum.case,
      pixels: minimum.margins[edge],
      ratio: minimum.marginRatios[edge],
      requiredPixels: minimum.requiredMargins[edge],
      requiredRatio: runtimeSafetyGutterRatio,
    } : null];
  }),
);
const maximumRuntimeViewmodelBottomGap = runtimeViewmodelFrames.reduce(
  (current, entry) => !current || entry.margins?.bottom > current.margins?.bottom
    ? entry
    : current,
  null,
);
const minimumRuntimeViewmodelVisibleHeight = runtimeViewmodelFrames.reduce(
  (current, entry) => !current || entry.visibleHeightRatio < current.visibleHeightRatio
    ? entry
    : current,
  null,
);

const mapShots = [
  { name: 'arena-spawn', position: [0, 0, 16], yaw: 0, weapon: 'knives', state: 'idle' },
  { name: 'arena-center', position: [0, 0, 5.4], yaw: 0, weapon: 'crossbow', state: 'idle' },
];

const weaponShots = [
  ['knives', ['idle', 'fire']],
  ['shortbow', ['idle', 'draw', 'fire']],
  ['ember', ['idle', 'fire', 'reload']],
  ['crossbow', ['idle', 'fire', 'reload']],
  ['lightning', ['idle', 'fire', 'reload']],
  ['longbow', ['idle', 'draw', 'fire']],
  ['greatsword', ['idle', 'fire']],
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
  await useViewport('desktop');
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
  await capture(shot.name, 'desktop');
  await capture(shot.name, 'narrow');
  report.push(state);
}

const representativeAnimationShots = [
  ['lightning', 'fire'],
  ['crossbow', 'reload'],
  ['shortbow', 'draw'],
  ['shortbow', 'fire'],
  ['longbow', 'draw'],
  ['longbow', 'fire'],
].flatMap(([weapon, state]) => [1, 2, 3].map((frame) => ({ weapon, state, frame, total: 3 })));
representativeAnimationShots.push(
  ...[1, 2, 3, 4, 5, 6].map((frame) => ({
    weapon: 'greatsword',
    state: 'fire',
    frame,
    total: 6,
  })),
);
for (const entry of representativeAnimationShots) {
  const animationViewports = entry.weapon === 'shortbow' || entry.weapon === 'longbow'
    ? Object.keys(viewports)
    : ['desktop'];
  for (const viewportName of animationViewports) {
    await useViewport(viewportName);
    await page.evaluate((animationEntry) => {
      const game = window.__LARP_GAME__;
      const player = game.player;
      player.position.set(-8.5, 0, 8);
      player.velocity.set(0, 0, 0);
      player.yaw = -0.55;
      player.pitch = -0.08;
      player.dead = false;
      player.viewRoot.visible = true;
      player.equip(animationEntry.weapon, false);
      player.shotFrameTime = animationEntry.state === 'fire' ? 0.1 : 0;
      player.bowDrawTime = animationEntry.state === 'draw' ? 0.36 : 0;
      player.reloading = animationEntry.state === 'reload';
      player.reloadDuration = animationEntry.state === 'reload' ? 1 : 0;
      player.reloadRemaining = animationEntry.state === 'reload' ? 0.5 : 0;
      player.updateView(0, {
        moving: false,
        speed: 0,
        sprinting: false,
        sliding: false,
        wallRunning: false,
      });
      player.setViewmodelAnimationProgress(
        animationEntry.state,
        (animationEntry.frame - 0.5) / animationEntry.total,
      );
      player.syncCamera(0.5);
      game.updateHUD();
    }, entry);
    await capture(
      `animation-${entry.weapon}-${entry.state}-${entry.frame}`,
      viewportName,
    );
  }
}

const fighterReport = [];
for (const weapon of ['knives', 'shortbow', 'ember', 'crossbow', 'lightning', 'longbow', 'greatsword', 'fireball']) {
  for (const requestedState of fighterStates) {
    const fighterCase = { weapon, requestedState };
    await useViewport('desktop');
    await page.evaluate(({ weapon: weaponType, requestedState: state }) => {
      const game = window.__LARP_GAME__;
      game.player.viewRoot.visible = false;
      game.player.viewmodelLayer?.classList.remove('active');
      game.camera.position.set(-9, 1.45, 5.5);
      game.camera.rotation.set(-0.02, 0, 0);
      game.bot.position.set(-9, 0, 0);
      game.bot.velocity.set(state === 'walk' ? 2 : 0, 0, 0);
      game.bot.dead = state === 'death';
      game.bot.attackTime = state === 'attack' ? 0.2 : 0;
      game.bot.flashHit = state === 'hit' ? 0.1 : 0;
      game.bot.root.visible = true;
      game.bot.equip(weaponType);
      game.bot.animate(0, null, false);
    }, fighterCase);
    await page.waitForFunction(
      ({ weapon: weaponType, requestedState: state }) => {
        const game = window.__LARP_GAME__;
        return game.bot.sprite.userData.weapon === weaponType &&
          game.bot.sprite.userData.state === state &&
          (game.bot.spriteMaterial.map?.image?.naturalWidth || 0) > 0;
      },
      fighterCase,
    );
    const state = await page.evaluate(({ weapon: weaponType, requestedState: stateName }) => {
      const game = window.__LARP_GAME__;
      const expectedAsset = game.weapons[weaponType].asset;
      return {
        weapon: weaponType,
        requestedState: stateName,
        renderedWeapon: game.bot.sprite.userData.weapon,
        renderedState: game.bot.sprite.userData.state,
        visible: game.bot.root.visible,
        expectedAsset: `${expectedAsset}-${stateName}.webp`,
        textureUrl: game.bot.spriteMaterial.map?.image?.currentSrc || game.bot.spriteMaterial.map?.image?.src,
        imageSize: [
          game.bot.spriteMaterial.map?.image?.naturalWidth || 0,
          game.bot.spriteMaterial.map?.image?.naturalHeight || 0,
        ],
      };
    }, fighterCase);
    await capture(`fighter-${weapon}-${requestedState}`, 'desktop');
    await capture(`fighter-${weapon}-${requestedState}`, 'narrow');
    fighterReport.push(state);
  }
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
if (animationFrameReport.length !== expectedCanonicalFrameCount) {
  throw new Error(
    `Expected ${expectedCanonicalFrameCount} canonical viewmodel frames, ` +
    `found ${animationFrameReport.length}`,
  );
}
if (animationFrameReport.some((entry) =>
  entry.renderedState !== entry.state ||
  entry.renderedFrame !== entry.expectedFrame ||
  !entry.renderedUrl?.includes(entry.expectedUrl) ||
  entry.imageSize.some((size) => size < 1)
)) {
  throw new Error(`Canonical viewmodel frame mismatch: ${JSON.stringify(animationFrameReport)}`);
}
const expectedRuntimeViewmodelCases =
  expectedCanonicalFrameCount * Object.keys(viewports).length;
const uniqueRuntimeViewmodelCases = new Set(
  runtimeViewmodelFrames.map((entry) => entry.case),
);
const runtimeViewmodelGutterFailures = runtimeViewmodelFrames.filter((entry) =>
  !entry.bounds ||
  !entry.margins ||
  !entry.marginRatios ||
  ['top', 'left', 'right'].some((edge) =>
    !Number.isFinite(entry.marginRatios[edge]) ||
    entry.marginRatios[edge] < runtimeSafetyGutterRatio
  ) ||
  !Number.isFinite(entry.margins.bottom) ||
  entry.margins.bottom > 1 ||
  !Number.isFinite(entry.visibleHeightRatio) ||
  entry.visibleHeightRatio < 0.12
);
const greatswordSweepReport = Object.fromEntries(
  Object.keys(viewports).map((viewport) => {
    const frames = runtimeViewmodelFrames
      .filter((entry) =>
        entry.viewport === viewport &&
        entry.weapon === 'greatsword' &&
        entry.state === 'fire')
      .sort((left, right) => left.frame - right.frame)
      .map((entry) => ({
        frame: entry.frame,
        centerX: round((entry.bounds.left + entry.bounds.right) / 2),
      }));
    const travel = frames.length
      ? round(frames.at(-1).centerX - frames[0].centerX)
      : 0;
    return [viewport, {
      frames,
      travel,
      travelRatio: travel / viewports[viewport].width,
    }];
  }),
);
const invalidGreatswordSweeps = Object.entries(greatswordSweepReport).filter(
  ([, report]) =>
    report.frames.length !== 6 ||
    report.travelRatio < 0.15 ||
    report.frames.some((frame, index) =>
      index > 0 && frame.centerX <= report.frames[index - 1].centerX),
);
const bowSidePlacementReport = runtimeViewmodelFrames
  .filter((entry) =>
    (entry.weapon === 'shortbow' || entry.weapon === 'longbow') &&
    (entry.state === 'draw' || entry.state === 'fire'))
  .map((entry) => {
    const crosshairX = entry.viewportSize[0] / 2;
    const limbOffset = entry.bowLimbBounds?.center - crosshairX;
    return {
      case: entry.case,
      limbBounds: entry.bowLimbBounds,
      crosshairX,
      limbOffset: round(limbOffset),
      limbOffsetRatio: limbOffset / entry.viewportSize[0],
      actionOffsetX: entry.actionOffsetX,
      actionOffsetRatio: entry.actionOffsetX / entry.viewportSize[0],
    };
  });
const expectedBowSidePlacementCases = 2 * 2 * 3 * Object.keys(viewports).length;
const invalidBowSidePlacements = bowSidePlacementReport.filter((entry) =>
  !entry.limbBounds ||
  !Number.isFinite(entry.limbOffsetRatio) ||
  entry.limbOffsetRatio < bowLimbMinimumRightRatio ||
  !Number.isFinite(entry.actionOffsetRatio) ||
  entry.actionOffsetRatio < bowActionMinimumRightRatio
);
const shiftedBowIdleFrames = runtimeViewmodelFrames.filter((entry) =>
  (entry.weapon === 'shortbow' || entry.weapon === 'longbow') &&
  entry.state === 'idle' &&
  entry.actionOffsetX !== 0
);
if (
  runtimeViewmodelFrames.length !== expectedRuntimeViewmodelCases ||
  uniqueRuntimeViewmodelCases.size !== expectedRuntimeViewmodelCases ||
  runtimeViewmodelGutterFailures.length > 0
) {
  throw new Error(`Runtime viewmodel clipping audit failed: ${JSON.stringify({
    expectedCases: expectedRuntimeViewmodelCases,
    actualCases: runtimeViewmodelFrames.length,
    uniqueCases: uniqueRuntimeViewmodelCases.size,
    safetyGutterRatio: runtimeSafetyGutterRatio,
    minimumMargins: minimumRuntimeViewmodelMargins,
    maximumBottomGap: maximumRuntimeViewmodelBottomGap,
    minimumVisibleHeight: minimumRuntimeViewmodelVisibleHeight,
    failures: runtimeViewmodelGutterFailures.map((entry) => ({
      case: entry.case,
      bounds: entry.bounds,
      margins: entry.margins,
      marginRatios: entry.marginRatios,
      visibleHeight: entry.visibleHeight,
      visibleHeightRatio: entry.visibleHeightRatio,
      requiredMargins: entry.requiredMargins,
    })),
  })}`);
}
if (invalidGreatswordSweeps.length) {
  throw new Error(
    `Greatsword runtime poses do not form one broad left-to-right sweep: ` +
    JSON.stringify(greatswordSweepReport),
  );
}
if (
  bowSidePlacementReport.length !== expectedBowSidePlacementCases ||
  invalidBowSidePlacements.length ||
  shiftedBowIdleFrames.length
) {
  throw new Error(
    `Bow limbs must remain right of the crosshair in every active frame while idle stays fixed: ` +
    JSON.stringify({
      expectedCases: expectedBowSidePlacementCases,
      actualCases: bowSidePlacementReport.length,
      minimumLimbOffsetRatio: bowLimbMinimumRightRatio,
      minimumActionOffsetRatio: bowActionMinimumRightRatio,
      failures: invalidBowSidePlacements,
      shiftedIdle: shiftedBowIdleFrames.map((entry) => ({
        case: entry.case,
        actionOffsetX: entry.actionOffsetX,
      })),
    }),
  );
}
if (edgeReport.some((entry) =>
  !entry.bounds ||
  entry.margins.top < 48 || entry.margins.left < 48 || entry.margins.right < 48
)) {
  throw new Error(`A first-person photo has a hard top or side edge: ${JSON.stringify(edgeReport)}`);
}
if (report.some((entry) => Object.values(entry.loadedMaterialSizes).some(([width]) => width < 1))) {
  throw new Error(`A photographic material did not load: ${JSON.stringify(report)}`);
}
if (
  fighterReport.length !== expectedFighterStateCount ||
  new Set(fighterReport.map((entry) => entry.textureUrl)).size !== fighterReport.length ||
  fighterReport.some((entry) =>
    entry.renderedWeapon !== entry.weapon ||
    entry.renderedState !== entry.requestedState ||
    !entry.visible ||
    new URL(entry.textureUrl).pathname.split('/').at(-1) !== entry.expectedAsset ||
    entry.imageSize.some((size) => size < 1)
  )
) {
  throw new Error(`Third-person fighter states are incomplete: ${JSON.stringify(fighterReport)}`);
}
if (projectileReport.some((entry) =>
  entry.objectType !== 'Mesh' ||
  entry.geometry !== 'PlaneGeometry' ||
  entry.directionAlignment < 0.999 ||
  new URL(entry.textureUrl).pathname.split('/').at(-1) !== entry.expectedAsset
)) {
  throw new Error(`Directional photographic projectile failed: ${JSON.stringify(projectileReport)}`);
}
const assetRequestReport = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .map((entry) => new URL(entry.name))
    .filter((url) => url.pathname.startsWith('/assets/larp/'))
    .map((url) => ({
      pathname: url.pathname,
      revision: url.searchParams.get('v'),
    })),
);
const unversionedAssetRequests = assetRequestReport.filter(
  (entry) => entry.revision !== 'photo-v4-20260829',
);
if (unversionedAssetRequests.length) {
  throw new Error(`Unversioned LARP artwork requests: ${JSON.stringify(unversionedAssetRequests)}`);
}
if (errors.length) throw new Error(errors.join('\n'));

await writeFile(
  new URL('report.json', output),
  JSON.stringify({
    viewports,
    runtimeSafetyGutterRatio,
    frames: report,
    animationFrames: animationFrameReport,
    runtimeViewmodelFrames,
    minimumRuntimeViewmodelMargins,
    maximumRuntimeViewmodelBottomGap,
    minimumRuntimeViewmodelVisibleHeight,
    greatswordSweepReport,
    bowSidePlacementReport,
    representativeAnimationShots,
    edgeReport,
    expectedFighterStateCount,
    fighters: fighterReport,
    projectiles: projectileReport,
    assetRequestReport,
  }, null, 2),
);
console.log(JSON.stringify({
  viewports,
  frameCount: report.length,
  canonicalAnimationFrameCount: animationFrameReport.length,
  runtimeViewmodelFrameCount: runtimeViewmodelFrames.length,
  runtimeSafetyGutterRatio,
  runtimeViewmodelFrameBounds: runtimeViewmodelFrames.map((entry) => ({
    case: entry.case,
    bounds: entry.bounds,
    margins: entry.margins,
    requiredMargins: entry.requiredMargins,
  })),
  minimumRuntimeViewmodelMargins,
  maximumRuntimeViewmodelBottomGap,
  minimumRuntimeViewmodelVisibleHeight,
  greatswordSweepReport,
  bowSidePlacementReport,
  minimumViewmodelMargins: edgeReport.reduce(
    (minimums, entry) => ({
      top: Math.min(minimums.top, entry.margins.top),
      left: Math.min(minimums.left, entry.margins.left),
      right: Math.min(minimums.right, entry.margins.right),
    }),
    { top: Infinity, left: Infinity, right: Infinity },
  ),
  expectedFighterStateCount,
  fighterReport,
  projectileReport,
}, null, 2));
} finally {
  await browser.close();
}
