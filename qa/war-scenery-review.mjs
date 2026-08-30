import { mkdir, writeFile } from 'node:fs/promises';
import {
  WAR_MAP,
  WAR_TEAM_SIZE,
  warSpawnForSlot,
} from '../shared/warConfig.js';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/war-scenery/', import.meta.url);
const requiredGeneratedAssets = Object.freeze([
  '/assets/larp/war/watchtower.webp',
  '/assets/larp/war/supply-hut.webp',
  '/assets/larp/war/foam-barricade.webp',
  '/assets/larp/war/damaged-tree.webp',
]);
await mkdir(output, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function horizontalGap(first, second) {
  const gapX = Math.max(first[0] - second[3], second[0] - first[3], 0);
  const gapZ = Math.max(first[2] - second[5], second[2] - first[5], 0);
  return Math.hypot(gapX, gapZ);
}

function pointGap(point, bounds) {
  return Math.hypot(
    Math.max(bounds[0] - point[0], point[0] - bounds[3], 0),
    Math.max(bounds[2] - point[2], point[2] - bounds[5], 0),
  );
}

function boundsKey(bounds) {
  return bounds.map((value) => Number(value).toFixed(4)).join(':');
}

function densityQuadrants(items) {
  return {
    northWest: items.filter(({ position }) => position[0] < 0 && position[2] < 0).length,
    northEast: items.filter(({ position }) => position[0] >= 0 && position[2] < 0).length,
    southWest: items.filter(({ position }) => position[0] < 0 && position[2] >= 0).length,
    southEast: items.filter(({ position }) => position[0] >= 0 && position[2] >= 0).length,
  };
}

const structureParts = WAR_MAP.structureParts ?? [];
const surfaces = WAR_MAP.surfaces ?? [];
const photoProps = WAR_MAP.photoProps ?? [];
const foliage = WAR_MAP.foliage ?? [];
const landmarks = WAR_MAP.landmarks ?? [];
const sectors = WAR_MAP.sectors ?? [];
const retainedLegacyCover = (WAR_MAP.legacyCover ?? [])
  .filter(({ photoReplacementId }) => !photoReplacementId);
const expectedRuntimeStructureCount = structureParts.length + retainedLegacyCover.length;
const solidStructures = structureParts.filter(({ solid, bounds }) => solid !== false && bounds);
const solidProps = photoProps.filter(({ solid, collisionBounds }) => solid !== false && collisionBounds);
const cutoutAssets = [...new Set([
  ...photoProps.map(({ asset }) => asset),
  ...foliage.map(({ asset }) => asset),
])];

assert(sectors.length >= 2, `expected both authored War sectors, found ${sectors.length}`);
assert(structureParts.length >= 100, `War has only ${structureParts.length} structure pieces`);
assert(surfaces.length >= 18, `War has only ${surfaces.length} ground-dressing surfaces`);
assert(photoProps.length >= 40, `War has only ${photoProps.length} photographic props`);
assert(foliage.length >= 100, `War has only ${foliage.length} foliage instances`);
assert(landmarks.length >= 15, `War has only ${landmarks.length} named landmarks`);

const authoredIds = [...structureParts, ...surfaces, ...photoProps, ...foliage]
  .map(({ id }) => id);
assert(
  authoredIds.every(Boolean) && new Set(authoredIds).size === authoredIds.length,
  'integrated War scenery IDs are missing or duplicated',
);
for (const asset of requiredGeneratedAssets) {
  assert(cutoutAssets.includes(asset), `${asset} was generated but is not used by WAR_MAP`);
}

const colliderKeys = new Set(WAR_MAP.colliders.map(boundsKey));
for (const structure of solidStructures) {
  assert(
    colliderKeys.has(boundsKey(structure.bounds)),
    `${structure.id} is visible and solid but missing from authoritative colliders`,
  );
}
for (const prop of solidProps) {
  assert(
    colliderKeys.has(boundsKey(prop.collisionBounds)),
    `${prop.id} has a visual footprint but no authoritative collider`,
  );
}

for (const prop of photoProps) {
  assert(prop.position?.length === 3, `${prop.id} has no world position`);
  assert(prop.width > 0 && prop.height > 0, `${prop.id} has invalid display dimensions`);
  if (!prop.collisionBounds) continue;
  for (const structure of solidStructures) {
    assert(
      horizontalGap(prop.collisionBounds, structure.bounds) >= 0.35,
      `${prop.id} is embedded in structure ${structure.id}`,
    );
  }
}
for (let first = 0; first < solidProps.length; first += 1) {
  for (let second = first + 1; second < solidProps.length; second += 1) {
    assert(
      horizontalGap(solidProps[first].collisionBounds, solidProps[second].collisionBounds) >= 0.35,
      `${solidProps[first].id} is embedded in prop ${solidProps[second].id}`,
    );
  }
}

const playableColliders = WAR_MAP.colliders.filter((bounds) => bounds[1] >= 0);
for (const bounds of playableColliders) {
  assert(
    pointGap(WAR_MAP.objective.position, bounds) >= WAR_MAP.objective.radius + 3,
    `solid scenery enters the objective safety ring: ${bounds.join(',')}`,
  );
}
for (let team = 0; team < 2; team += 1) {
  for (let slot = 0; slot < WAR_TEAM_SIZE; slot += 1) {
    const spawn = warSpawnForSlot(team, slot);
    for (const bounds of playableColliders) {
      assert(
        pointGap(spawn, bounds) >= 2,
        `team ${team} slot ${slot} is crowded by scenery ${bounds.join(',')}`,
      );
    }
  }
}

const denseItems = [...structureParts, ...photoProps, ...foliage];
const quadrantCounts = densityQuadrants(denseItems);
assert(
  Object.values(quadrantCounts).every((count) => count >= 45),
  `War scenery is not dense in every quadrant: ${JSON.stringify(quadrantCounts)}`,
);
const occupiedCells = new Set(denseItems.map(({ position }) => {
  const column = Math.floor((position[0] + WAR_MAP.bounds.x) / 20);
  const row = Math.floor((position[2] + WAR_MAP.bounds.z) / 20);
  return `${column}:${row}`;
}));
assert(occupiedCells.size >= 80, `War scenery occupies only ${occupiedCells.size} battlefield cells`);

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

async function capture(name, position, target, fov = 72, fogDensity = 0.0035) {
  await page.evaluate(({ eye, focus, fieldOfView, density }) => {
    const game = window.__LARP_GAME__;
    if (game.scene.fog && 'density' in game.scene.fog) game.scene.fog.density = density;
    game.camera.position.set(...eye);
    game.camera.up.set(0, 1, 0);
    game.camera.fov = fieldOfView;
    game.camera.near = 0.08;
    game.camera.far = 500;
    game.camera.lookAt(...focus);
    game.camera.updateProjectionMatrix();
    game.rendering.render(0, game.elapsed);
  }, { eye: position, focus: target, fieldOfView: fov, density: fogDensity });
  await page.waitForTimeout(220);
  const path = pathFromUrl(new URL(`${name}.png`, output));
  await page.locator('#world').screenshot({ path });
  return path;
}

async function inspectApproach(position, target) {
  return page.evaluate(({ eye, focus }) => {
    const game = window.__LARP_GAME__;
    const arena = game.warArena;
    const camera = game.camera;
    camera.position.set(...eye);
    camera.up.set(0, 1, 0);
    camera.fov = 72;
    camera.near = 0.08;
    camera.far = 500;
    camera.lookAt(...focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const raycaster = arena.raycaster;
    const mainRoad = arena.roadMeshes.filter(({ userData }) =>
      userData.roadKind === 'main-road');
    const centerSampleY = [-0.85, -0.65, -0.45, -0.3, -0.2, -0.12];
    const centerMainRoad = centerSampleY.map((y) => {
      raycaster.setFromCamera({ x: 0, y }, camera);
      return raycaster.intersectObjects(mainRoad, false).length > 0;
    });
    let sampled = 0;
    let roadHits = 0;
    for (const y of [-0.85, -0.65, -0.45, -0.3, -0.2, -0.12]) {
      for (const x of [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8]) {
        raycaster.setFromCamera({ x, y }, camera);
        roadHits += raycaster.intersectObjects(mainRoad, false).length > 0 ? 1 : 0;
        sampled += 1;
      }
    }

    const projectedDressing = [...arena.photoPropCutouts, ...arena.foliageCutouts]
      .map((node) => {
        const world = camera.position.clone();
        node.getWorldPosition(world);
        const distance = world.distanceTo(camera.position);
        const projected = world.clone().project(camera);
        return {
          name: node.name,
          distance,
          projected: projected.toArray(),
        };
      })
      .filter(({ distance, projected }) =>
        distance >= 8 &&
        distance <= 52 &&
        Math.abs(projected[0]) <= 1.05 &&
        projected[1] >= -1.05 &&
        projected[1] <= 1.05 &&
        projected[2] <= 1);
    return {
      centerSampleY,
      centerMainRoad,
      mainRoadCoverage: roadHits / sampled,
      projectedDressingCount: projectedDressing.length,
      projectedDressing,
    };
  }, { eye: position, focus: target });
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
    game.warArena.load(0, 818);
    game.warArena.root.visible = true;
    game.warCrowd.root.visible = false;
    game.player.viewRoot.visible = false;
    game.bot.root.visible = false;
    game.remote.clear();
    game.clearProjectiles();
    game.vfx.clear();
    game.mode = 'war-scenery-review';
    game.phase = 'review';
  });
  await page.waitForFunction((counts) => {
    const arena = window.__LARP_GAME__?.warArena;
    if (!arena) return false;
    const photosReady = (arena.photoPropCutouts ?? []).every((cutout) =>
      cutout.children.every((plane) => {
        const image = plane.material?.map?.image;
        return image?.complete && image.naturalWidth > 0;
      }));
    const foliageReady = (arena.foliageCutouts ?? []).every((cutout) =>
      cutout.children.every((plane) => {
        const image = plane.material?.map?.image;
        return image?.complete && image.naturalWidth > 0;
      }));
    return (
      arena.structureMeshes?.length === counts.structures &&
      arena.surfaceMeshes?.length === counts.surfaces &&
      arena.photoPropCutouts?.length === counts.props &&
      arena.foliageCutouts?.length === counts.foliage &&
      photosReady &&
      foliageReady
    );
  }, {
    structures: expectedRuntimeStructureCount,
    surfaces: surfaces.length,
    props: photoProps.length,
    foliage: foliage.length,
  });

  const runtime = await page.evaluate(() => {
    const arena = window.__LARP_GAME__.warArena;
    const fixedFoliage = arena.foliageCutouts.every((cutout) =>
      cutout.type === 'Group' &&
      cutout.userData.fixedCrossedPlane === true &&
      cutout.children.length === 2 &&
      cutout.children.every((plane) => plane.type === 'Mesh' && !plane.isSprite) &&
      cutout.children[0].geometry === cutout.children[1].geometry &&
      cutout.children[0].material === cutout.children[1].material &&
      cutout.children[0].rotation.y === 0 &&
      cutout.children[1].rotation.y === Math.PI / 2);
    return {
      structures: arena.structureMeshes.length,
      surfaces: arena.surfaceMeshes.length,
      props: arena.photoPropCutouts.length,
      foliage: arena.foliageCutouts.length,
      fixedFoliage,
      fixedPhotoProps: arena.photoPropCutouts.every((cutout) =>
        cutout.type === 'Mesh' &&
        !cutout.isSprite &&
        cutout.userData.fixedPhotoProp === true),
      photoAssets: arena.photoPropCutouts.map((cutout) => cutout.userData.asset),
      foliageAssets: arena.foliageCutouts.map((cutout) => cutout.userData.asset),
    };
  });
  assert(runtime.fixedFoliage, 'at least one foliage item became a sprite or camera billboard');
  assert(runtime.fixedPhotoProps, 'at least one War prop became a camera-following sprite');
  assert(
    JSON.stringify([...new Set(runtime.photoAssets)].sort()) ===
      JSON.stringify([...new Set(photoProps.map(({ asset }) => asset))].sort()),
    'runtime photo assets differ from WAR_MAP.photoProps',
  );
  assert(
    JSON.stringify([...new Set(runtime.foliageAssets)].sort()) ===
      JSON.stringify([...new Set(foliage.map(({ asset }) => asset))].sort()),
    'runtime foliage assets differ from WAR_MAP.foliage',
  );

  const assetReport = await page.evaluate(async (assets) => {
    async function analyze(asset) {
      const image = new Image();
      image.src = asset;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0;
      let visible = 0;
      let partial = 0;
      let partialNearWhite = 0;
      let minimumX = canvas.width;
      let minimumY = canvas.height;
      let maximumX = -1;
      let maximumY = -1;
      const edges = { top: 0, right: 0, bottom: 0, left: 0 };
      const corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
      const patch = Math.max(8, Math.floor(Math.min(canvas.width, canvas.height) * 0.025));
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const red = pixels[offset];
          const green = pixels[offset + 1];
          const blue = pixels[offset + 2];
          const alpha = pixels[offset + 3];
          if (alpha <= 8) transparent += 1;
          if (alpha > 16) {
            visible += 1;
            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
          }
          if (alpha > 8 && alpha < 247) {
            partial += 1;
            if (Math.min(red, green, blue) >= 225) partialNearWhite += 1;
          }
          if (y === 0) edges.top = Math.max(edges.top, alpha);
          if (y === canvas.height - 1) edges.bottom = Math.max(edges.bottom, alpha);
          if (x === 0) edges.left = Math.max(edges.left, alpha);
          if (x === canvas.width - 1) edges.right = Math.max(edges.right, alpha);
          if (x < patch && y < patch) corners.topLeft = Math.max(corners.topLeft, alpha);
          if (x >= canvas.width - patch && y < patch) corners.topRight = Math.max(corners.topRight, alpha);
          if (x < patch && y >= canvas.height - patch) corners.bottomLeft = Math.max(corners.bottomLeft, alpha);
          if (x >= canvas.width - patch && y >= canvas.height - patch) {
            corners.bottomRight = Math.max(corners.bottomRight, alpha);
          }
        }
      }
      const total = canvas.width * canvas.height;
      return {
        asset,
        size: [canvas.width, canvas.height],
        transparentRatio: transparent / total,
        visibleRatio: visible / total,
        partialNearWhiteRatio: partial ? partialNearWhite / partial : 0,
        edges,
        corners,
        margins: {
          top: minimumY,
          left: minimumX,
          right: canvas.width - 1 - maximumX,
          bottom: canvas.height - 1 - maximumY,
        },
      };
    }
    return Promise.all(assets.map(analyze));
  }, cutoutAssets);

  for (const asset of assetReport) {
    assert(asset.transparentRatio > 0.12, `${asset.asset} has no useful alpha field`);
    assert(asset.visibleRatio > 0.045, `${asset.asset} is unexpectedly empty`);
    assert(asset.edges.top === 0, `${asset.asset} clips its top edge`);
    assert(asset.edges.left === 0, `${asset.asset} clips its left edge`);
    assert(asset.edges.right === 0, `${asset.asset} clips its right edge`);
    assert(asset.margins.top >= 1, `${asset.asset} has no transparent top framing`);
    assert(asset.margins.left >= 1, `${asset.asset} has no transparent left framing`);
    assert(asset.margins.right >= 1, `${asset.asset} has no transparent right framing`);
    assert(
      Object.values(asset.corners).every((alpha) => alpha === 0),
      `${asset.asset} has a visible rectangular backing corner`,
    );
    assert(asset.partialNearWhiteRatio < 0.05, `${asset.asset} has a suspicious white fringe`);
  }

  const screenshots = {
    northApproach: await capture('north-approach', [0, 2.1, -91], [0, 2, -5]),
    southApproach: await capture('south-approach', [0, 2.1, 91], [0, 2, 5]),
    westFlank: await capture('west-flank', [-112, 3, 56], [-46, 2.5, 3], 76),
    eastFlank: await capture('east-flank', [112, 3, -56], [46, 2.5, -3], 76),
    overhead: await capture('overhead-density', [0, 165, 92], [0, 0, 0], 76, 0.0003),
  };
  const approachViews = {
    north: await inspectApproach([0, 2.1, -91], [0, 2, -5]),
    south: await inspectApproach([0, 2.1, 91], [0, 2, 5]),
  };
  for (const [side, view] of Object.entries(approachViews)) {
    assert(
      view.centerMainRoad.slice(0, 2).every((hit) => !hit) &&
        view.centerMainRoad.slice(2).some(Boolean),
      `${side} spawn view still begins on one uninterrupted dirt slab: ${JSON.stringify(view.centerMainRoad)}`,
    );
    assert(
      view.mainRoadCoverage <= 0.35,
      `${side} main road covers ${(view.mainRoadCoverage * 100).toFixed(1)}% of sampled foreground`,
    );
    assert(
      view.projectedDressingCount >= 7,
      `${side} spawn view exposes only ${view.projectedDressingCount} nearby dressing pieces`,
    );
  }

  const alphaPage = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  try {
    const cards = cutoutAssets.map((asset) => `
      <figure>
        <div class="check"><img src="${new URL(asset, baseUrl).href}"></div>
        <figcaption>${asset.split('/').at(-1)}</figcaption>
      </figure>
    `).join('');
    await alphaPage.setContent(`
      <!doctype html>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 18px; color: #fff; background: #111; font: 17px monospace; }
        main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
        figure { margin: 0; min-width: 0; }
        .check {
          height: 330px;
          display: grid;
          place-items: end center;
          background-color: #ff00b8;
          background-image:
            linear-gradient(45deg, #00dce8 25%, transparent 25%),
            linear-gradient(-45deg, #00dce8 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #00dce8 75%),
            linear-gradient(-45deg, transparent 75%, #00dce8 75%);
          background-size: 56px 56px;
          background-position: 0 0, 0 28px, 28px -28px, -28px 0;
        }
        img { width: 94%; height: 94%; object-fit: contain; object-position: center bottom; }
        figcaption { padding-top: 7px; text-align: center; overflow-wrap: anywhere; }
      </style>
      <main>${cards}</main>
    `, { waitUntil: 'networkidle' });
    await alphaPage.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0));
    screenshots.alphaContact = pathFromUrl(new URL('alpha-contact-sheet.png', output));
    await alphaPage.screenshot({ path: screenshots.alphaContact, fullPage: true });
  } finally {
    await alphaPage.close();
  }

  const reloadLifetime = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const arena = game.warArena;
    const renderer = game.rendering.renderer;
    const sceneCounts = () => {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set();
      arena.root.traverse((node) => {
        if (node.geometry) geometries.add(node.geometry);
        const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of nodeMaterials) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        }
      });
      return {
        geometries: geometries.size,
        materials: materials.size,
        textures: textures.size,
        children: arena.root.children.length,
        structures: arena.structureMeshes.length,
        surfaces: arena.surfaceMeshes.length,
        props: arena.photoPropCutouts.length,
        foliage: arena.foliageCutouts.length,
      };
    };

    game.running = false;
    renderer.info.autoReset = false;
    for (let warmup = 0; warmup < 2; warmup += 1) {
      arena.load(0, 900 + warmup);
      renderer.render(game.scene, game.camera);
    }
    const before = { scene: sceneCounts(), renderer: { ...renderer.info.memory } };
    const samples = [];
    for (let index = 0; index < 8; index += 1) {
      arena.load(0, 910 + index);
      renderer.render(game.scene, game.camera);
      samples.push({ scene: sceneCounts(), renderer: { ...renderer.info.memory } });
    }
    const after = samples.at(-1);
    renderer.info.autoReset = true;
    return {
      before,
      after,
      samples,
      geometryGrowth: after.renderer.geometries - before.renderer.geometries,
      textureGrowth: after.renderer.textures - before.renderer.textures,
      stableSceneCounts: samples.every(({ scene }) =>
        JSON.stringify(scene) === JSON.stringify(before.scene)),
    };
  });
  assert(reloadLifetime.stableSceneCounts, 'War reload changed retained scene resource counts');
  assert(
    reloadLifetime.geometryGrowth <= 0 && reloadLifetime.textureGrowth <= 0,
    `War reload leaked GPU resources: ${JSON.stringify(reloadLifetime)}`,
  );

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  const report = {
    baseUrl,
    authored: {
      sectors: sectors.length,
      landmarks: landmarks.length,
      structureParts: structureParts.length,
      solidStructures: solidStructures.length,
      retainedLegacyCover: retainedLegacyCover.length,
      surfaces: surfaces.length,
      photoProps: photoProps.length,
      solidProps: solidProps.length,
      foliage: foliage.length,
      colliders: WAR_MAP.colliders.length,
      quadrantCounts,
      occupiedCells: occupiedCells.size,
      generatedAssets: requiredGeneratedAssets,
    },
    runtime,
    assets: assetReport,
    reloadLifetime,
    approachViews,
    screenshots,
  };
  const reportPath = pathFromUrl(new URL('report.json', output));
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    report: reportPath,
    authored: report.authored,
    runtime: {
      structures: runtime.structures,
      surfaces: runtime.surfaces,
      props: runtime.props,
      foliage: runtime.foliage,
      fixedFoliage: runtime.fixedFoliage,
      fixedPhotoProps: runtime.fixedPhotoProps,
    },
    assets: assetReport.map(({ asset, size, transparentRatio, margins }) => ({
      asset,
      size,
      transparentRatio,
      margins,
    })),
    reloadLifetime: {
      geometryGrowth: reloadLifetime.geometryGrowth,
      textureGrowth: reloadLifetime.textureGrowth,
      stableSceneCounts: reloadLifetime.stableSceneCounts,
    },
    approachViews: Object.fromEntries(Object.entries(approachViews).map(([side, view]) => [side, {
      centerMainRoad: view.centerMainRoad,
      mainRoadCoverage: view.mainRoadCoverage,
      projectedDressingCount: view.projectedDressingCount,
    }])),
    screenshots,
  }, null, 2));
} finally {
  await browser.close();
}
