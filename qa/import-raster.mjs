import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChromium } from './browser.mjs';

const [
  inputArgument,
  outputArgument,
  sizeArgument = '768',
  scaleArgument = '1',
] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error('Usage: node qa/import-raster.mjs INPUT.png OUTPUT.webp [SIZE] [CONTENT_SCALE]');
}

const input = path.resolve(inputArgument);
const output = path.resolve(outputArgument);
const size = Math.max(1, Math.floor(Number(sizeArgument) || 768));
const contentScale = Math.min(1, Math.max(0.1, Number(scaleArgument) || 1));
const source = await readFile(input);
const browser = await launchChromium();

try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.route('http://raster-import.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/source.png') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: source });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8">',
      });
    }
  });
  await page.goto('http://raster-import.test/');
  const encoded = await page.evaluate(async ({ targetSize, scale }) => {
    const image = new Image();
    image.src = '/source.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, targetSize, targetSize);
    const containScale = Math.min(targetSize / image.naturalWidth, targetSize / image.naturalHeight);
    const drawWidth = image.naturalWidth * containScale * scale;
    const drawHeight = image.naturalHeight * containScale * scale;
    const drawX = (targetSize - drawWidth) / 2;
    // First-person sleeves intentionally continue through the bottom edge, so
    // zoomed-out imports gain top/side breathing room without floating upward.
    const drawY = targetSize - drawHeight;
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (candidate) => candidate ? resolve(candidate) : reject(new Error('WebP encoding failed')),
        'image/webp',
        0.92,
      );
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }, { targetSize: size, scale: contentScale });
  await writeFile(output, Buffer.from(encoded, 'base64'));
  console.log(`${input} -> ${output} (${size}x${size} WebP, scale ${contentScale})`);
} finally {
  await browser.close();
}
