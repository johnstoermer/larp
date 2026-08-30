import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/prop-placement/', import.meta.url);
await mkdir(output, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const screenshotRecords = [];

async function capture(name, position, target, fov = 68) {
  await page.evaluate(({ position: eye, target: focus, fov: fieldOfView }) => {
    const game = window.__LARP_GAME__;
    game.camera.position.set(...eye);
    game.camera.up.set(0, 1, 0);
    game.camera.fov = fieldOfView;
    game.camera.near = 0.045;
    game.camera.far = 180;
    game.camera.lookAt(...focus);
    game.camera.updateProjectionMatrix();
    game.rendering.render(0, game.elapsed);
  }, { position, target, fov });
  await page.waitForTimeout(180);
  const path = pathFromUrl(new URL(`${name}.png`, output));
  await page.locator('#world').screenshot({ path });
  screenshotRecords.push({ name, path, position, target, fov });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__LARP_GAME__?.baseArena));
  await page.addStyleTag({
    content: `
      #game-root > :not(#world) { display: none !important; }
      #world { display: block !important; }
    `,
  });

  await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    game.titleAttract.stop();
    game.activateArena(game.baseArena);
    game.baseArena.load(0, 404);
    game.baseArena.root.visible = true;
    if (game.warCrowd) game.warCrowd.root.visible = false;
    game.player.viewRoot.visible = false;
    game.bot.root.visible = false;
    game.pickups.reset([], []);
    game.remote.clear();
    game.clearProjectiles();
    game.vfx.clear();
    game.mode = 'prop-placement-review';
    game.phase = 'review';
    if (game.scene.fog && 'density' in game.scene.fog) game.scene.fog.density = 0.0045;
  });

  await page.waitForFunction(() => {
    const props = window.__LARP_GAME__?.baseArena?.photoProps ?? [];
    return props.length === 7 && props.every(({ sprite }) => {
      const image = sprite.material?.map?.image;
      return image?.complete && image.naturalWidth > 0;
    });
  });

  const assetReport = await page.evaluate(async () => {
    async function analyze(file) {
      const image = new Image();
      image.src = `/assets/larp/props/${file}.webp`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const edgeMaximum = { top: 0, right: 0, bottom: 0, left: 0 };
      const corners = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 };
      let transparent = 0;
      let visible = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const alpha = pixels[(y * canvas.width + x) * 4 + 3];
          if (alpha <= 8) transparent += 1;
          if (alpha > 16) visible += 1;
          if (y === 0) edgeMaximum.top = Math.max(edgeMaximum.top, alpha);
          if (y === canvas.height - 1) edgeMaximum.bottom = Math.max(edgeMaximum.bottom, alpha);
          if (x === 0) edgeMaximum.left = Math.max(edgeMaximum.left, alpha);
          if (x === canvas.width - 1) edgeMaximum.right = Math.max(edgeMaximum.right, alpha);
          if (x < 8 && y < 8) corners.topLeft = Math.max(corners.topLeft, alpha);
          if (x >= canvas.width - 8 && y < 8) corners.topRight = Math.max(corners.topRight, alpha);
          if (x < 8 && y >= canvas.height - 8) corners.bottomLeft = Math.max(corners.bottomLeft, alpha);
          if (x >= canvas.width - 8 && y >= canvas.height - 8) {
            corners.bottomRight = Math.max(corners.bottomRight, alpha);
          }
        }
      }
      const total = canvas.width * canvas.height;
      return {
        file,
        size: [canvas.width, canvas.height],
        transparentRatio: transparent / total,
        visibleRatio: visible / total,
        edgeMaximum,
        corners,
      };
    }
    return Promise.all([
      analyze('wooden-cart'),
      analyze('hay-bales'),
      analyze('canvas-tent'),
      analyze('archery-target'),
    ]);
  });

  for (const asset of assetReport) {
    assert(asset.transparentRatio > 0.2, `${asset.file}: no useful transparent field`);
    assert(asset.visibleRatio > 0.1, `${asset.file}: cutout is unexpectedly empty`);
    assert(asset.edgeMaximum.top === 0, `${asset.file}: clipped at top`);
    assert(asset.edgeMaximum.left === 0, `${asset.file}: clipped at left`);
    assert(asset.edgeMaximum.right === 0, `${asset.file}: clipped at right`);
    assert(
      Object.values(asset.corners).every((alpha) => alpha === 0),
      `${asset.file}: visible rectangular backing corner`,
    );
  }

  const geometry = await page.evaluate(() => {
    const arena = window.__LARP_GAME__.baseArena;
    return arena.photoProps.map((record) => ({
      name: record.sprite.name.replace('individual-photo-prop-', ''),
      type: record.sprite.type,
      position: record.sprite.position.toArray(),
      scale: record.sprite.scale.toArray(),
      center: record.sprite.center.toArray(),
      source: record.sprite.material.map?.image?.currentSrc || '',
      collisionBounds: [...record.collisionBounds],
      collisionProxy: {
        type: record.collisionProxy.type,
        colorWrite: record.collisionProxy.material.colorWrite,
        opacity: record.collisionProxy.material.opacity,
        depthWrite: record.collisionProxy.material.depthWrite,
        castShadow: record.collisionProxy.castShadow,
        receiveShadow: record.collisionProxy.receiveShadow,
        raycastable: arena.raycastMeshes.includes(record.collisionProxy),
      },
    }));
  });

  for (const prop of geometry) {
    assert(prop.type === 'Sprite', `${prop.name}: photo can disappear edge-on`);
    assert(prop.position[1] === 0.02, `${prop.name}: ground anchor floats`);
    assert(prop.collisionProxy.colorWrite === false, `${prop.name}: proxy writes color`);
    assert(prop.collisionProxy.opacity === 0, `${prop.name}: proxy is visible`);
    assert(prop.collisionProxy.depthWrite === false, `${prop.name}: proxy writes depth`);
    assert(prop.collisionProxy.castShadow === false, `${prop.name}: proxy casts a box shadow`);
    assert(prop.collisionProxy.receiveShadow === false, `${prop.name}: proxy receives a box shadow`);
    assert(prop.collisionProxy.raycastable === true, `${prop.name}: shots pass through`);
  }

  const initialPositions = geometry.map(({ position }) => position);
  const cameraPairs = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const arena = game.baseArena;
    const visibleMeshes = arena.raycastMeshes.filter(
      (mesh) => !mesh.userData.invisiblePropCollision,
    );
    const raycaster = arena.raycaster;

    return arena.photoProps.map((record) => {
      const sprite = record.sprite;
      const targetY = Math.min(1.45, sprite.scale.y * (1 - sprite.center.y) * 0.5);
      const target = [sprite.position.x, targetY, sprite.position.z];
      const candidates = [];
      for (const radius of [6, 5, 4, 3.25]) {
        for (let step = 0; step < 32; step += 1) {
          const angle = step / 32 * Math.PI * 2;
          const x = sprite.position.x + Math.cos(angle) * radius;
          const z = sprite.position.z + Math.sin(angle) * radius;
          if (x < -20.9 || x > 20.9 || z < -16.9 || z > 16.9) continue;
          const probe = game.camera.position.clone().set(x, 0.02, z);
          if (arena.getOverlaps(probe, 0.2, 1.8, []).length) continue;
          const eye = probe.clone().setY(2.25);
          const focus = probe.clone().set(...target);
          const direction = focus.clone().sub(eye);
          const distance = direction.length();
          direction.normalize();
          raycaster.set(eye, direction);
          raycaster.near = 0;
          raycaster.far = Math.max(0, distance - 0.45);
          if (raycaster.intersectObjects(visibleMeshes, false).length) continue;
          candidates.push({ angle, radius, position: eye.toArray() });
        }
      }

      let best = null;
      for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
          const first = candidates[firstIndex];
          const second = candidates[secondIndex];
          const separation = Math.acos(Math.cos(first.angle - second.angle));
          const score = separation * 100 + Math.min(first.radius, second.radius);
          if (!best || score > best.score) best = { first, second, score, separation };
        }
      }
      if (!best) throw new Error(`${sprite.name}: no unobstructed opposing cameras`);
      return {
        name: sprite.name.replace('individual-photo-prop-', ''),
        target,
        first: best.first.position,
        second: best.second.position,
        angularSeparation: best.separation,
      };
    });
  });

  for (const pair of cameraPairs) {
    assert(pair.angularSeparation > Math.PI * 0.9, `${pair.name}: cameras are not opposing`);
    await capture(`${pair.name}-side-a`, pair.first, pair.target);
    await capture(`${pair.name}-side-b`, pair.second, pair.target);
  }

  await capture('overview-north', [0, 10.5, -16.4], [0, 0.8, 0], 78);
  await capture('overview-south', [0, 10.5, 16.4], [0, 0.8, 0], 78);

  const finalPositions = await page.evaluate(() =>
    window.__LARP_GAME__.baseArena.photoProps.map(({ sprite }) => sprite.position.toArray()));
  assert(
    JSON.stringify(finalPositions) === JSON.stringify(initialPositions),
    'a photo changed world position while cameras moved',
  );
  assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    assetReport,
    geometry,
    cameraPairs,
    screenshots: screenshotRecords,
    errors,
  };
  await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 2)}\n`);

  const contactPage = await browser.newPage({
    viewport: { width: 1240, height: 800 },
    deviceScaleFactor: 1,
  });
  const cards = await Promise.all(screenshotRecords.map(async ({ name, path }) => ({
    name,
    source: `data:image/png;base64,${(await readFile(path)).toString('base64')}`,
  })));
  await contactPage.setContent(`
    <style>
      body { margin: 0; padding: 20px; background: #202020; color: white; font: 16px sans-serif; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      figure { margin: 0; background: #111; padding: 8px; }
      img { display: block; width: 100%; height: auto; }
      figcaption { padding: 7px 2px 1px; }
    </style>
    <main>${cards.map(({ name, source }) => `
      <figure><img src="${source}"><figcaption>${name}</figcaption></figure>
    `).join('')}</main>
  `, { waitUntil: 'load' });
  await contactPage.screenshot({
    path: pathFromUrl(new URL('contact-sheet.png', output)),
    fullPage: true,
  });
  await contactPage.close();

  console.log(JSON.stringify({
    report: pathFromUrl(new URL('report.json', output)),
    contactSheet: pathFromUrl(new URL('contact-sheet.png', output)),
    screenshots: screenshotRecords.map(({ path }) => path),
  }, null, 2));
} finally {
  await browser.close();
}
