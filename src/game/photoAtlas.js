import * as THREE from 'three';

const clonesByAtlas = new WeakMap();

function transparentPixelCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

export function loadPhotoAtlas(url) {
  const atlas = typeof document === 'undefined'
    ? new THREE.Texture()
    : new THREE.CanvasTexture(transparentPixelCanvas());
  clonesByAtlas.set(atlas, []);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;

  if (typeof document !== 'undefined') {
    new THREE.TextureLoader().load(url, (loaded) => {
      atlas.image = loaded.image;
      atlas.needsUpdate = true;
      for (const texture of clonesByAtlas.get(atlas)) {
        texture.image = loaded.image;
        texture.needsUpdate = true;
      }
      loaded.dispose();
    });
  }
  return atlas;
}

export function photoAtlasCell(atlas, index, columns, rows = 1) {
  const texture = atlas.clone();
  const row = Math.floor(index / columns);
  texture.repeat.set(1 / columns, 1 / rows);
  texture.offset.set((index % columns) / columns, (rows - row - 1) / rows);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  clonesByAtlas.get(atlas).push(texture);
  return texture;
}
