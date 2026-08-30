import { mkdir, writeFile } from 'node:fs/promises';
import { WAR_MAP } from '../shared/warConfig.js';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/war-foliage/', import.meta.url);
const expectedFoliage = WAR_MAP.foliage;
const expectedAssets = [...new Set(expectedFoliage.map(({ asset }) => asset))];
const expectedBottomRatioByAsset = new Map(expectedAssets.map((asset) => {
  const ratios = new Set(expectedFoliage
    .filter((item) => item.asset === asset)
    .map((item) => item.visibleBottomRatio ?? 0));
  assert(ratios.size === 1, `${asset} has inconsistent authored bottom anchors`);
  return [asset, [...ratios][0]];
}));
const minimumBusyFoliageCount = 100;

function nearestFoliage(type, target) {
  const candidates = expectedFoliage.filter((item) => item.type.includes(type));
  return candidates.reduce((nearest, item) => {
    if (!nearest) return item;
    const distance = Math.hypot(item.position[0] - target[0], item.position[2] - target[1]);
    const nearestDistance = Math.hypot(
      nearest.position[0] - target[0],
      nearest.position[2] - target[1],
    );
    return distance < nearestDistance ? item : nearest;
  }, null);
}

const reviewBush = nearestFoliage('bush', [51, 23]);
const reviewTree = nearestFoliage('tree', [56, 91]);
await mkdir(output, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function capture(name, camera) {
  await page.evaluate(({
    position,
    target,
    up,
    fov,
    fogDensity = 0.0048,
    isolatedName = null,
  }) => {
    const game = window.__LARP_GAME__;
    for (const cutout of game.warArena.foliageCutouts) {
      cutout.visible = !isolatedName || cutout.name === isolatedName;
    }
    if (game.scene.fog && 'density' in game.scene.fog) game.scene.fog.density = fogDensity;
    game.camera.position.set(...position);
    game.camera.up.set(...up);
    game.camera.fov = fov;
    game.camera.near = 0.1;
    game.camera.far = 500;
    game.camera.lookAt(...target);
    game.camera.updateProjectionMatrix();
  }, camera);
  await page.waitForTimeout(300);
  const path = pathFromUrl(new URL(`${name}.png`, output));
  await page.locator('#world').screenshot({ path });
  if (camera.isolatedName) {
    await page.evaluate(() => {
      for (const cutout of window.__LARP_GAME__.warArena.foliageCutouts) {
        cutout.visible = true;
      }
    });
  }
  return path;
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__LARP_GAME__));
  await page.addStyleTag({
    content: `
      #game-root > :not(#world) { display: none !important; }
      #world { display: block !important; }
    `,
  });

  await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    game.titleAttract.stop();
    game.ensureWarWorld();
    game.activateArena(game.warArena);
    game.warArena.load(0, 404);
    game.warArena.root.visible = true;
    game.warCrowd.root.visible = false;
    game.player.viewRoot.visible = false;
    game.bot.root.visible = false;
    game.clearProjectiles();
    game.vfx.clear();
    game.mode = 'war-foliage-review';
    game.phase = 'review';
  });
  await page.waitForFunction((expectedCount) => {
    const cutouts = window.__LARP_GAME__?.warArena?.foliageCutouts ?? [];
    return cutouts.length === expectedCount && cutouts.every((cutout) =>
      cutout.children.length === 2 &&
      cutout.children.every((plane) => {
        const image = plane.material?.map?.image;
        return image?.complete && image.naturalWidth > 0;
      }));
  }, expectedFoliage.length);

  const assetReport = await page.evaluate(async (assetUrls) => {
    async function analyze(relative) {
      const image = new Image();
      image.src = relative;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimumX = canvas.width;
      let minimumY = canvas.height;
      let maximumX = -1;
      let maximumY = -1;
      let transparent = 0;
      let partial = 0;
      let opaque = 0;
      let partialNearWhite = 0;
      let partialBrightNeutral = 0;
      const edgeMaximum = { top: 0, right: 0, bottom: 0, left: 0 };
      const cornerMaximum = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
      const cornerPatch = Math.max(8, Math.floor(Math.min(canvas.width, canvas.height) * 0.025));

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          if (alpha <= 8) transparent += 1;
          else if (alpha >= 247) opaque += 1;
          else {
            partial += 1;
            if (Math.min(red, green, blue) >= 225) partialNearWhite += 1;
            if (
              Math.min(red, green, blue) >= 160 &&
              Math.max(red, green, blue) - Math.min(red, green, blue) <= 45
            ) partialBrightNeutral += 1;
          }
          if (alpha > 16) {
            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
          }
          if (y === 0) edgeMaximum.top = Math.max(edgeMaximum.top, alpha);
          if (x === canvas.width - 1) edgeMaximum.right = Math.max(edgeMaximum.right, alpha);
          if (y === canvas.height - 1) edgeMaximum.bottom = Math.max(edgeMaximum.bottom, alpha);
          if (x === 0) edgeMaximum.left = Math.max(edgeMaximum.left, alpha);
          if (x < cornerPatch && y < cornerPatch) {
            cornerMaximum.topLeft = Math.max(cornerMaximum.topLeft, alpha);
          }
          if (x >= canvas.width - cornerPatch && y < cornerPatch) {
            cornerMaximum.topRight = Math.max(cornerMaximum.topRight, alpha);
          }
          if (x < cornerPatch && y >= canvas.height - cornerPatch) {
            cornerMaximum.bottomLeft = Math.max(cornerMaximum.bottomLeft, alpha);
          }
          if (x >= canvas.width - cornerPatch && y >= canvas.height - cornerPatch) {
            cornerMaximum.bottomRight = Math.max(cornerMaximum.bottomRight, alpha);
          }
        }
      }
      const total = canvas.width * canvas.height;
      return {
        relative,
        size: [canvas.width, canvas.height],
        alpha: {
          transparent,
          partial,
          opaque,
          transparentRatio: transparent / total,
          partialNearWhite,
          partialNearWhiteRatio: partial ? partialNearWhite / partial : 0,
          partialBrightNeutral,
          partialBrightNeutralRatio: partial ? partialBrightNeutral / partial : 0,
        },
        bounds: {
          left: minimumX,
          top: minimumY,
          right: maximumX,
          bottom: maximumY,
        },
        margins: {
          left: minimumX,
          top: minimumY,
          right: canvas.width - 1 - maximumX,
          bottom: canvas.height - 1 - maximumY,
        },
        edgeMaximum,
        cornerMaximum,
      };
    }

    return Promise.all(assetUrls.map(analyze));
  }, expectedAssets);

  for (const asset of assetReport) {
    assert(asset.alpha.transparentRatio > 0.2, `${asset.relative} has no useful alpha field`);
    assert(asset.edgeMaximum.top === 0, `${asset.relative} clips the top edge`);
    assert(asset.edgeMaximum.left === 0, `${asset.relative} clips the left edge`);
    assert(asset.edgeMaximum.right === 0, `${asset.relative} clips the right edge`);
    assert(asset.margins.top >= 1, `${asset.relative} has no transparent top framing`);
    assert(asset.margins.left >= 1, `${asset.relative} has no transparent left framing`);
    assert(asset.margins.right >= 1, `${asset.relative} has no transparent right framing`);
    const actualBottomRatio = asset.margins.bottom / asset.size[1];
    const expectedBottomRatio = expectedBottomRatioByAsset.get(asset.relative) ?? 0;
    assert(
      Math.abs(actualBottomRatio - expectedBottomRatio) <= 0.006,
      `${asset.relative} bottom anchor ${actualBottomRatio.toFixed(4)} does not match authored ${expectedBottomRatio.toFixed(4)}`,
    );
    assert(
      Object.values(asset.cornerMaximum).every((alpha) => alpha === 0),
      `${asset.relative} has a visible backing corner`,
    );
    assert(
      asset.alpha.partialNearWhiteRatio < 0.02,
      `${asset.relative} has a suspicious white fringe`,
    );
  }

  const geometryBefore = await page.evaluate((mapBounds) => {
    const arena = window.__LARP_GAME__.warArena;
    return arena.foliageCutouts.map((cutout) => {
      const [first, second] = cutout.children;
      const width = first.geometry.parameters.width;
      const height = first.geometry.parameters.height;
      return {
        name: cutout.name,
        asset: cutout.userData.asset,
        type: cutout.type,
        position: cutout.position.toArray(),
        rotation: cutout.rotation.toArray().slice(0, 3),
        childCount: cutout.children.length,
        childTypes: cutout.children.map((plane) => plane.type),
        childYaws: cutout.children.map((plane) => plane.rotation.y),
        childPositions: cutout.children.map((plane) => plane.position.toArray()),
        childScales: cutout.children.map((plane) => plane.scale.toArray()),
        geometryIds: cutout.children.map((plane) => plane.geometry.uuid),
        materialIds: cutout.children.map((plane) => plane.material.uuid),
        mapIds: cutout.children.map((plane) => plane.material.map?.uuid),
        size: [width, height],
        worldPlaneBaseY: cutout.position.y + first.position.y - height / 2,
        fieldClearance: {
          x: mapBounds.x - (Math.abs(cutout.position.x) + width / 2),
          z: mapBounds.z - (Math.abs(cutout.position.z) + width / 2),
        },
      };
    });
  }, WAR_MAP.bounds);

  assert(
    geometryBefore.length === expectedFoliage.length,
    `expected ${expectedFoliage.length} authored foliage props, found ${geometryBefore.length}`,
  );
  assert(
    geometryBefore.length >= minimumBusyFoliageCount,
    `War still looks sparse: expected at least ${minimumBusyFoliageCount} foliage props, found ${geometryBefore.length}`,
  );
  assert(
    new Set(geometryBefore.map(({ name }) => name)).size === geometryBefore.length,
    'foliage instance positions/names are not unique',
  );
  const authoredByName = new Map(
    expectedFoliage.map((item) => [`war-${item.id}`, item]),
  );
  for (const cutout of geometryBefore) {
    const authored = authoredByName.get(cutout.name);
    assert(authored, `${cutout.name} is not present in WAR_MAP.foliage`);
    assert(cutout.asset === authored.asset, `${cutout.name} rendered the wrong asset`);
    assert(
      JSON.stringify(cutout.position) === JSON.stringify(authored.position),
      `${cutout.name} moved away from its authored position`,
    );
    assert(cutout.type === 'Group', `${cutout.name} is not a Group`);
    assert(cutout.childCount === 2, `${cutout.name} does not have exactly two planes`);
    assert(cutout.childTypes.every((type) => type === 'Mesh'), `${cutout.name} contains a billboard/Sprite`);
    assert(cutout.childYaws[0] === 0, `${cutout.name} first plane moved from zero yaw`);
    assert(cutout.childYaws[1] === Math.PI / 2, `${cutout.name} planes are not 90 degrees apart`);
    assert(new Set(cutout.geometryIds).size === 1, `${cutout.name} planes do not share identical geometry`);
    assert(new Set(cutout.materialIds).size === 1, `${cutout.name} planes do not share identical material`);
    assert(new Set(cutout.mapIds).size === 1, `${cutout.name} planes do not share one texture`);
    assert(cutout.childScales.every((scale) => scale.every((value) => value === 1)), `${cutout.name} plane is warped`);
    const worldVisibleBaseY = cutout.worldPlaneBaseY +
      cutout.size[1] * (authored.visibleBottomRatio ?? 0);
    assert(
      Math.abs(worldVisibleBaseY) < 1e-8,
      `${cutout.name} visible pixels float above or sink below the ground`,
    );
    assert(cutout.fieldClearance.x >= 0 && cutout.fieldClearance.z >= 0, `${cutout.name} clips the field boundary`);
  }
  let minimumInstanceGap = Infinity;
  for (let firstIndex = 0; firstIndex < geometryBefore.length; firstIndex += 1) {
    const first = geometryBefore[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < geometryBefore.length; secondIndex += 1) {
      const second = geometryBefore[secondIndex];
      const centerDistance = Math.hypot(
        first.position[0] - second.position[0],
        first.position[2] - second.position[2],
      );
      const footprintGap = centerDistance - first.size[0] / 2 - second.size[0] / 2;
      minimumInstanceGap = Math.min(minimumInstanceGap, footprintGap);
    }
  }
  assert(
    minimumInstanceGap > -Math.max(...geometryBefore.map(({ size }) => size[0])) * 0.85,
    `foliage contains a near-duplicate overlap of ${-minimumInstanceGap}`,
  );

  const quadrantCounts = {
    northWest: geometryBefore.filter(({ position }) => position[0] < 0 && position[2] < 0).length,
    northEast: geometryBefore.filter(({ position }) => position[0] >= 0 && position[2] < 0).length,
    southWest: geometryBefore.filter(({ position }) => position[0] < 0 && position[2] >= 0).length,
    southEast: geometryBefore.filter(({ position }) => position[0] >= 0 && position[2] >= 0).length,
  };
  assert(
    Object.values(quadrantCounts).every((count) => count >= 15),
    `foliage density is lopsided across the battlefield: ${JSON.stringify(quadrantCounts)}`,
  );

  const screenshots = {};
  screenshots.eyeLevelBush = await capture('eye-level-bush-close', {
    position: [reviewBush.position[0] - 8, 1.68, reviewBush.position[2] - 6],
    target: [reviewBush.position[0], reviewBush.height * 0.42, reviewBush.position[2]],
    up: [0, 1, 0],
    fov: 52,
    isolatedName: `war-${reviewBush.id}`,
  });
  screenshots.eyeLevelTree = await capture('eye-level-tree-close', {
    position: [reviewTree.position[0] - 10, 1.68, reviewTree.position[2] - 8],
    target: [reviewTree.position[0], reviewTree.height * 0.48, reviewTree.position[2]],
    up: [0, 1, 0],
    fov: 52,
    isolatedName: `war-${reviewTree.id}`,
  });
  screenshots.eyeLevelCluster = await capture('eye-level-east-cluster', {
    position: [42, 2.15, 15],
    target: [78, 3, 27],
    up: [0, 1, 0],
    fov: 75,
  });
  screenshots.overheadAll = await capture('overhead-all-instances', {
    position: [0, 82, 72],
    target: [0, 0, 0],
    up: [0, 1, -1],
    fov: 82,
    // This diagnostic wide shot reduces only distance fog so every placed
    // instance remains readable from above; close views use gameplay fog.
    fogDensity: 0.0005,
  });
  screenshots.overheadBushCross = await capture('overhead-bush-cross', {
    position: [reviewBush.position[0] + 6, 10, reviewBush.position[2] + 4],
    target: [reviewBush.position[0], 1.2, reviewBush.position[2]],
    up: [0, 1, 0],
    fov: 30,
    isolatedName: `war-${reviewBush.id}`,
  });
  screenshots.overheadTreeCross = await capture('overhead-tree-cross', {
    position: [reviewTree.position[0] + 8, 18, reviewTree.position[2] + 6],
    target: [reviewTree.position[0], 3, reviewTree.position[2]],
    up: [0, 1, 0],
    fov: 30,
    isolatedName: `war-${reviewTree.id}`,
  });

  const geometryAfter = await page.evaluate(() =>
    window.__LARP_GAME__.warArena.foliageCutouts.map((cutout) => ({
      name: cutout.name,
      rotation: cutout.rotation.toArray().slice(0, 3),
      childYaws: cutout.children.map((plane) => plane.rotation.y),
    })),
  );
  assert(
    JSON.stringify(geometryAfter) === JSON.stringify(
      geometryBefore.map(({ name, rotation, childYaws }) => ({ name, rotation, childYaws })),
    ),
    'foliage rotated to follow one of the QA cameras',
  );

  const alphaPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    const assetCards = expectedAssets.map((asset) => {
      const absolute = new URL(asset, baseUrl).href;
      const label = asset.split('/').at(-1);
      return `<figure><div class="check"><img src="${absolute}"></div><figcaption>${label} alpha contrast</figcaption></figure>`;
    }).join('');
    await alphaPage.setContent(`
      <!doctype html>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #111; color: white; font: 20px monospace; }
        main { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; min-height: 900px; padding: 24px; }
        figure { margin: 0; min-width: 0; display: grid; grid-template-rows: 1fr auto; }
        .check {
          min-height: 0;
          display: grid;
          place-items: end center;
          overflow: hidden;
          background-color: #ff00b8;
          background-image:
            linear-gradient(45deg, #00dce8 25%, transparent 25%),
            linear-gradient(-45deg, #00dce8 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #00dce8 75%),
            linear-gradient(-45deg, transparent 75%, #00dce8 75%);
          background-size: 80px 80px;
          background-position: 0 0, 0 40px, 40px -40px, -40px 0;
        }
        img { width: 86%; height: 94%; object-fit: contain; object-position: center bottom; }
        figcaption { padding: 10px 0 0; text-align: center; }
      </style>
      <main>${assetCards}</main>
    `, { waitUntil: 'networkidle' });
    await alphaPage.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    screenshots.alphaContrast = pathFromUrl(new URL('alpha-contrast.png', output));
    await alphaPage.screenshot({ path: screenshots.alphaContrast, fullPage: true });
  } finally {
    await alphaPage.close();
  }

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  const report = {
    assets: assetReport,
    geometry: {
      count: geometryBefore.length,
      treeCount: geometryBefore.filter(({ asset }) => asset.endsWith('/tree.webp')).length,
      bushCount: geometryBefore.filter(({ asset }) => asset.endsWith('/bush.webp')).length,
      exactPlaneCount: geometryBefore.reduce((sum, cutout) => sum + cutout.childCount, 0),
      planeAngleDegrees: 90,
      cameraRotationStable: true,
      quadrantCounts,
      reviewTargets: {
        bush: reviewBush.id,
        tree: reviewTree.id,
      },
      minimumFieldClearance: {
        x: Math.min(...geometryBefore.map(({ fieldClearance }) => fieldClearance.x)),
        z: Math.min(...geometryBefore.map(({ fieldClearance }) => fieldClearance.z)),
      },
      minimumInstanceGap,
      minimumVisibleBaseY: Math.min(...geometryBefore.map((cutout) => {
        const authored = authoredByName.get(cutout.name);
        return cutout.worldPlaneBaseY + cutout.size[1] * (authored.visibleBottomRatio ?? 0);
      })),
      maximumVisibleBaseY: Math.max(...geometryBefore.map((cutout) => {
        const authored = authoredByName.get(cutout.name);
        return cutout.worldPlaneBaseY + cutout.size[1] * (authored.visibleBottomRatio ?? 0);
      })),
      instances: geometryBefore,
    },
    screenshots,
  };
  const reportPath = pathFromUrl(new URL('report.json', output));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report: reportPath,
    assets: assetReport.map(({ relative, size, margins }) => ({ relative, size, margins })),
    geometry: {
      count: report.geometry.count,
      exactPlaneCount: report.geometry.exactPlaneCount,
      quadrantCounts,
      minimumInstanceGap,
      minimumVisibleBaseY: report.geometry.minimumVisibleBaseY,
      maximumVisibleBaseY: report.geometry.maximumVisibleBaseY,
      reviewTargets: report.geometry.reviewTargets,
    },
    screenshots,
  }, null, 2));
} finally {
  await browser.close();
}
