import * as THREE from 'three';
import { seededRandom, shuffle } from './math.js';
import { loadPhotoAtlas, photoAtlasCell } from './photoAtlas.js';

export const WEAPONS = Object.freeze({
  sidearm: {
    id: 'sidearm',
    name: 'PATIO CARBINE',
    shortName: 'CARBINE',
    ammo: 15,
    reserve: 60,
    reloadMs: 1450,
    damage: 24,
    headMultiplier: 1.7,
    interval: 0.24,
    spread: 0.008,
    focusSpread: 0.003,
    pellets: 1,
    range: 82,
    recoil: 0.62,
    automatic: false,
    projectile: false,
    fireMode: 'SEMI / 5.56',
    accent: 0xd7b35b,
    casing: 0xc99a43,
    sound: 'pistol',
  },
  machine: {
    id: 'machine',
    name: 'HOT-DOGGER SMG',
    shortName: 'HOT-DOGGER',
    ammo: 30,
    reserve: 90,
    reloadMs: 1720,
    damage: 12,
    headMultiplier: 1.55,
    interval: 0.078,
    spread: 0.027,
    focusSpread: 0.012,
    pellets: 1,
    range: 58,
    recoil: 0.26,
    automatic: true,
    projectile: false,
    fireMode: 'AUTO / 9MM',
    accent: 0xd99d2b,
    casing: 0xc99a43,
    sound: 'smg',
  },
  scatter: {
    id: 'scatter',
    name: 'HICKORY 12',
    shortName: 'HICKORY',
    ammo: 6,
    reserve: 30,
    reloadMs: 2150,
    damage: 12,
    headMultiplier: 1.28,
    interval: 0.74,
    spread: 0.094,
    focusSpread: 0.068,
    pellets: 9,
    range: 38,
    recoil: 1.62,
    automatic: false,
    projectile: false,
    fireMode: 'PUMP / 12G',
    accent: 0xb74b35,
    casing: 0xb73525,
    sound: 'shotgun',
  },
  carbine: {
    id: 'carbine',
    name: 'SHADE TREE DMR',
    shortName: 'SHADE TREE',
    ammo: 14,
    reserve: 56,
    reloadMs: 1850,
    damage: 29,
    headMultiplier: 1.75,
    interval: 0.19,
    spread: 0.011,
    focusSpread: 0.0035,
    pellets: 1,
    range: 105,
    recoil: 0.82,
    automatic: false,
    projectile: false,
    fireMode: 'SEMI / 5.56',
    accent: 0x778e67,
    casing: 0xc99a43,
    sound: 'carbine',
  },
  burst: {
    id: 'burst',
    name: 'LAWN CHAIR RIFLE',
    shortName: 'LAWN CHAIR',
    ammo: 24,
    reserve: 72,
    reloadMs: 1780,
    damage: 18,
    headMultiplier: 1.6,
    interval: 0.115,
    spread: 0.018,
    focusSpread: 0.007,
    pellets: 1,
    range: 92,
    recoil: 0.46,
    automatic: true,
    projectile: false,
    fireMode: 'AUTO / 5.45',
    accent: 0x9c5c38,
    casing: 0xc99a43,
    sound: 'rifle',
  },
  revolver: {
    id: 'revolver',
    name: 'BIG PLATE .50',
    shortName: 'BIG PLATE',
    ammo: 6,
    reserve: 30,
    reloadMs: 2050,
    damage: 47,
    headMultiplier: 1.85,
    interval: 0.43,
    spread: 0.014,
    focusSpread: 0.003,
    pellets: 1,
    range: 96,
    recoil: 1.28,
    automatic: false,
    projectile: false,
    fireMode: 'SINGLE / .50',
    accent: 0xb8aa88,
    casing: 0xc99a43,
    sound: 'revolver',
  },
  rail: {
    id: 'rail',
    name: 'MEAT THERMOMETER',
    shortName: 'THERMOMETER',
    ammo: 3,
    reserve: 12,
    reloadMs: 2420,
    damage: 82,
    headMultiplier: 1.25,
    interval: 1.08,
    spread: 0.0018,
    focusSpread: 0.0004,
    pellets: 1,
    range: 150,
    recoil: 1.85,
    automatic: false,
    projectile: false,
    fireMode: 'CHARGE / 14KV',
    accent: 0x80d9d0,
    casing: 0x80d9d0,
    sound: 'rail',
  },
  rocket: {
    id: 'rocket',
    name: 'PROPANE LAUNCHER',
    shortName: 'PROPANE',
    ammo: 3,
    reserve: 9,
    reloadMs: 2650,
    damage: 86,
    headMultiplier: 1,
    interval: 0.92,
    spread: 0.004,
    focusSpread: 0.002,
    pellets: 1,
    range: 90,
    recoil: 1.48,
    automatic: false,
    projectile: true,
    projectileSpeed: 26,
    splashRadius: 5.8,
    fireMode: 'ROCKET / 60MM',
    accent: 0xcf6238,
    casing: 0x586250,
    sound: 'rocket',
  },
});

const PICKUP_POOL = ['machine', 'scatter', 'carbine', 'burst', 'revolver', 'rail', 'rocket'];

export function getArenaLoadout(seed, count = 5) {
  return shuffle(PICKUP_POOL, seededRandom(seed)).slice(0, count);
}

const geometryCache = new Map();
const materialCache = new Map();
const weaponPhotoAtlas = loadPhotoAtlas('./assets/cookout/weapon-atlas.png');

function weaponPhotoCell(type) {
  const cell = type === 'scatter' ? 1 : type === 'rocket' ? 3 : ['rail', 'revolver'].includes(type) ? 2 : 0;
  return photoAtlasCell(weaponPhotoAtlas, cell, 4);
}

function geometry(width, height, depth, bevel = false) {
  const key = `${width}:${height}:${depth}:${bevel}`;
  if (!geometryCache.has(key)) {
    const result = new THREE.BoxGeometry(width, height, depth);
    if (bevel) {
      const positions = result.attributes.position;
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        positions.setXYZ(
          index,
          x * (Math.abs(y) > height * 0.45 ? 0.96 : 1),
          y,
          z * (Math.abs(y) > height * 0.45 ? 0.96 : 1),
        );
      }
      positions.needsUpdate = true;
      result.computeVertexNormals();
    }
    geometryCache.set(key, result);
  }
  return geometryCache.get(key);
}

function material(color, roughness = 0.68, metalness = 0.18, emissive = 0x000000) {
  const key = `${color}:${roughness}:${metalness}:${emissive}`;
  if (!materialCache.has(key)) {
    materialCache.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        emissive,
        emissiveIntensity: emissive ? 1.4 : 0,
        flatShading: true,
      }),
    );
  }
  return materialCache.get(key);
}

function addBox(group, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(
    geometry(size[0], size[1], size[2], options.bevel),
    material(
      color,
      options.roughness ?? 0.68,
      options.metalness ?? 0.18,
      options.emissive ?? 0x000000,
    ),
  );
  mesh.position.set(position[0], position[1], position[2]);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, radius, length, position, color, rotation = [Math.PI / 2, 0, 0]) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 8, 1, false),
    material(color, 0.48, 0.56),
  );
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addSight(group, z, accent) {
  addBox(group, [0.035, 0.06, 0.08], [0, 0.17, z], 0x222822);
  addBox(group, [0.018, 0.018, 0.03], [0, 0.207, z - 0.006], accent, {
    emissive: accent,
    roughness: 0.25,
    metalness: 0,
  });
}

export function createWeaponModel(type, options = {}) {
  {
    const definition = WEAPONS[type] ?? WEAPONS.sidearm;
    const group = new THREE.Group();
    group.name = `${type}-photographic-weapon-sprite`;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: weaponPhotoCell(type),
      transparent: true,
      alphaTest: 0.045,
      depthWrite: !options.viewModel,
      depthTest: true,
      fog: !options.viewModel,
      toneMapped: true,
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.name = 'stock-photo-weapon';
    sprite.scale.set(1.85, 0.78, 1);
    group.add(sprite);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(0.78, 0.03, 0);
    group.add(muzzle);
    const casingPort = new THREE.Object3D();
    casingPort.name = 'casing-port';
    casingPort.position.set(0.1, 0.08, 0);
    group.add(casingPort);
    group.userData.definition = definition;
    group.userData.muzzle = muzzle;
    group.userData.casingPort = casingPort;
    return group;
  }
  const definition = WEAPONS[type] ?? WEAPONS.sidearm;
  const group = new THREE.Group();
  group.name = `${type}-weapon-model`;
  const dark = 0x353d35;
  const black = 0x1b211b;
  const steel = 0x737d75;
  const accent = definition.accent;
  let muzzleZ = -0.72;

  if (type === 'sidearm') {
    addBox(group, [0.18, 0.2, 0.56], [0, 0.08, -0.24], dark, { bevel: true });
    addBox(group, [0.14, 0.13, 0.43], [0, 0.155, -0.28], steel, {
      roughness: 0.36,
      metalness: 0.64,
    });
    addBox(group, [0.13, 0.36, 0.18], [0, -0.15, -0.02], black, {
      rotation: [-0.18, 0, 0],
      bevel: true,
    });
    addBox(group, [0.04, 0.04, 0.05], [0, 0.24, -0.5], accent, {
      emissive: accent,
    });
    muzzleZ = -0.55;
  } else if (type === 'machine') {
    addBox(group, [0.22, 0.22, 0.73], [0, 0.03, -0.34], dark, { bevel: true });
    addBox(group, [0.16, 0.13, 0.42], [0, 0.15, -0.3], steel, {
      roughness: 0.4,
      metalness: 0.62,
    });
    addBox(group, [0.13, 0.36, 0.18], [0, -0.19, -0.12], black, {
      rotation: [-0.12, 0, 0],
    });
    addBox(group, [0.12, 0.4, 0.16], [0, -0.2, -0.42], accent, {
      rotation: [-0.08, 0, 0],
    });
    addCylinder(group, 0.055, 0.24, [0, 0.02, -0.82], 0x121612);
    addSight(group, -0.43, accent);
    muzzleZ = -0.95;
  } else if (type === 'scatter') {
    addBox(group, [0.25, 0.25, 0.8], [0, 0, -0.35], dark, { bevel: true });
    addCylinder(group, 0.072, 1.06, [0, 0.13, -0.73], 0x242b25);
    addBox(group, [0.22, 0.2, 0.4], [0, -0.01, -0.84], accent, {
      roughness: 0.82,
      metalness: 0.05,
    });
    for (let index = -1; index <= 1; index += 1) {
      addBox(group, [0.24, 0.025, 0.035], [0, 0.105, -0.77 + index * 0.1], black);
    }
    addBox(group, [0.17, 0.42, 0.19], [0, -0.24, -0.23], black, {
      rotation: [-0.22, 0, 0],
    });
    addBox(group, [0.24, 0.28, 0.46], [0, 0.01, 0.23], 0x70412e, { bevel: true });
    muzzleZ = -1.27;
  } else if (type === 'carbine') {
    addBox(group, [0.27, 0.29, 0.86], [0, 0.03, -0.35], 0x2c352a, { bevel: true });
    addBox(group, [0.2, 0.13, 0.64], [0, 0.185, -0.43], steel, {
      roughness: 0.38,
      metalness: 0.58,
    });
    addCylinder(group, 0.047, 0.65, [0, 0.09, -1.05], black);
    addBox(group, [0.16, 0.42, 0.24], [0, -0.27, -0.3], black, {
      rotation: [-0.19, 0, 0],
    });
    addBox(group, [0.16, 0.5, 0.18], [0, -0.25, -0.64], accent, {
      rotation: [0.13, 0, 0],
    });
    addBox(group, [0.22, 0.28, 0.54], [0, 0.02, 0.32], 0x4c5d46, { bevel: true });
    addSight(group, -0.72, accent);
    muzzleZ = -1.39;
  } else if (type === 'burst') {
    addBox(group, [0.3, 0.32, 0.95], [0, 0.03, -0.39], 0x2a2923, { bevel: true });
    addBox(group, [0.33, 0.16, 0.57], [0, 0.13, -0.83], accent, {
      roughness: 0.78,
      metalness: 0.08,
    });
    addCylinder(group, 0.05, 0.58, [0, 0.08, -1.18], black);
    addBox(group, [0.17, 0.47, 0.21], [0, -0.27, -0.31], black, {
      rotation: [-0.2, 0, 0],
    });
    addBox(group, [0.17, 0.52, 0.2], [0, -0.24, -0.67], 0x554635, {
      rotation: [0.16, 0, 0],
    });
    addBox(group, [0.26, 0.3, 0.5], [0, 0.03, 0.33], 0x282c26, { bevel: true });
    addSight(group, -0.56, accent);
    muzzleZ = -1.47;
  } else if (type === 'revolver') {
    addBox(group, [0.2, 0.2, 0.66], [0, 0.09, -0.4], steel, {
      roughness: 0.28,
      metalness: 0.72,
      bevel: true,
    });
    addCylinder(group, 0.18, 0.24, [0, 0.02, -0.09], 0x383e39, [0, 0, Math.PI / 2]);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      addCylinder(
        group,
        0.025,
        0.25,
        [Math.cos(angle) * 0.095, Math.sin(angle) * 0.095 + 0.02, -0.09],
        black,
        [0, 0, Math.PI / 2],
      );
    }
    addBox(group, [0.17, 0.48, 0.2], [0, -0.25, 0.12], 0x654331, {
      rotation: [-0.24, 0, 0],
      bevel: true,
    });
    addBox(group, [0.04, 0.06, 0.05], [0, 0.23, -0.67], accent, {
      emissive: accent,
    });
    muzzleZ = -0.76;
  } else if (type === 'rail') {
    addBox(group, [0.3, 0.29, 1.05], [0, 0.02, -0.46], 0x263132, { bevel: true });
    addBox(group, [0.18, 0.15, 1.22], [0, 0.17, -0.61], steel, {
      roughness: 0.33,
      metalness: 0.68,
    });
    addBox(group, [0.045, 0.06, 1.15], [-0.13, 0.17, -0.64], accent, {
      emissive: accent,
    });
    addBox(group, [0.045, 0.06, 1.15], [0.13, 0.17, -0.64], accent, {
      emissive: accent,
    });
    addBox(group, [0.17, 0.45, 0.2], [0, -0.26, -0.31], black, {
      rotation: [-0.18, 0, 0],
    });
    addBox(group, [0.26, 0.34, 0.46], [0, 0.02, 0.35], 0x1c2322, { bevel: true });
    addBox(group, [0.12, 0.24, 0.28], [0, -0.16, -0.68], accent, {
      emissive: accent,
    });
    addSight(group, -0.72, accent);
    muzzleZ = -1.23;
  } else if (type === 'rocket') {
    addCylinder(group, 0.19, 1.55, [0, 0.1, -0.56], 0x414b3f);
    addCylinder(group, 0.225, 0.24, [0, 0.1, -1.36], black);
    addCylinder(group, 0.23, 0.3, [0, 0.1, 0.25], 0x66705e);
    addBox(group, [0.18, 0.45, 0.2], [0, -0.26, -0.38], dark, {
      rotation: [-0.16, 0, 0],
    });
    addBox(group, [0.32, 0.12, 0.5], [0, 0.27, -0.52], accent, {
      roughness: 0.75,
      metalness: 0.08,
    });
    addSight(group, -0.87, accent);
    muzzleZ = -1.5;
  }

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.1, muzzleZ);
  group.add(muzzle);

  const casingPort = new THREE.Object3D();
  casingPort.name = 'casing-port';
  casingPort.position.set(0.16, 0.13, Math.max(muzzleZ + 0.55, -0.48));
  group.add(casingPort);

  if (options.viewModel) {
    group.traverse((child) => {
      if (child.isMesh) {
        child.renderOrder = 4;
        child.material = child.material.clone();
        child.material.depthTest = true;
      }
    });
  }

  group.userData.definition = definition;
  group.userData.muzzle = muzzle;
  group.userData.casingPort = casingPort;
  return group;
}

export function createPickupPedestal(accent = 0xf0a629) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.86, 0.14, 8),
    material(0x252923, 0.86, 0.12),
  );
  base.position.y = 0.07;
  base.receiveShadow = true;
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.57, 0.035, 4, 16),
    material(accent, 0.3, 0.22, accent),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  group.add(ring);

  const light = new THREE.PointLight(accent, 1.7, 4.5, 2);
  light.position.y = 0.65;
  group.add(light);
  group.userData.ring = ring;
  group.userData.light = light;
  return group;
}
