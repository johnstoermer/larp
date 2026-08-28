import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, seededRandom } from './math.js';
import { loadPhotoAtlas, photoAtlasCell } from './photoAtlas.js';

const COLOR = {
  concrete: 0x62665c,
  concreteDark: 0x4b514b,
  concreteLight: 0x8a897c,
  charcoal: 0x252b27,
  metal: 0x414b46,
  steel: 0x6a746d,
  rust: 0x754530,
  rustDark: 0x54382c,
  signal: 0xe29a2b,
  red: 0x963f30,
  blue: 0x355967,
  teal: 0x3e6763,
  leaf: 0x405b35,
  leafLight: 0x6f7f4a,
  soil: 0x45372a,
  white: 0xd9d3c0,
};

const MAPS = [
  {
    id: 'sinter',
    name: 'MILLER BACKYARD',
    code: 'CUL-DE-SAC / 18:42',
    description: 'GRILL SMOKE. SHORT SIGHTLINES.',
    background: 0x8ca9b6,
    fog: 0xb8c6ad,
    fogDensity: 0.011,
    sunColor: 0xffd394,
    sunIntensity: 2.1,
    hemiSky: 0xc2d8dc,
    hemiGround: 0x596441,
    playerSpawn: [-14, 0.02, 13.4],
    botSpawn: [14, 0.02, -13.4],
    playerYaw: -0.81,
    botYaw: 2.33,
    bounds: 21,
  },
  {
    id: 'flood',
    name: 'POOL DECK',
    code: 'WILLOW LANE / 16:07',
    description: 'LONG LANES. NO LIFEGUARD.',
    background: 0x88b7cc,
    fog: 0xb1d0d0,
    fogDensity: 0.013,
    sunColor: 0xffedbc,
    sunIntensity: 1.9,
    hemiSky: 0xbfe4ed,
    hemiGround: 0x4a6556,
    playerSpawn: [-14, 0.02, -12.6],
    botSpawn: [14, 0.02, 12.6],
    playerYaw: -2.3,
    botYaw: 0.84,
    bounds: 21,
  },
  {
    id: 'glass',
    name: 'GARDEN PARTY',
    code: 'HEDGE ROW / 19:16',
    description: 'DENSE COVER. GOLDEN HOUR.',
    background: 0x9cae93,
    fog: 0xc7c6a2,
    fogDensity: 0.012,
    sunColor: 0xffc879,
    sunIntensity: 2.35,
    hemiSky: 0xd9dfc1,
    hemiGround: 0x4d5d39,
    playerSpawn: [-12, 0.02, 12],
    botSpawn: [12, 0.02, -12],
    playerYaw: -0.79,
    botYaw: 2.36,
    bounds: 20,
  },
];

function createNoiseTexture(baseColor, seed, contrast = 16) {
  const random = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const color = new THREE.Color(baseColor);
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const variation = (random() - 0.5) * contrast;
    image.data[index] = clamp(color.r * 255 + variation, 0, 255);
    image.data[index + 1] = clamp(color.g * 255 + variation, 0, 255);
    image.data[index + 2] = clamp(color.b * 255 + variation, 0, 255);
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  for (let index = 0; index < 36; index += 1) {
    const x = Math.floor(random() * 64);
    const y = Math.floor(random() * 64);
    const alpha = 0.04 + random() * 0.08;
    context.fillStyle = `rgba(0,0,0,${alpha})`;
    context.fillRect(x, y, 1 + Math.floor(random() * 5), 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

function createStripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d28d24';
  context.fillRect(0, 0, 64, 64);
  context.strokeStyle = '#1a1b17';
  context.lineWidth = 15;
  for (let offset = -64; offset < 128; offset += 32) {
    context.beginPath();
    context.moveTo(offset, 64);
    context.lineTo(offset + 64, 0);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

const materialAtlas = loadPhotoAtlas('./assets/cookout/texture-atlas.png');
const propAtlas = loadPhotoAtlas('./assets/cookout/prop-atlas.png');

function atlasCell(base, index, columns, rows) {
  return photoAtlasCell(base, index, columns, rows);
}

function intersectsBody(position, radius, height, collider, insetY = 0.02) {
  return (
    position.x + radius > collider.min.x &&
    position.x - radius < collider.max.x &&
    position.y + height > collider.min.y + insetY &&
    position.y + insetY < collider.max.y &&
    position.z + radius > collider.min.z &&
    position.z - radius < collider.max.z
  );
}

export class Arena {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'arena';
    this.scene.add(this.root);
    this.colliders = [];
    this.raycastMeshes = [];
    this.weaponSlots = [];
    this.navNodes = [];
    this.animationNodes = [];
    this.mapIndex = 0;
    this.map = MAPS[0];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.materials = this.createMaterials();
    this.sharedGeometry = new Map();
    this.dynamicLights = [];
    this.overlapScratchA = [];
    this.overlapScratchB = [];
    this.bodyProbe = new THREE.Vector3();
    this.load(0, 1);
  }

  createMaterials() {
    const photo = (cell, color = 0xffffff, extra = {}) => {
      return new THREE.MeshLambertMaterial({
        color,
        map: atlasCell(materialAtlas, cell, 4, 2),
        flatShading: true,
        ...extra,
      });
    };

    return {
      concrete: photo(3),
      concreteDark: photo(0, 0x71815f),
      concreteLight: photo(3, 0xf2ead8),
      charcoal: photo(5, 0x74706a),
      metal: photo(4, 0x95a5a0),
      steel: photo(2, 0xb8b8aa),
      rust: photo(1, 0xb98b67),
      rustDark: photo(1, 0x80624f),
      signal: photo(7, 0xffdf72),
      red: photo(2, 0xcf8a79),
      blue: photo(4),
      teal: photo(6, 0x91ae91),
      leaf: photo(6),
      leafLight: photo(6, 0xc1d09b),
      soil: photo(5),
      white: photo(3, 0xfff7df),
      stripes: photo(7),
      lamp: photo(7, 0xffeab0, { emissive: 0x5a2a10, emissiveIntensity: 0.55 }),
      lampCool: photo(4, 0xd8f2ff, { emissive: 0x173f55, emissiveIntensity: 0.4 }),
      glass: photo(4, 0xbde1ed, { transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
      water: photo(4, 0x82cfe4, { transparent: true, opacity: 0.72, depthWrite: false }),
    };
  }

  geometry(size) {
    const key = size.join(':');
    if (!this.sharedGeometry.has(key)) {
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
      geometry.computeBoundingBox();
      this.sharedGeometry.set(key, geometry);
    }
    return this.sharedGeometry.get(key);
  }

  clear() {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((node) => {
        if (node.geometry && ![...this.sharedGeometry.values()].includes(node.geometry)) {
          node.geometry.dispose();
        }
        if (node.material?.userData?.temporary) node.material.dispose();
      });
    }
    this.colliders.length = 0;
    this.raycastMeshes.length = 0;
    this.weaponSlots.length = 0;
    this.navNodes.length = 0;
    this.animationNodes.length = 0;
    this.dynamicLights.length = 0;
  }

  load(index, seed = 1) {
    this.clear();
    this.mapIndex = ((index % MAPS.length) + MAPS.length) % MAPS.length;
    this.map = MAPS[this.mapIndex];
    this.seed = seed;
    this.random = seededRandom(seed * 977 + this.mapIndex * 313);

    this.scene.background = new THREE.Color(this.map.background);
    this.scene.fog = new THREE.FogExp2(this.map.fog, this.map.fogDensity);

    const hemisphere = new THREE.HemisphereLight(
      this.map.hemiSky,
      this.map.hemiGround,
      2.25,
    );
    this.root.add(hemisphere);

    const ambient = new THREE.AmbientLight(
      this.map.id === 'flood' ? 0xb8dbe4 : this.map.id === 'glass' ? 0xd5ddc2 : 0xd8c3a0,
      this.map.id === 'flood' ? 1.42 : 1.2,
    );
    this.root.add(ambient);

    const sun = new THREE.DirectionalLight(this.map.sunColor, this.map.sunIntensity);
    sun.position.set(-12, 23, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -27;
    sun.shadow.camera.right = 27;
    sun.shadow.camera.top = 27;
    sun.shadow.camera.bottom = -27;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 65;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    this.root.add(sun);
    this.sun = sun;

    if (this.map.id === 'sinter') this.buildSinterYard();
    if (this.map.id === 'flood') this.buildFloodChannel();
    if (this.map.id === 'glass') this.buildGlasshouse();
    this.batchStaticMeshes();
    this.addCookoutProps();
    this.addAtmosphere();
    this.addBoundaryKillPlane();
    this.root.updateMatrixWorld(true);
    return this.map;
  }

  batchStaticMeshes() {
    const animated = new Set(
      this.animationNodes.map((entry) => entry.mesh).filter(Boolean),
    );
    const raycastSet = new Set(this.raycastMeshes);
    const groups = new Map();
    for (const child of [...this.root.children]) {
      if (
        !child.isMesh ||
        child.geometry?.type !== 'BoxGeometry' ||
        !child.material ||
        animated.has(child) ||
        child.userData.noBatch
      ) {
        continue;
      }
      const raycast = raycastSet.has(child);
      const key = [
        child.material.uuid,
        child.castShadow ? 1 : 0,
        child.receiveShadow ? 1 : 0,
        raycast ? 1 : 0,
      ].join(':');
      if (!groups.has(key)) groups.set(key, { meshes: [], raycast });
      groups.get(key).meshes.push(child);
    }

    const removed = new Set();
    const mergedRaycast = [];
    for (const group of groups.values()) {
      if (group.meshes.length < 2) continue;
      const geometries = group.meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        return geometry;
      });
      const mergedGeometry = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!mergedGeometry) continue;
      const source = group.meshes[0];
      const merged = new THREE.Mesh(mergedGeometry, source.material);
      merged.name = `static-batch-${source.material.name || source.material.uuid}`;
      merged.castShadow = source.castShadow;
      merged.receiveShadow = source.receiveShadow;
      merged.frustumCulled = true;
      this.root.add(merged);
      for (const mesh of group.meshes) {
        removed.add(mesh);
        this.root.remove(mesh);
      }
      if (group.raycast) mergedRaycast.push(merged);
    }
    this.raycastMeshes = this.raycastMeshes
      .filter((mesh) => !removed.has(mesh))
      .concat(mergedRaycast);
  }

  addBox({
    position,
    size,
    material = 'concrete',
    rotation = null,
    collide = true,
    raycast = true,
    castShadow = true,
    receiveShadow = true,
    name = 'architecture',
  }) {
    const mesh = new THREE.Mesh(this.geometry(size), this.materials[material]);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.name = name;
    this.root.add(mesh);
    if (raycast) this.raycastMeshes.push(mesh);
    if (collide) {
      if (rotation && rotation.some((value) => Math.abs(value) > 0.0001)) {
        mesh.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(mesh);
        this.colliders.push({
          min: bounds.min.clone(),
          max: bounds.max.clone(),
          mesh,
          name,
        });
      } else {
        const half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
        const center = new THREE.Vector3(...position);
        this.colliders.push({
          min: center.clone().sub(half),
          max: center.clone().add(half),
          mesh,
          name,
        });
      }
    }
    return mesh;
  }

  addLamp(position, cool = false, intensity = 3.4, distance = 11) {
    this.addBox({
      position,
      size: [0.62, 0.2, 0.28],
      material: cool ? 'lampCool' : 'lamp',
      collide: false,
      castShadow: false,
      name: 'lamp',
    });
    const light = new THREE.PointLight(
      cool ? 0x82dcff : 0xffa93f,
      intensity,
      distance,
      2,
    );
    light.position.set(position[0], position[1] - 0.15, position[2]);
    this.root.add(light);
    this.dynamicLights.push({
      light,
      base: intensity,
      phase: this.random() * Math.PI * 2,
      speed: 1.2 + this.random() * 2,
    });
  }

  addPipe(start, length, axis = 'x', material = 'metal', radius = 0.28) {
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 8, 1, false),
      this.materials[material],
    );
    cylinder.position.set(...start);
    if (axis === 'x') cylinder.rotation.z = Math.PI / 2;
    if (axis === 'z') cylinder.rotation.x = Math.PI / 2;
    cylinder.castShadow = true;
    cylinder.receiveShadow = true;
    cylinder.name = 'pipe';
    this.root.add(cylinder);
    this.raycastMeshes.push(cylinder);
    return cylinder;
  }

  addSign(position, rotationY, text, color = '#e4a32d', width = 3.2) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#181b17';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = color;
    context.lineWidth = 12;
    context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    context.fillStyle = color;
    context.font = '900 64px Arial Narrow, Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 3);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    material.userData.temporary = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), material);
    mesh.position.set(...position);
    mesh.rotation.y = rotationY;
    mesh.name = 'sign';
    this.root.add(mesh);
    this.raycastMeshes.push(mesh);
  }

  addWeaponSlot(x, y, z, preferred = null) {
    this.weaponSlots.push({
      position: new THREE.Vector3(x, y, z),
      preferred,
    });
  }

  addNavNode(x, y, z, links = []) {
    this.navNodes.push({
      position: new THREE.Vector3(x, y, z),
      links,
    });
  }

  addStairs(start, direction, count = 6, width = 3, rise = 0.25, run = 0.45, material = 'metal') {
    for (let index = 0; index < count; index += 1) {
      const height = rise * (index + 1);
      const offset = run * index;
      const size =
        Math.abs(direction.x) > 0 ? [run + 0.03, height, width] : [width, height, run + 0.03];
      const position = [
        start[0] + direction.x * offset,
        start[1] + height / 2,
        start[2] + direction.z * offset,
      ];
      this.addBox({ position, size, material, name: 'stairs' });
    }
  }

  addCrates(center, arrangement = 0, material = 'rust') {
    const patterns = [
      [
        [0, 0.55, 0],
        [1.15, 0.55, 0],
        [0.58, 1.65, 0],
      ],
      [
        [0, 0.55, 0],
        [0, 0.55, 1.15],
        [0, 1.65, 0.58],
      ],
      [
        [0, 0.55, 0],
        [1.15, 0.55, 0],
      ],
    ];
    for (const offset of patterns[arrangement % patterns.length]) {
      this.addBox({
        position: [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]],
        size: [1.06, 1.06, 1.06],
        material,
        name: 'crate',
      });
      const stripeAxis = arrangement % 2 === 0 ? [0.04, 0.12, 1.08] : [1.08, 0.12, 0.04];
      this.addBox({
        position: [
          center[0] + offset[0],
          center[1] + offset[1],
          center[2] + offset[2],
        ],
        size: stripeAxis,
        material: 'metal',
        collide: false,
        name: 'crate-band',
      });
    }
  }

  buildSinterYard() {
    this.addBox({ position: [0, -0.55, 0], size: [40, 1.1, 34], material: 'concreteDark', name: 'floor' });
    this.addBox({ position: [0, 2.7, -17], size: [40, 5.4, 1], material: 'rustDark', name: 'wall' });
    this.addBox({ position: [0, 2.7, 17], size: [40, 5.4, 1], material: 'rustDark', name: 'wall' });
    this.addBox({ position: [-20, 2.7, 0], size: [1, 5.4, 35], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [20, 2.7, 0], size: [1, 5.4, 35], material: 'concreteDark', name: 'wall' });

    for (let x = -17.5; x <= 17.5; x += 5) {
      this.addBox({
        position: [x, 0.025, 0],
        size: [0.05, 0.04, 33],
        material: 'metal',
        collide: false,
        castShadow: false,
        name: 'floor-seam',
      });
    }

    this.addBox({ position: [0, 1.8, 0], size: [5.7, 3.6, 5.7], material: 'rust', name: 'kiln' });
    this.addBox({ position: [0, 3.9, 0], size: [4.5, 0.6, 4.5], material: 'charcoal', name: 'kiln-cap' });
    for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) {
      this.addBox({
        position: [x, 2.1, z],
        size: [0.48, 4.2, 0.48],
        material: 'steel',
        collide: false,
        name: 'kiln-brace',
      });
    }
    this.addBox({
      position: [0, 1.75, -2.88],
      size: [2.8, 1.7, 0.08],
      material: 'lamp',
      collide: false,
      castShadow: false,
      name: 'kiln-mouth',
    });
    const kilnLight = new THREE.PointLight(0xff692e, 9, 16, 2);
    kilnLight.position.set(0, 2.1, -4.2);
    this.root.add(kilnLight);
    this.dynamicLights.push({ light: kilnLight, base: 9, phase: 0.4, speed: 5.7 });

    this.addBox({ position: [-10.5, 1.35, -6.3], size: [7.6, 2.7, 3], material: 'red', name: 'container' });
    this.addBox({ position: [-10.5, 1.35, -4.77], size: [7.4, 2.4, 0.08], material: 'rustDark', collide: false, name: 'container-door' });
    for (let x = -13.5; x <= -7.5; x += 1.2) {
      this.addBox({ position: [x, 1.35, -4.7], size: [0.08, 2.15, 0.1], material: 'metal', collide: false, name: 'container-rib' });
    }

    this.addBox({ position: [10.4, 1.25, 6.5], size: [6.8, 2.5, 3.2], material: 'blue', name: 'container' });
    for (let x = 7.8; x <= 13.2; x += 1.15) {
      this.addBox({ position: [x, 1.3, 4.86], size: [0.07, 2.1, 0.1], material: 'metal', collide: false, name: 'container-rib' });
    }

    this.addBox({ position: [-12, 1.35, 6.7], size: [2.8, 2.7, 4], material: 'concrete', name: 'cover' });
    this.addBox({ position: [12.6, 1.2, -6.7], size: [3.2, 2.4, 3.5], material: 'concrete', name: 'cover' });
    this.addBox({ position: [-6.3, 0.85, 11.4], size: [3, 1.7, 2.2], material: 'rustDark', name: 'cover' });
    this.addBox({ position: [6.8, 0.8, -11.2], size: [3.3, 1.6, 2.2], material: 'rustDark', name: 'cover' });
    this.addCrates([-16.5, 0, -11.5], 0, 'rust');
    this.addCrates([14.5, 0, 11.4], 1, 'metal');

    this.addBox({ position: [0, 4.35, 10.8], size: [14, 0.35, 2.3], material: 'metal', name: 'catwalk' });
    this.addBox({ position: [0, 5.15, 9.72], size: [14, 1.5, 0.12], material: 'metal', collide: false, name: 'rail' });
    this.addStairs([-8.15, 0, 10.8], { x: 1, z: 0 }, 10, 2.25, 0.43, 0.62, 'metal');
    this.addStairs([8.15, 0, 10.8], { x: -1, z: 0 }, 10, 2.25, 0.43, 0.62, 'metal');

    this.addPipe([-18.8, 4.1, -9], 15, 'z', 'metal', 0.34);
    this.addPipe([18.7, 3.7, 8], 13, 'z', 'rust', 0.42);
    this.addPipe([-7, 5.1, -16.35], 12, 'x', 'steel', 0.26);
    for (const z of [-11, -5, 5, 11]) {
      this.addBox({ position: [-18.7, 2.7, z], size: [0.5, 5.4, 0.5], material: 'rust', collide: false, name: 'wall-brace' });
      this.addBox({ position: [18.7, 2.7, z], size: [0.5, 5.4, 0.5], material: 'rust', collide: false, name: 'wall-brace' });
    }

    this.addLamp([-8, 4.8, -16.3], false, 3.2, 10);
    this.addLamp([8, 4.8, -16.3], false, 3.2, 10);
    this.addLamp([-11, 4.8, 16.3], false, 2.8, 9);
    this.addLamp([11, 4.8, 16.3], false, 2.8, 9);
    this.addSign([-7.4, 2.9, -4.74], 0, 'BURGERS READY', '#ffe08a', 3.4);
    this.addSign([19.45, 3.1, -1.8], -Math.PI / 2, 'HOT GRILL', '#db5439', 3);

    this.addWeaponSlot(-7.2, 0, 0.8, 'scatter');
    this.addWeaponSlot(7.2, 0, -0.8, 'machine');
    this.addWeaponSlot(0, 4.6, 10.8, 'rail');
    this.addWeaponSlot(-14.3, 0, 7.1, 'rocket');
    this.addWeaponSlot(14.3, 0, -7.1, 'carbine');
    this.addWeaponSlot(0, 0, -10.8, 'revolver');

    for (const [x, z] of [[-14, 11], [-14, 0], [-14, -11], [-7, -10], [0, -10], [8, -10], [14, -11], [14, 0], [14, 11], [7, 10], [0, 10], [-7, 10], [-7, 0], [7, 0]]) {
      this.addNavNode(x, 0, z);
    }
  }

  buildFloodChannel() {
    this.addBox({ position: [0, -0.6, 0], size: [40, 1.2, 32], material: 'concrete', name: 'floor' });
    this.addBox({ position: [0, 3.4, -16], size: [40, 6.8, 1.2], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [0, 3.4, 16], size: [40, 6.8, 1.2], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [-20, 3.4, 0], size: [1.2, 6.8, 32], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [20, 3.4, 0], size: [1.2, 6.8, 32], material: 'concreteDark', name: 'wall' });

    const water = this.addBox({
      position: [0, 0.045, 0],
      size: [39, 0.06, 6.2],
      material: 'water',
      collide: false,
      raycast: false,
      castShadow: false,
      receiveShadow: false,
      name: 'water',
    });
    this.animationNodes.push({ type: 'water', mesh: water, baseY: water.position.y });
    for (let x = -19; x <= 19; x += 2) {
      this.addBox({ position: [x, 0.075, -3.1], size: [0.05, 0.03, 0.3], material: 'steel', collide: false, castShadow: false, name: 'drain-edge' });
      this.addBox({ position: [x, 0.075, 3.1], size: [0.05, 0.03, 0.3], material: 'steel', collide: false, castShadow: false, name: 'drain-edge' });
    }

    this.addBox({ position: [-9.8, 0.45, 0], size: [5.4, 0.9, 7.8], material: 'metal', name: 'bridge' });
    this.addBox({ position: [9.8, 0.45, 0], size: [5.4, 0.9, 7.8], material: 'metal', name: 'bridge' });
    for (const x of [-12.2, -10.6, -9, -7.4, 7.4, 9, 10.6, 12.2]) {
      this.addBox({ position: [x, 0.92, -3.65], size: [0.11, 0.9, 0.12], material: 'signal', collide: false, name: 'bridge-rail' });
      this.addBox({ position: [x, 0.92, 3.65], size: [0.11, 0.9, 0.12], material: 'signal', collide: false, name: 'bridge-rail' });
    }

    this.addBox({ position: [0, 1.4, -8.7], size: [6.2, 2.8, 3.4], material: 'concreteDark', name: 'pump-house' });
    this.addBox({ position: [0, 1.9, 8.7], size: [5, 3.8, 3], material: 'concreteDark', name: 'pump-house' });
    this.addBox({ position: [-15.1, 1.15, -8.2], size: [3.4, 2.3, 3.2], material: 'blue', name: 'cover' });
    this.addBox({ position: [15.1, 1.15, 8.2], size: [3.4, 2.3, 3.2], material: 'blue', name: 'cover' });
    this.addBox({ position: [-15, 1.05, 8.8], size: [3.7, 2.1, 2.6], material: 'concreteLight', name: 'cover' });
    this.addBox({ position: [15, 1.05, -8.8], size: [3.7, 2.1, 2.6], material: 'concreteLight', name: 'cover' });
    this.addCrates([-4.7, 0, -12.8], 2, 'blue');
    this.addCrates([3.5, 0, 11.6], 1, 'metal');

    for (const x of [-13, 0, 13]) {
      this.addPipe([x, 4.8, -15.35], 7.8, 'y', 'metal', 1.15);
      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.78, 0.78, 0.04, 16),
        this.materials.charcoal,
      );
      inner.position.set(x, 4.8, -15.94);
      inner.rotation.x = Math.PI / 2;
      this.root.add(inner);
    }

    this.addPipe([-19.2, 4.6, 0], 28, 'z', 'steel', 0.38);
    this.addPipe([19.2, 3.7, 0], 25, 'z', 'metal', 0.48);
    for (const x of [-12, -4, 4, 12]) {
      this.addBox({ position: [x, 0.04, -13], size: [5.5, 0.05, 0.18], material: 'stripes', collide: false, name: 'floor-stripe' });
      this.addBox({ position: [x, 0.04, 13], size: [5.5, 0.05, 0.18], material: 'stripes', collide: false, name: 'floor-stripe' });
    }

    this.addLamp([-10, 5.8, -15.32], true, 3.1, 12);
    this.addLamp([10, 5.8, -15.32], true, 3.1, 12);
    this.addLamp([-10, 5.8, 15.32], true, 3.1, 12);
    this.addLamp([10, 5.8, 15.32], true, 3.1, 12);
    this.addSign([-0.01, 3.4, -6.97], 0, 'POOL DECK', '#91d8e7', 3.7);
    this.addSign([19.35, 3.4, -3], -Math.PI / 2, 'NO DIVING', '#e4a32d', 3.4);

    this.addWeaponSlot(-10, 0.92, 0, 'machine');
    this.addWeaponSlot(10, 0.92, 0, 'scatter');
    this.addWeaponSlot(0, 0, -4.8, 'rail');
    this.addWeaponSlot(0, 0, 4.8, 'rocket');
    this.addWeaponSlot(-16.5, 0, 0, 'carbine');
    this.addWeaponSlot(16.5, 0, 0, 'revolver');

    for (const [x, z] of [[-15, -9], [-15, 0], [-15, 9], [-10, -5], [-10, 5], [-4, -5], [-4, 5], [4, -5], [4, 5], [10, -5], [10, 5], [15, -9], [15, 0], [15, 9], [0, -13], [0, 13]]) {
      this.addNavNode(x, 0, z);
    }
  }

  buildGlasshouse() {
    this.addBox({ position: [0, -0.55, 0], size: [36, 1.1, 36], material: 'concreteLight', name: 'floor' });
    this.addBox({ position: [0, 2.4, -18], size: [36, 4.8, 0.8], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [0, 2.4, 18], size: [36, 4.8, 0.8], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [-18, 2.4, 0], size: [0.8, 4.8, 36], material: 'concreteDark', name: 'wall' });
    this.addBox({ position: [18, 2.4, 0], size: [0.8, 4.8, 36], material: 'concreteDark', name: 'wall' });

    for (let x = -15; x <= 15; x += 5) {
      this.addBox({ position: [x, 0.025, 0], size: [0.05, 0.04, 35], material: 'metal', collide: false, castShadow: false, name: 'tile-line' });
    }
    for (let z = -15; z <= 15; z += 5) {
      this.addBox({ position: [0, 0.028, z], size: [35, 0.04, 0.05], material: 'metal', collide: false, castShadow: false, name: 'tile-line' });
    }

    const planterPositions = [
      [-8.5, -5.5, 4.5, 2.8],
      [7.8, 6.2, 5.2, 2.7],
      [-7.8, 8.5, 3.2, 5],
      [8.6, -8.2, 3.2, 5],
    ];
    for (const [x, z, width, depth] of planterPositions) {
      this.addBox({ position: [x, 0.65, z], size: [width, 1.3, depth], material: 'concreteDark', name: 'planter' });
      this.addBox({ position: [x, 1.33, z], size: [width - 0.35, 0.08, depth - 0.35], material: 'soil', collide: false, name: 'soil' });
      const plantCount = Math.max(2, Math.floor((width + depth) / 2.5));
      for (let index = 0; index < plantCount; index += 1) {
        const px = x + (this.random() - 0.5) * (width - 0.9);
        const pz = z + (this.random() - 0.5) * (depth - 0.9);
        const height = 0.6 + this.random() * 1.2;
        this.addBox({ position: [px, 1.28 + height / 2, pz], size: [0.16, height, 0.16], material: 'rustDark', collide: false, name: 'stem' });
        this.addBox({ position: [px, 1.75 + height * 0.72, pz], size: [0.75, 0.55, 0.75], material: index % 2 ? 'leafLight' : 'leaf', collide: false, name: 'foliage' });
        if (this.random() > 0.45) {
          this.addBox({ position: [px + 0.38, 1.55 + height * 0.5, pz], size: [0.62, 0.4, 0.52], material: 'leaf', collide: false, name: 'foliage' });
        }
      }
    }

    this.addBox({ position: [0, 1.55, 0], size: [5.4, 3.1, 5.4], material: 'concreteDark', name: 'lab-core' });
    this.addBox({ position: [0, 3.18, 0], size: [5.9, 0.16, 5.9], material: 'signal', name: 'lab-cap' });
    for (const [x, z] of [[-2.73, -2.73], [2.73, -2.73], [-2.73, 2.73], [2.73, 2.73]]) {
      this.addBox({ position: [x, 1.8, z], size: [0.16, 3.5, 0.16], material: 'steel', collide: false, name: 'core-frame' });
    }
    this.addSign([0, 1.9, -2.73], 0, 'TOMATO PATCH', '#e6a32d', 3.3);

    this.addBox({ position: [-13.5, 1.45, 1], size: [3.4, 2.9, 3.8], material: 'teal', name: 'cover' });
    this.addBox({ position: [13.3, 1.45, -1], size: [3.4, 2.9, 3.8], material: 'teal', name: 'cover' });
    this.addCrates([-14.3, 0, -12.7], 2, 'concreteDark');
    this.addCrates([12.5, 0, 12.5], 0, 'rust');

    for (const x of [-15, -9, -3, 3, 9, 15]) {
      this.addBox({ position: [x, 5.4, 0], size: [0.18, 0.18, 35], material: 'steel', collide: false, name: 'roof-frame' });
    }
    for (const z of [-15, -9, -3, 3, 9, 15]) {
      this.addBox({ position: [0, 5.4, z], size: [35, 0.18, 0.18], material: 'steel', collide: false, name: 'roof-frame' });
    }
    for (let x = -12; x <= 12; x += 6) {
      for (let z = -12; z <= 12; z += 6) {
        if ((x + z) % 12 === 0 && this.random() > 0.35) {
          this.addBox({
            position: [x, 5.36, z],
            size: [5.7, 0.04, 5.7],
            material: 'glass',
            collide: false,
            raycast: false,
            castShadow: false,
            receiveShadow: false,
            name: 'glass-roof',
          });
        }
      }
    }
    for (const [x, z] of [[-17.3, -11], [-17.3, 11], [17.3, -11], [17.3, 11]]) {
      this.addBox({ position: [x, 3, z], size: [0.32, 6, 0.32], material: 'steel', collide: false, name: 'roof-post' });
    }

    this.addPipe([-17.35, 3.7, 0], 29, 'z', 'teal', 0.31);
    this.addPipe([17.35, 3.7, 0], 29, 'z', 'teal', 0.31);
    this.addLamp([-9, 5.15, -3], false, 2.7, 10);
    this.addLamp([9, 5.15, 3], false, 2.7, 10);
    this.addLamp([-3, 5.15, 9], false, 2.4, 9);
    this.addLamp([3, 5.15, -9], false, 2.4, 9);
    this.addSign([-17.55, 2.8, 0], Math.PI / 2, 'GARDEN GATE', '#9bbb68', 3.2);

    this.addWeaponSlot(-6.1, 0, -0.3, 'scatter');
    this.addWeaponSlot(6.1, 0, 0.3, 'machine');
    this.addWeaponSlot(0, 0, -9.2, 'rail');
    this.addWeaponSlot(0, 0, 9.2, 'rocket');
    this.addWeaponSlot(-13.2, 0, 6.5, 'carbine');
    this.addWeaponSlot(13.2, 0, -6.5, 'revolver');

    for (const [x, z] of [[-13, -13], [-13, 0], [-13, 13], [-7, -11], [-7, 0], [-7, 11], [0, -13], [0, -7], [0, 7], [0, 13], [7, -11], [7, 0], [7, 11], [13, -13], [13, 0], [13, 13]]) {
      this.addNavNode(x, 0, z);
    }
  }

  addPhotoProp(position, cell, width, height, name) {
    const map = atlasCell(propAtlas, cell, 4, 1);
    const material = new THREE.SpriteMaterial({
      map,
      transparent: true,
      alphaTest: 0.055,
      depthWrite: true,
      depthTest: true,
      fog: true,
      toneMapped: true,
    });
    material.userData.temporary = true;
    const sprite = new THREE.Sprite(material);
    sprite.name = `photo-prop-${name}`;
    sprite.position.set(position[0], position[1] + 0.02, position[2]);
    sprite.center.set(0.5, 0.02);
    sprite.scale.set(width, height, 1);
    sprite.castShadow = false;
    sprite.renderOrder = 1;
    this.root.add(sprite);
    return sprite;
  }

  addCookoutProps() {
    const sets = [
      [
        [[-5.4, 0, -12.8], 0, 2.05, 2.75, 'kettle-grill'],
        [[10.2, 0, 11.8], 1, 3.0, 4.0, 'picnic-table'],
        [[-15.8, 0, 0.4], 2, 1.55, 2.06, 'cooler'],
        [[2.4, 0, 14.6], 3, 3.5, 4.66, 'patio-umbrella'],
      ],
      [
        [[-15.4, 0, -11.7], 0, 2.05, 2.75, 'kettle-grill'],
        [[0, 0, 12.6], 1, 3.0, 4.0, 'picnic-table'],
        [[15.8, 0, -1.2], 2, 1.55, 2.06, 'cooler'],
        [[-1.5, 0, -13.8], 3, 3.5, 4.66, 'patio-umbrella'],
      ],
      [
        [[-12.8, 0, 13.4], 0, 2.05, 2.75, 'kettle-grill'],
        [[11.8, 0, -12.4], 1, 3.0, 4.0, 'picnic-table'],
        [[-2.8, 0, 11.4], 2, 1.55, 2.06, 'cooler'],
        [[13.8, 0, 4.8], 3, 3.5, 4.66, 'patio-umbrella'],
      ],
    ];
    for (const prop of sets[this.mapIndex]) this.addPhotoProp(...prop);
  }

  addAtmosphere() {
    const count = 240;
    const positions = new Float32Array(count * 3);
    const random = seededRandom(this.seed * 91 + this.mapIndex * 17);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 42;
      positions[index * 3 + 1] = random() * 8;
      positions[index * 3 + 2] = (random() - 0.5) * 38;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: this.map.id === 'flood' ? 0x9fd4df : 0xe5cf9a,
      size: this.map.id === 'flood' ? 0.045 : 0.035,
      transparent: true,
      opacity: this.map.id === 'flood' ? 0.23 : 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    material.userData.temporary = true;
    const points = new THREE.Points(geometry, material);
    points.name = 'atmosphere';
    this.root.add(points);
    this.animationNodes.push({
      type: 'dust',
      mesh: points,
      speed: this.map.id === 'flood' ? 1.8 : 0.35,
      accumulator: 0,
    });
  }

  addBoundaryKillPlane() {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({
        color: 0x080908,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    plane.material.userData.temporary = true;
    plane.position.y = -10;
    plane.rotation.x = -Math.PI / 2;
    plane.name = 'kill-plane';
    this.root.add(plane);
  }

  update(time, delta) {
    for (const entry of this.dynamicLights) {
      const flutter =
        Math.sin(time * entry.speed + entry.phase) * 0.05 +
        Math.sin(time * entry.speed * 3.17 + entry.phase * 2) * 0.025;
      entry.light.intensity = entry.base * (1 + flutter);
    }
    for (const node of this.animationNodes) {
      if (node.type === 'dust') {
        node.mesh.rotation.y += delta * 0.006;
        node.accumulator += delta;
        if (node.accumulator < 0.1) continue;
        const dustDelta = node.accumulator;
        node.accumulator = 0;
        const positions = node.mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index += 1) {
          let y = positions.getY(index) - dustDelta * node.speed;
          if (y < 0.08) y = 7.8;
          positions.setY(index, y);
        }
        positions.needsUpdate = true;
      } else if (node.type === 'water') {
        node.mesh.position.y = node.baseY + Math.sin(time * 1.7) * 0.015;
        node.mesh.material.opacity = 0.62 + Math.sin(time * 1.15) * 0.05;
      }
    }
  }

  raycast(origin, direction, maxDistance = 100, extraObjects = []) {
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = maxDistance;
    const intersections = this.raycaster.intersectObjects(
      extraObjects.length ? [...this.raycastMeshes, ...extraObjects] : this.raycastMeshes,
      false,
    );
    if (!intersections.length) return null;
    const hit = intersections[0];
    const normal = hit.face?.normal
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : new THREE.Vector3(0, 1, 0);
    return {
      ...hit,
      normal,
    };
  }

  hasLineOfSight(origin, target, padding = 0.08) {
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    if (distance <= padding) return true;
    direction.normalize();
    const hit = this.raycast(origin, direction, distance - padding);
    return !hit;
  }

  getOverlaps(position, radius, height, target = []) {
    target.length = 0;
    for (const collider of this.colliders) {
      if (intersectsBody(position, radius, height, collider)) target.push(collider);
    }
    return target;
  }

  moveBody(body, delta, options = {}) {
    const radius = options.radius ?? 0.42;
    const height = options.height ?? 1.8;
    const stepHeight = options.stepHeight ?? 0.46;
    const wasGrounded = body.grounded;
    let hitWall = null;
    let stepped = false;
    body.grounded = false;

    const moveHorizontal = (axis) => {
      const amount = body.velocity[axis] * delta;
      if (Math.abs(amount) < 0.000001) return;
      const old = body.position[axis];
      body.position[axis] += amount;
      let overlaps = this.getOverlaps(
        body.position,
        radius,
        height,
        this.overlapScratchA,
      );
      if (overlaps.length && wasGrounded) {
        const oldY = body.position.y;
        body.position.y += stepHeight;
        const steppedOverlaps = this.getOverlaps(
          body.position,
          radius,
          height,
          this.overlapScratchB,
        );
        if (!steppedOverlaps.length) {
          stepped = true;
          return;
        }
        body.position.y = oldY;
      }
      if (!overlaps.length) return;
      body.position[axis] = old;
      overlaps = this.getOverlaps(
        body.position,
        radius + 0.035,
        height,
        this.overlapScratchA,
      );
      const sign = Math.sign(amount);
      hitWall = new THREE.Vector3(
        axis === 'x' ? -sign : 0,
        0,
        axis === 'z' ? -sign : 0,
      );
      body.velocity[axis] = 0;
    };

    moveHorizontal('x');
    moveHorizontal('z');

    const verticalAmount = body.velocity.y * delta;
    const oldY = body.position.y;
    body.position.y += verticalAmount;
    const overlaps = this.getOverlaps(
      body.position,
      radius,
      height,
      this.overlapScratchA,
    );
    if (overlaps.length) {
      if (verticalAmount <= 0) {
        let highest = -Infinity;
        for (const collider of overlaps) {
          if (
            oldY >= collider.max.y - 0.55 &&
            collider.max.y > highest
          ) {
            highest = collider.max.y;
          }
        }
        if (highest > -Infinity) {
          body.position.y = highest;
          body.velocity.y = 0;
          body.grounded = true;
        } else {
          body.position.y = oldY;
          body.velocity.y = 0;
        }
      } else {
        let lowest = Infinity;
        for (const collider of overlaps) {
          if (collider.min.y < lowest) lowest = collider.min.y;
        }
        body.position.y = Math.min(oldY, lowest - height - 0.001);
        body.velocity.y = Math.min(0, body.velocity.y);
      }
    }

    if (!body.grounded && body.velocity.y <= 0) {
      const probe = this.bodyProbe.copy(body.position);
      probe.y -= 0.055;
      const support = this.getOverlaps(
        probe,
        radius * 0.92,
        height,
        this.overlapScratchA,
      );
      if (support.length) {
        body.grounded = true;
        body.velocity.y = 0;
      }
    }

    if (stepped && body.velocity.y <= 0) {
      body.velocity.y = -2.8;
    }
    return { hitWall, stepped };
  }

  getWallContact(position, radius = 0.42, height = 1.8) {
    const middleY = position.y + height * 0.53;
    let closest = null;
    let bestDistance = 0.72;
    for (const collider of this.colliders) {
      if (middleY < collider.min.y || middleY > collider.max.y) continue;
      const closestX = clamp(position.x, collider.min.x, collider.max.x);
      const closestZ = clamp(position.z, collider.min.z, collider.max.z);
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distance = Math.hypot(dx, dz);
      if (distance >= bestDistance || distance < 0.0001) continue;
      const normal = new THREE.Vector3(dx / distance, 0, dz / distance);
      if (
        Math.abs(position.x - collider.min.x) < radius + 0.3 ||
        Math.abs(position.x - collider.max.x) < radius + 0.3 ||
        Math.abs(position.z - collider.min.z) < radius + 0.3 ||
        Math.abs(position.z - collider.max.z) < radius + 0.3
      ) {
        closest = { normal, collider, distance };
        bestDistance = distance;
      }
    }
    return closest;
  }

  findNearestNavNode(position) {
    let nearest = null;
    let distance = Infinity;
    for (const node of this.navNodes) {
      const nodeDistance = node.position.distanceToSquared(position);
      if (nodeDistance < distance) {
        nearest = node;
        distance = nodeDistance;
      }
    }
    return nearest;
  }

  getMapCount() {
    return MAPS.length;
  }

  getSpawn(side) {
    const source = side === 'player' ? this.map.playerSpawn : this.map.botSpawn;
    return new THREE.Vector3(...source);
  }

  getSpawnYaw(side) {
    return side === 'player' ? this.map.playerYaw : this.map.botYaw;
  }
}

export { MAPS };
