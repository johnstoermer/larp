import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COOKOUT_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});

async function sampleFrames(page, frameCount) {
  return page.evaluate(
    (count) =>
      new Promise((resolve) => {
        const deltas = [];
        let previous = performance.now();
        const step = (now) => {
          deltas.push(now - previous);
          previous = now;
          if (deltas.length < count) {
            requestAnimationFrame(step);
            return;
          }
          const sorted = [...deltas].sort((first, second) => first - second);
          const percentile = (amount) =>
            sorted[Math.floor((sorted.length - 1) * amount)];
          resolve({
            frames: deltas.length,
            mean:
              deltas.reduce((total, value) => total + value, 0) /
              deltas.length,
            p50: percentile(0.5),
            p95: percentile(0.95),
            p99: percentile(0.99),
            max: Math.max(...deltas),
            over16ms: deltas.filter((value) => value > 16.7).length,
            over25ms: deltas.filter((value) => value > 25).length,
          });
        };
        requestAnimationFrame(step);
      }),
    frameCount,
  );
}

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__COOKOUT_2_GAME__?.mode === 'match');
  await page.evaluate(() => window.__COOKOUT_2_GAME__.beginTake());
  await page.locator('#world').click({ position: { x: 960, y: 540 } });
  await page.waitForTimeout(1200);

  const baseline = await sampleFrames(page, 360);
  await page.evaluate(() => {
    const game = window.__COOKOUT_2_GAME__;
    const center = game.player.position.clone();
    center.y += 1;
    for (let index = 0; index < 4; index += 1) {
      const position = center
        .clone()
        .add(new game.camera.position.constructor(index * 1.2 - 1.8, 0.3, -5 - index));
      game.vfx.spawnExplosion(position, 4.8, index % 2 ? 0xff8a38 : 0x8feaff);
    }
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const effectsLoad = await sampleFrames(page, 360);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');

  const state = await page.evaluate(() => {
    const game = window.__COOKOUT_2_GAME__;
    return {
      renderer: game.rendering.getPerformanceState(),
      canvas: {
        width: game.canvas.width,
        height: game.canvas.height,
      },
      arena: {
        raycastMeshes: game.arena.raycastMeshes.length,
        colliders: game.arena.colliders.length,
        rootChildren: game.arena.root.children.length,
      },
      effects: {
        particles: game.vfx.particles.length,
        debris: game.vfx.debris.length,
        transients: game.vfx.transients.length,
      },
      memory: { ...game.rendering.renderer.info.memory },
    };
  });
  const adaptiveProbe = await page.evaluate(() => {
    const renderer = window.__COOKOUT_2_GAME__.rendering;
    renderer.setQualityProfile('auto');
    const startTime = renderer.time;
    for (let index = 1; index <= 170; index += 1) {
      renderer.time = startTime + index * 0.05;
      renderer.updateAdaptiveQuality(0.05);
    }
    const degraded = renderer.getPerformanceState();
    renderer.setQualityProfile('auto');
    return degraded;
  });
  const report = { baseUrl, baseline, effectsLoad, state, adaptiveProbe, errors };
  await writeFile(
    new URL('performance-report.json', output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (baseline.p95 > 25 || effectsLoad.p95 > 25) {
    throw new Error('Frame-time budget exceeded 25 ms at the 95th percentile.');
  }
  if (state.canvas.width > 1920 * 1.25 || state.canvas.height > 1080 * 1.25) {
    throw new Error(`Adaptive resolution exceeded its pixel budget: ${JSON.stringify(state.canvas)}`);
  }
  if (state.arena.raycastMeshes > 24) {
    throw new Error(`Static geometry batching regressed: ${state.arena.raycastMeshes} meshes.`);
  }
  if (state.effects.debris > 72 || state.effects.particles > 560) {
    throw new Error(`Effect pools exceeded their cap: ${JSON.stringify(state.effects)}`);
  }
  if (adaptiveProbe.renderScale >= 1 || adaptiveProbe.bloom) {
    throw new Error(`Adaptive quality did not shed load: ${JSON.stringify(adaptiveProbe)}`);
  }
  if (errors.length) throw new Error(`Browser diagnostics failed: ${errors.join('\n')}`);
} finally {
  await browser.close();
}
