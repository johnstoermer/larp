import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/war-foliage/', import.meta.url);
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
  await page.evaluate(({ position, target, up, fov, fogDensity = 0.0048 }) => {
    const game = window.__LARP_GAME__;
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
  await page.waitForFunction(() => {
    const cutouts = window.__LARP_GAME__?.warArena?.foliageCutouts ?? [];
    return cutouts.length === 28 && cutouts.every((cutout) =>
      cutout.children.length === 2 &&
      cutout.children.every((plane) => {
        const image = plane.material?.map?.image;
        return image?.complete && image.naturalWidth > 0;
      }));
  });

  const assetReport = await page.evaluate(async () => {
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

    return Promise.all([
      analyze('/assets/larp/war/tree.webp'),
      analyze('/assets/larp/war/bush.webp'),
    ]);
  });

  for (const asset of assetReport) {
    assert(asset.alpha.transparentRatio > 0.2, `${asset.relative} has no useful alpha field`);
    assert(asset.edgeMaximum.top === 0, `${asset.relative} clips the top edge`);
    assert(asset.edgeMaximum.left === 0, `${asset.relative} clips the left edge`);
    assert(asset.edgeMaximum.right === 0, `${asset.relative} clips the right edge`);
    assert(
      asset.margins.bottom <= 2,
      `${asset.relative} floats ${asset.margins.bottom}px above its ground edge`,
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

  const geometryBefore = await page.evaluate(() => {
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
        worldBaseY: cutout.position.y + first.position.y - height / 2,
        fieldClearance: {
          x: 120 - (Math.abs(cutout.position.x) + width / 2),
          z: 100 - (Math.abs(cutout.position.z) + width / 2),
        },
      };
    });
  });

  assert(geometryBefore.length === 28, `expected 28 foliage props, found ${geometryBefore.length}`);
  assert(
    new Set(geometryBefore.map(({ name }) => name)).size === geometryBefore.length,
    'foliage instance positions/names are not unique',
  );
  for (const cutout of geometryBefore) {
    assert(cutout.type === 'Group', `${cutout.name} is not a Group`);
    assert(cutout.childCount === 2, `${cutout.name} does not have exactly two planes`);
    assert(cutout.childTypes.every((type) => type === 'Mesh'), `${cutout.name} contains a billboard/Sprite`);
    assert(cutout.childYaws[0] === 0, `${cutout.name} first plane moved from zero yaw`);
    assert(cutout.childYaws[1] === Math.PI / 2, `${cutout.name} planes are not 90 degrees apart`);
    assert(new Set(cutout.geometryIds).size === 1, `${cutout.name} planes do not share identical geometry`);
    assert(new Set(cutout.materialIds).size === 1, `${cutout.name} planes do not share identical material`);
    assert(new Set(cutout.mapIds).size === 1, `${cutout.name} planes do not share one texture`);
    assert(cutout.childScales.every((scale) => scale.every((value) => value === 1)), `${cutout.name} plane is warped`);
    assert(Math.abs(cutout.worldBaseY) < 1e-9, `${cutout.name} floats above or sinks below the ground`);
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
  assert(minimumInstanceGap > 0, `foliage footprints overlap by ${-minimumInstanceGap}`);

  const screenshots = {};
  screenshots.eyeLevelBush = await capture('eye-level-bush-close', {
    position: [80, 1.68, -8],
    target: [90, 1.7, -18],
    up: [0, 1, 0],
    fov: 52,
  });
  screenshots.eyeLevelTree = await capture('eye-level-tree-close', {
    position: [98, 1.68, -24],
    target: [108, 5.3, -34],
    up: [0, 1, 0],
    fov: 52,
  });
  screenshots.eyeLevelCluster = await capture('eye-level-east-cluster', {
    position: [48, 2.15, -20],
    target: [90, 3, -50],
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
    position: [96, 25, -12],
    target: [90, 0, -18],
    up: [1, 0, 1],
    fov: 34,
  });
  screenshots.overheadTreeCross = await capture('overhead-tree-cross', {
    position: [114, 38, -28],
    target: [108, 0, -34],
    up: [1, 0, 1],
    fov: 32,
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
    const treeUrl = new URL('/assets/larp/war/tree.webp', baseUrl).href;
    const bushUrl = new URL('/assets/larp/war/bush.webp', baseUrl).href;
    await alphaPage.setContent(`
      <!doctype html>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #111; color: white; font: 20px monospace; }
        main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; height: 900px; padding: 24px; }
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
      <main>
        <figure><div class="check"><img src="${treeUrl}"></div><figcaption>tree.webp alpha contrast</figcaption></figure>
        <figure><div class="check"><img src="${bushUrl}"></div><figcaption>bush.webp alpha contrast</figcaption></figure>
      </main>
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
      minimumFieldClearance: {
        x: Math.min(...geometryBefore.map(({ fieldClearance }) => fieldClearance.x)),
        z: Math.min(...geometryBefore.map(({ fieldClearance }) => fieldClearance.z)),
      },
      minimumInstanceGap,
      minimumBaseY: Math.min(...geometryBefore.map(({ worldBaseY }) => worldBaseY)),
      maximumBaseY: Math.max(...geometryBefore.map(({ worldBaseY }) => worldBaseY)),
      instances: geometryBefore,
    },
    screenshots,
  };
  const reportPath = pathFromUrl(new URL('report.json', output));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
} finally {
  await browser.close();
}
