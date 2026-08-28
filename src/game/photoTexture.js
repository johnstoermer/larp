import * as THREE from 'three';

const textureCache = new Map();

function transparentPixelCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

export function loadPhotoTexture(url, options = {}) {
  const cacheKey = `${url}:${options.repeatX ?? 1}:${options.repeatY ?? 1}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const texture = typeof document === 'undefined'
    ? new THREE.Texture()
    : new THREE.TextureLoader().load(
      url,
      (loaded) => {
        loaded.needsUpdate = true;
      },
      undefined,
      () => {
        texture.image = transparentPixelCanvas();
        texture.needsUpdate = true;
        // Keep the transparent placeholder. A missing cutout must never become
        // an opaque black rectangle in the world.
      },
    );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = options.repeatX || options.repeatY
    ? THREE.RepeatWrapping
    : THREE.ClampToEdgeWrapping;
  texture.wrapT = texture.wrapS;
  texture.repeat.set(options.repeatX ?? 1, options.repeatY ?? 1);
  texture.anisotropy = options.anisotropy ?? 2;
  textureCache.set(cacheKey, texture);
  return texture;
}
