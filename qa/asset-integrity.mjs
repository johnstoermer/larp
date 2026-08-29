import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, pathFromUrl } from './browser.mjs';

const assetRoot = fileURLToPath(new URL('../public/assets/larp/', import.meta.url));
const artifacts = new URL('../artifacts/asset-integrity/', import.meta.url);
const reportUrl = new URL('report.json', artifacts);
const assetOrigin = 'http://larp-assets.test';

const WEAPONS = Object.freeze([
  { id: 'knives', asset: 'throwing-knives' },
  { id: 'shortbow', asset: 'shortbow', bow: true },
  { id: 'ember', asset: 'ember-gauntlet' },
  { id: 'crossbow', asset: 'crossbow' },
  { id: 'lightning', asset: 'lightning-wand' },
  { id: 'longbow', asset: 'longbow', bow: true },
  { id: 'greatsword', asset: 'greatsword', melee: true },
  { id: 'fireball', asset: 'fireball-tome' },
]);
const FIGHTER_STATES = Object.freeze(['idle', 'walk', 'attack', 'hit', 'death']);

const EXPECTED_FIXED = Object.freeze({
  fighters: WEAPONS.flatMap(({ asset }) =>
    FIGHTER_STATES.map((state) => `${asset}-${state}.webp`)),
  pickups: WEAPONS.map(({ asset }) => `${asset}.webp`),
  props: ['archery-target.webp', 'canvas-tent.webp', 'hay-bales.webp', 'wooden-cart.webp'],
  effects: [
    'arrow.webp',
    'bolt.webp',
    'dust-impact.webp',
    'fireball.webp',
    'knife.webp',
    'lightning-impact.webp',
  ],
  materials: [
    'blue-plaster.webp',
    'cobblestone.webp',
    'dirt.webp',
    'grass.webp',
    'hedge.webp',
    'red-plaster.webp',
    'roof-shingles.webp',
    'timber.webp',
  ],
  root: ['cover.webp'],
});

function expectedViewmodels() {
  const files = [];
  const animations = [];
  for (const weapon of WEAPONS) {
    files.push(`${weapon.asset}-idle.webp`);
    const states = weapon.bow
      ? ['fire', 'reload', 'draw']
      : weapon.melee
        ? ['fire']
        : ['fire', 'reload'];
    for (const state of states) {
      const frameCount = weapon.melee && state === 'fire' ? 6 : 3;
      const frames = Array.from(
        { length: frameCount },
        (_, index) => `${weapon.asset}-${state}-${index + 1}.webp`,
      );
      files.push(...frames);
      animations.push({
        weapon: weapon.id,
        asset: weapon.asset,
        state,
        expectedCount: frameCount,
        files: frames,
      });
    }
  }
  return { files, animations };
}

const VIEWMODELS = expectedViewmodels();
const EXPECTED_BY_DIRECTORY = Object.freeze({
  fighters: EXPECTED_FIXED.fighters,
  pickups: EXPECTED_FIXED.pickups,
  props: EXPECTED_FIXED.props,
  effects: EXPECTED_FIXED.effects,
  viewmodels: VIEWMODELS.files,
  materials: EXPECTED_FIXED.materials,
  '': EXPECTED_FIXED.root,
});

const CUTOUT_DIRECTORIES = new Set(['fighters', 'pickups', 'props', 'effects', 'viewmodels']);
const LEGACY_VIEWMODEL = /^(.*)-(fire|reload|draw)\.webp$/;

async function webpFiles(directory) {
  const absolute = path.join(assetRoot, directory);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.webp'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function compareInventory(directory, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    directory: directory || '.',
    expectedCount: expected.length,
    actualCount: actual.length,
    missing: expected.filter((file) => !actualSet.has(file)),
    unexpected: actual.filter((file) => !expectedSet.has(file)),
  };
}

function entryFor(directory, file) {
  const relative = directory ? `${directory}/${file}` : file;
  if (CUTOUT_DIRECTORIES.has(directory)) {
    return {
      relative,
      directory,
      file,
      kind: directory === 'viewmodels' ? 'first-person-cutout' : 'world-cutout',
      alphaRequired: true,
      allowedOpaque: false,
    };
  }
  return {
    relative,
    directory,
    file,
    kind: directory === 'materials' ? 'opaque-material' : 'opaque-cover',
    alphaRequired: false,
    allowedOpaque: true,
  };
}

function animationInventory(actualViewmodels) {
  const actual = new Set(actualViewmodels);
  return VIEWMODELS.animations.map((animation) => ({
    ...animation,
    present: animation.files.filter((file) => actual.has(file)),
    missing: animation.files.filter((file) => !actual.has(file)),
  }));
}

function legacyDisposition(actualViewmodels) {
  const actual = new Set(actualViewmodels);
  return actualViewmodels.flatMap((file) => {
    const match = file.match(LEGACY_VIEWMODEL);
    if (!match) return [];
    const [, asset, state] = match;
    const weapon = WEAPONS.find((candidate) => candidate.asset === asset);
    const frameCount = weapon?.melee && state === 'fire' ? 6 : 3;
    const canonical = Array.from(
      { length: frameCount },
      (_, index) => `${asset}-${state}-${index + 1}.webp`,
    );
    const canonicalComplete = canonical.every((candidate) => actual.has(candidate));
    return [{ file, asset, state, canonical, canonicalComplete }];
  });
}

function inventoryMessages(inventories, legacy) {
  const errors = [];
  const warnings = [];
  for (const inventory of inventories) {
    for (const file of inventory.missing) {
      errors.push(`Missing expected ${inventory.directory} asset: ${file}`);
    }
    for (const file of inventory.unexpected) {
      if (inventory.directory === 'viewmodels' && LEGACY_VIEWMODEL.test(file)) continue;
      errors.push(`Unexpected ${inventory.directory} WebP (naming contract violation): ${file}`);
    }
  }
  for (const item of legacy) {
    const message = `Legacy unnumbered viewmodel frame: viewmodels/${item.file}`;
    if (item.canonicalComplete) errors.push(`${message}; remove it now that all canonical frames exist.`);
    else warnings.push(`${message}; the canonical frame sequence is not complete yet.`);
  }
  return { errors, warnings };
}

function validatePixelReport(entry, pixels) {
  const errors = [];
  if (!pixels.loaded) return [`Could not decode ${entry.relative}: ${pixels.error || 'unknown image error'}`];
  if (pixels.width < 1 || pixels.height < 1) errors.push(`${entry.relative} decoded with invalid dimensions.`);

  if (!entry.alphaRequired) {
    if (pixels.alpha.transparentPixels > 0 || pixels.alpha.partialPixels > 0) {
      errors.push(`${entry.relative} is an explicitly opaque asset but contains alpha.`);
    }
    return errors;
  }

  const total = pixels.width * pixels.height;
  const transparentRatio = pixels.alpha.transparentPixels / total;
  const visibleRatio = pixels.alpha.visiblePixels / total;
  if (pixels.alpha.minimum > 8 || transparentRatio < 0.01) {
    errors.push(`${entry.relative} has no meaningful transparent background (${(transparentRatio * 100).toFixed(2)}% clear).`);
  }
  if (pixels.alpha.maximum < 224 || visibleRatio < 0.002) {
    errors.push(`${entry.relative} has no substantial visible subject (${(visibleRatio * 100).toFixed(2)}% visible).`);
  }
  for (const [corner, maximum] of Object.entries(pixels.corners)) {
    if (maximum > 16) errors.push(`${entry.relative} has visible pixels in its ${corner} corner safety patch (alpha ${maximum}).`);
  }
  if (pixels.checkerboard.detected) {
    errors.push(
      `${entry.relative} appears to contain a baked checkerboard ` +
      `(tile ${pixels.checkerboard.tileSize}px, luminance separation ${pixels.checkerboard.luminanceDifference.toFixed(1)}).`,
    );
  }

  if (entry.kind === 'first-person-cutout') {
    for (const edge of ['top', 'left', 'right']) {
      if (pixels.edges[edge].maximum > 16) {
        errors.push(`${entry.relative} touches the ${edge} canvas edge (alpha ${pixels.edges[edge].maximum}).`);
      }
    }
    if (!pixels.bounds) {
      errors.push(`${entry.relative} has no measurable alpha bounds.`);
    } else {
      const required = {
        top: Math.ceil(pixels.height * 0.12),
        left: Math.ceil(pixels.width * 0.12),
        right: Math.ceil(pixels.width * 0.12),
      };
      for (const edge of ['top', 'left', 'right']) {
        if (pixels.margins[edge] < required[edge]) {
          errors.push(
            `${entry.relative} has only ${pixels.margins[edge]}px ${edge} margin; ` +
            `${required[edge]}px (12%) is required so the source reads as genuinely zoomed out.`,
          );
        }
      }
    }
  } else {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      if (pixels.edges[edge].maximum > 16) {
        errors.push(`${entry.relative} touches the ${edge} canvas edge (alpha ${pixels.edges[edge].maximum}).`);
      }
    }
  }
  return errors;
}

await mkdir(artifacts, { recursive: true });

const directories = Object.keys(EXPECTED_BY_DIRECTORY);
const actualByDirectory = Object.fromEntries(
  await Promise.all(directories.map(async (directory) => [directory, await webpFiles(directory)])),
);
const inventories = directories.map((directory) =>
  compareInventory(directory, actualByDirectory[directory], EXPECTED_BY_DIRECTORY[directory]),
);
const animations = animationInventory(actualByDirectory.viewmodels);
const legacy = legacyDisposition(actualByDirectory.viewmodels);
const inventoryResult = inventoryMessages(inventories, legacy);
const entries = directories.flatMap((directory) =>
  actualByDirectory[directory].map((file) => entryFor(directory, file)),
);
const entryByRelative = new Map(entries.map((entry) => [entry.relative, entry]));

const browser = await launchChromium();
let pixelReports;
let checkerboardHeuristic;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route(`${assetOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__qa__') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>LARP asset integrity</title>',
      });
      return;
    }
    const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!entryByRelative.has(relative)) {
      await route.fulfill({ status: 404, body: 'Not part of the LARP asset manifest.' });
      return;
    }
    try {
      const body = await readFile(path.join(assetRoot, relative));
      await route.fulfill({ status: 200, contentType: 'image/webp', body });
    } catch (error) {
      await route.fulfill({ status: 500, body: error.message });
    }
  });
  await page.goto(`${assetOrigin}/__qa__`);
  const browserAnalysis = await page.evaluate(async (assetEntries) => {
    function statistics(values) {
      if (!values.length) return { mean: 0, deviation: Infinity };
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return { mean, deviation: Math.sqrt(variance) };
    }

    function checkerboardReport(data, width, height) {
      let best = {
        detected: false,
        score: 0,
        tileSize: 0,
        qualifyingBlocks: 0,
        coverage: 0,
        luminanceDifference: 0,
        deviation: Infinity,
      };
      const tileSizes = [4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];
      for (const tileSize of tileSizes) {
        if (tileSize * 4 > Math.min(width, height)) continue;
        const columns = Math.floor(width / tileSize);
        const rows = Math.floor(height / tileSize);
        const parity = [[], []];
        let qualifyingBlocks = 0;
        for (let blockY = 0; blockY < rows; blockY += 1) {
          for (let blockX = 0; blockX < columns; blockX += 1) {
            let samples = 0;
            let neutralOpaque = 0;
            let luminance = 0;
            const stride = Math.max(1, Math.floor(tileSize / 5));
            const startX = blockX * tileSize;
            const startY = blockY * tileSize;
            for (let y = startY; y < startY + tileSize; y += stride) {
              for (let x = startX; x < startX + tileSize; x += stride) {
                const offset = (y * width + x) * 4;
                const red = data[offset];
                const green = data[offset + 1];
                const blue = data[offset + 2];
                const alpha = data[offset + 3];
                samples += 1;
                if (alpha < 245 || Math.max(red, green, blue) - Math.min(red, green, blue) > 18) continue;
                neutralOpaque += 1;
                luminance += red * 0.2126 + green * 0.7152 + blue * 0.0722;
              }
            }
            if (neutralOpaque / samples < 0.82) continue;
            qualifyingBlocks += 1;
            parity[(blockX + blockY) % 2].push(luminance / neutralOpaque);
          }
        }
        const even = statistics(parity[0]);
        const odd = statistics(parity[1]);
        const difference = Math.abs(even.mean - odd.mean);
        const deviation = Math.max(even.deviation, odd.deviation);
        const coverage = qualifyingBlocks / Math.max(1, columns * rows);
        const balance = Math.min(parity[0].length, parity[1].length);
        const score = difference * coverage / Math.max(1, deviation);
        const detected =
          qualifyingBlocks >= 20 &&
          balance >= 8 &&
          coverage >= 0.12 &&
          difference >= 12 &&
          deviation <= 12 &&
          score >= 0.55;
        if ((detected && !best.detected) || (detected === best.detected && score > best.score)) {
          best = {
            detected,
            score,
            tileSize,
            qualifyingBlocks,
            coverage,
            luminanceDifference: difference,
            deviation,
          };
        }
      }
      return best;
    }

    async function inspect(entry) {
      const image = new Image();
      image.decoding = 'async';
      image.src = `${location.origin}/${entry.relative.split('/').map(encodeURIComponent).join('/')}`;
      try {
        await image.decode();
      } catch (error) {
        return { relative: entry.relative, loaded: false, error: error.message };
      }
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, width, height).data;
      let minimumAlpha = 255;
      let maximumAlpha = 0;
      let transparentPixels = 0;
      let partialPixels = 0;
      let visiblePixels = 0;
      let opaquePixels = 0;
      let minimumX = width;
      let minimumY = height;
      let maximumX = -1;
      let maximumY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = data[(y * width + x) * 4 + 3];
          minimumAlpha = Math.min(minimumAlpha, alpha);
          maximumAlpha = Math.max(maximumAlpha, alpha);
          if (alpha <= 8) transparentPixels += 1;
          else visiblePixels += 1;
          if (alpha >= 247) opaquePixels += 1;
          else if (alpha > 8) partialPixels += 1;
          if (alpha <= 16) continue;
          minimumX = Math.min(minimumX, x);
          minimumY = Math.min(minimumY, y);
          maximumX = Math.max(maximumX, x);
          maximumY = Math.max(maximumY, y);
        }
      }

      function edgeMaximum(edge) {
        let maximum = 0;
        if (edge === 'top' || edge === 'bottom') {
          const y = edge === 'top' ? 0 : height - 1;
          for (let x = 0; x < width; x += 1) maximum = Math.max(maximum, data[(y * width + x) * 4 + 3]);
        } else {
          const x = edge === 'left' ? 0 : width - 1;
          for (let y = 0; y < height; y += 1) maximum = Math.max(maximum, data[(y * width + x) * 4 + 3]);
        }
        return maximum;
      }

      function cornerMaximum(right, bottom) {
        const patch = Math.max(2, Math.ceil(Math.min(width, height) * 0.01));
        const startX = right ? width - patch : 0;
        const startY = bottom ? height - patch : 0;
        let maximum = 0;
        for (let y = startY; y < startY + patch; y += 1) {
          for (let x = startX; x < startX + patch; x += 1) {
            maximum = Math.max(maximum, data[(y * width + x) * 4 + 3]);
          }
        }
        return maximum;
      }

      const bounds = maximumX >= 0 ? {
        left: minimumX,
        top: minimumY,
        right: maximumX,
        bottom: maximumY,
      } : null;
      return {
        relative: entry.relative,
        loaded: true,
        width,
        height,
        alpha: {
          minimum: minimumAlpha,
          maximum: maximumAlpha,
          transparentPixels,
          partialPixels,
          visiblePixels,
          opaquePixels,
        },
        bounds,
        margins: bounds ? {
          top: bounds.top,
          bottom: height - 1 - bounds.bottom,
          left: bounds.left,
          right: width - 1 - bounds.right,
        } : null,
        edges: {
          top: { maximum: edgeMaximum('top') },
          bottom: { maximum: edgeMaximum('bottom') },
          left: { maximum: edgeMaximum('left') },
          right: { maximum: edgeMaximum('right') },
        },
        corners: {
          topLeft: cornerMaximum(false, false),
          topRight: cornerMaximum(true, false),
          bottomLeft: cornerMaximum(false, true),
          bottomRight: cornerMaximum(true, true),
        },
        checkerboard: checkerboardReport(data, width, height),
      };
    }

    function syntheticCheckerboard(checkered) {
      const size = 128;
      const tileSize = 16;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      for (let y = 0; y < size; y += tileSize) {
        for (let x = 0; x < size; x += tileSize) {
          const parity = (x / tileSize + y / tileSize) % 2;
          context.fillStyle = checkered && parity ? '#d0d0d0' : '#f4f4f4';
          context.fillRect(x, y, tileSize, tileSize);
        }
      }
      return checkerboardReport(context.getImageData(0, 0, size, size).data, size, size);
    }

    const results = [];
    for (const entry of assetEntries) results.push(await inspect(entry));
    return {
      assets: results,
      checkerboardHeuristic: {
        positive: syntheticCheckerboard(true),
        negative: syntheticCheckerboard(false),
      },
    };
  }, entries);
  pixelReports = browserAnalysis.assets;
  checkerboardHeuristic = browserAnalysis.checkerboardHeuristic;
} finally {
  await browser.close();
}

const pixelErrors = [];
for (const pixels of pixelReports) {
  const entry = entryByRelative.get(pixels.relative);
  for (const error of validatePixelReport(entry, pixels)) pixelErrors.push(error);
}

const errors = [...inventoryResult.errors, ...pixelErrors];
if (!checkerboardHeuristic.positive.detected || checkerboardHeuristic.negative.detected) {
  errors.push('The baked-checkerboard heuristic failed its positive/negative synthetic control.');
}
const report = {
  generatedAt: new Date().toISOString(),
  assetRoot,
  contract: {
    weapons: WEAPONS,
    animationFrameNaming: '${asset}-${state}-1.webp through -3.webp',
    requiredAnimationFrames: 3,
    fighterStateNaming: 'fighters/${asset}-${state}.webp',
    fighterStates: FIGHTER_STATES,
    requiredFighterCutouts: WEAPONS.length * FIGHTER_STATES.length,
    firstPersonMinimumTopAndSideMargin: '6.25% of the relevant canvas dimension',
  },
  exemptions: [
    {
      files: EXPECTED_FIXED.materials.map((file) => `materials/${file}`),
      reason: 'Opaque tiling photographs intentionally cover primitive arena geometry.',
    },
    {
      files: ['cover.webp'],
      reason: 'The cover is an intentionally opaque title-screen photograph.',
    },
  ],
  summary: {
    expectedFiles: Object.values(EXPECTED_BY_DIRECTORY).reduce((sum, files) => sum + files.length, 0),
    discoveredFiles: entries.length,
    decodedFiles: pixelReports.filter((entry) => entry.loaded).length,
    errorCount: errors.length,
    warningCount: inventoryResult.warnings.length,
  },
  inventories,
  animations,
  legacyViewmodels: legacy,
  checkerboardHeuristic,
  assets: pixelReports,
  warnings: inventoryResult.warnings,
  errors,
};

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`LARP asset integrity failed with ${errors.length} error(s).`);
  for (const error of errors) console.error(`- ${error}`);
  if (inventoryResult.warnings.length) {
    console.error(`Warnings (${inventoryResult.warnings.length}):`);
    for (const warning of inventoryResult.warnings) console.error(`- ${warning}`);
  }
  console.error(`Full report: ${pathFromUrl(reportUrl)}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ...report.summary,
    report: pathFromUrl(reportUrl),
  }, null, 2));
}
