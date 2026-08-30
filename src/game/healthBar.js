import * as THREE from 'three';

export const HEALTH_BAR_STYLE = Object.freeze({
  width: 96,
  height: 12,
  inset: 3,
  fill: 0xff0000,
  face: 0xc0c0c0,
  darkShadow: 0x0a0a0a,
  shadow: 0x808080,
  highlight: 0xdfdfdf,
  light: 0xffffff,
});

export const HEALTH_BAR_COLORS = Object.freeze({
  ally: 0x008000,
  enemy: 0xff0000,
});

function normalizeRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

function writePixel(data, width, x, y, color) {
  const offset = (y * width + x) * 4;
  data[offset] = (color >> 16) & 0xff;
  data[offset + 1] = (color >> 8) & 0xff;
  data[offset + 2] = color & 0xff;
  data[offset + 3] = 0xff;
}

function fillRect(data, width, left, top, right, bottom, color) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      writePixel(data, width, x, y, color);
    }
  }
}

function normalizeFillColor(value) {
  const color = Number(value);
  return Number.isInteger(color) && color >= 0 && color <= 0xffffff
    ? color
    : HEALTH_BAR_STYLE.fill;
}

export function renderHealthBarPixels(data, value, fill = HEALTH_BAR_STYLE.fill) {
  const { width, height, inset } = HEALTH_BAR_STYLE;
  const ratio = normalizeRatio(value);
  const fillColor = normalizeFillColor(fill);
  const fillCapacity = width - inset * 2;
  const fillPixels = Math.round(fillCapacity * ratio);

  fillRect(data, width, 0, 0, width, height, HEALTH_BAR_STYLE.face);

  // A compact version of the sunken field used by base 98.css: dark upper and
  // left edges, light lower and right edges, and a flat silver trough.
  fillRect(data, width, 0, 0, width, 1, HEALTH_BAR_STYLE.shadow);
  fillRect(data, width, 0, 0, 1, height, HEALTH_BAR_STYLE.shadow);
  fillRect(data, width, 1, 1, width - 1, 2, HEALTH_BAR_STYLE.darkShadow);
  fillRect(data, width, 1, 1, 2, height - 1, HEALTH_BAR_STYLE.darkShadow);
  fillRect(data, width, 0, height - 1, width, height, HEALTH_BAR_STYLE.light);
  fillRect(data, width, width - 1, 0, width, height, HEALTH_BAR_STYLE.light);
  fillRect(data, width, 1, height - 2, width - 1, height - 1, HEALTH_BAR_STYLE.highlight);
  fillRect(data, width, width - 2, 1, width - 1, height - 1, HEALTH_BAR_STYLE.highlight);

  if (fillPixels > 0) {
    fillRect(
      data,
      width,
      inset,
      inset,
      inset + fillPixels,
      height - inset,
      fillColor,
    );
  }

  return Object.freeze({
    ratio,
    fill: fillColor,
    fillPixels,
    fillCapacity,
    fillBounds: Object.freeze({
      left: inset,
      top: inset,
      right: inset + fillPixels,
      bottom: height - inset,
    }),
  });
}

export function createHealthBarTexture(value = 1, fill = HEALTH_BAR_STYLE.fill) {
  const { width, height } = HEALTH_BAR_STYLE;
  const data = new Uint8Array(width * height * 4);
  const metrics = renderHealthBarPixels(data, value, fill);
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'win98-character-health-progress';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.userData = { ...metrics };
  texture.needsUpdate = true;
  return texture;
}

export function updateHealthBarTexture(
  texture,
  value,
  fill = texture?.userData?.fill ?? HEALTH_BAR_STYLE.fill,
) {
  if (!texture?.image?.data) return null;
  const ratio = normalizeRatio(value);
  const fillColor = normalizeFillColor(fill);
  if (
    texture.userData.ratio === ratio &&
    texture.userData.fill === fillColor
  ) {
    return texture.userData;
  }
  const metrics = renderHealthBarPixels(texture.image.data, ratio, fillColor);
  texture.userData = { ...metrics };
  texture.needsUpdate = true;
  return texture.userData;
}
