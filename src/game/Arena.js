import * as THREE from 'three';
import { MAPS as NETWORK_MAPS } from '../../server/multiplayer/config.js';
import { clamp, seededRandom } from './math.js';
import { loadPhotoTexture } from './photoTexture.js';

const MAPS = NETWORK_MAPS.map((map) => ({
  ...map,
  name: 'BATTLE VILLAGE',
  code: 'RED KEEP // BLUE KEEP',
  description: 'THREE LANES. ONE LAST SPELL.',
  background: 0x92b7c8,
  fog: 0xc7d3bf,
  fogDensity: 0.009,
  sunColor: 0xffd59a,
  sunIntensity: 2.2,
  hemiSky: 0xd6e7ed,
  hemiGround: 0x596845,
  playerSpawn: map.spawns[0],
  botSpawn: map.spawns[1],
  playerYaw: map.yaws[0],
  botYaw: map.yaws[1],
}));

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

function boxFromBounds(bounds) {
  return new THREE.Box3(
    new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
    new THREE.Vector3(bounds[3], bounds[4], bounds[5]),
  );
}

export class Arena {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.root.name = 'battle-village-arena';
    this.scene.add(this.root);
    this.colliders = [];
    this.raycastMeshes = [];
    this.weaponSlots = [];
    this.navNodes = [];
    this.animationNodes = [];
    this.dynamicLights = [];
    this.mapIndex = 0;
    this.map = MAPS[0];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.sharedGeometry = new Map();
    this.materials = this.createMaterials();
    this.overlapScratchA = [];
    this.overlapScratchB = [];
    this.bodyProbe = new THREE.Vector3();
    this.load(0, 1);
  }

  createMaterials() {
    const photo = (file, color = 0xffffff, extra = {}) => {
      const material = new THREE.MeshBasicMaterial({
        map: loadPhotoTexture(`/assets/larp/materials/${file}.webp`, {
          repeatX: 2,
          repeatY: 2,
          anisotropy: 4,
        }),
        color,
        fog: true,
        toneMapped: true,
        ...extra,
      });
      material.name = `photo-${file}`;
      return material;
    };
    return {
      grass: photo('grass'),
      cobblestone: photo('cobblestone'),
      dirt: photo('dirt'),
      timber: photo('timber'),
      red: photo('red-plaster'),
      blue: photo('blue-plaster'),
      roof: photo('roof-shingles'),
      hedge: photo('hedge'),
      paleTimber: photo('timber', 0xd8c8aa),
      darkTimber: photo('timber', 0x6d5137),
      hay: photo('grass', 0xd7aa55),
      canvas: photo('dirt', 0xe0cda7),
      glass: photo('blue-plaster', 0xb9e2ed, {
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };
  }

  geometry(size) {
    const key = size.join(':');
    if (!this.sharedGeometry.has(key)) {
      this.sharedGeometry.set(key, new THREE.BoxGeometry(...size));
    }
    return this.sharedGeometry.get(key);
  }

  clear() {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((node) => {
        if (node.material?.userData?.temporary) node.material.dispose();
        if (node.geometry?.userData?.temporary) node.geometry.dispose();
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
    this.random = seededRandom(seed * 977 + 313);
    this.colliders = this.map.colliders.map((bounds, colliderIndex) => {
      const collider = boxFromBounds(bounds);
      collider.userData = { name: `shared-collider-${colliderIndex}` };
      return collider;
    });

    this.scene.background = new THREE.Color(this.map.background);
    this.scene.fog = new THREE.FogExp2(this.map.fog, this.map.fogDensity);
    const hemisphere = new THREE.HemisphereLight(this.map.hemiSky, this.map.hemiGround, 2.35);
    this.root.add(hemisphere);
    const ambient = new THREE.AmbientLight(0xd5dfca, 1.15);
    this.root.add(ambient);
    const sun = new THREE.DirectionalLight(this.map.sunColor, this.map.sunIntensity);
    sun.position.set(-13, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -27;
    sun.shadow.camera.right = 27;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    this.root.add(sun);
    this.sun = sun;

    this.buildBattleVillage();
    this.addAtmosphere();
    this.addBoundaryKillPlane();
    this.root.updateMatrixWorld(true);
    return this.map;
  }

  addBox({
    position,
    size,
    material = 'timber',
    rotation = null,
    raycast = true,
    castShadow = true,
    receiveShadow = true,
    name = 'village-architecture',
  }) {
    const mesh = new THREE.Mesh(this.geometry(size), this.materials[material]);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.name = name;
    this.root.add(mesh);
    if (raycast) this.raycastMeshes.push(mesh);
    return mesh;
  }

  addBoundsVisual(bounds, material, name) {
    const size = [
      bounds[3] - bounds[0],
      bounds[4] - bounds[1],
      bounds[5] - bounds[2],
    ];
    const position = [
      (bounds[0] + bounds[3]) / 2,
      (bounds[1] + bounds[4]) / 2,
      (bounds[2] + bounds[5]) / 2,
    ];
    return this.addBox({ position, size, material, name });
  }

  addPropSprite(file, position, width, height, name, options = {}) {
    const material = new THREE.SpriteMaterial({
      map: loadPhotoTexture(`/assets/larp/props/${file}.webp`),
      transparent: true,
      alphaTest: 0.035,
      depthWrite: true,
      depthTest: true,
      fog: true,
      toneMapped: true,
    });
    material.userData.temporary = true;
    const sprite = new THREE.Sprite(material);
    sprite.name = `individual-photo-prop-${name}`;
    sprite.position.set(position[0], position[1] + 0.02, position[2]);
    sprite.center.set(0.5, options.centerY ?? 0.02);
    sprite.scale.set(width, height, 1);
    this.root.add(sprite);
    return sprite;
  }

  addHouse(team, zCenter) {
    const material = team === 'red' ? 'red' : 'blue';
    const zMin = zCenter - 3.75;
    const zMax = zCenter + 3.75;
    this.addBoundsVisual([-6.25, 0, zMin, -5.75, 5.5, zMax], material, `${team}-house-west-wall`);
    this.addBoundsVisual([5.75, 0, zMin, 6.25, 5.5, zMax], material, `${team}-house-east-wall`);
    this.addBoundsVisual([-6, 0, zMin - 0.25, -1.2, 5.5, zMin + 0.25], material, `${team}-house-back-left`);
    this.addBoundsVisual([1.2, 0, zMin - 0.25, 6, 5.5, zMin + 0.25], material, `${team}-house-back-right`);
    this.addBoundsVisual([-6, 0, zMax - 0.25, -1.2, 5.5, zMax + 0.25], material, `${team}-house-front-left`);
    this.addBoundsVisual([1.2, 0, zMax - 0.25, 6, 5.5, zMax + 0.25], material, `${team}-house-front-right`);
    this.addBoundsVisual([-5.75, 2.75, zMin + 0.25, -1.5, 3.05, zMax - 0.25], 'timber', `${team}-house-upper-floor-west`);
    this.addBoundsVisual([1.5, 2.75, zMin + 0.25, 5.75, 3.05, zMax - 0.25], 'timber', `${team}-house-upper-floor-east`);

    const fill = new THREE.PointLight(team === 'red' ? 0xffb56d : 0x9dd8ff, 2.8, 12, 2);
    fill.position.set(0, 2.1, zCenter);
    this.root.add(fill);

    const front = zCenter < 0 ? zMax : zMin;
    const back = zCenter < 0 ? zMin : zMax;
    for (const facadeZ of [front, back]) {
      for (const x of [-4.1, 4.1]) {
        this.addBox({
          position: [x, 4.15, facadeZ + (facadeZ === front ? (zCenter < 0 ? 0.27 : -0.27) : 0)],
          size: [1.4, 1.25, 0.08],
          material: 'glass',
          raycast: false,
          castShadow: false,
          name: `${team}-upper-window`,
        });
      }
    }

    for (const x of [-5.55, -1.2, 1.2, 5.55]) {
      this.addBox({
        position: [x, 2.75, front + (zCenter < 0 ? 0.29 : -0.29)],
        size: [0.16, 5.3, 0.12],
        material: 'darkTimber',
        raycast: false,
        name: `${team}-facade-beam`,
      });
    }
    this.addBox({
      position: [0, 5.56, zCenter],
      size: [6.7, 0.24, 8.15],
      material: 'roof',
      rotation: [0, 0, 0.31],
      raycast: false,
      name: `${team}-roof-west-slope`,
    });
    this.addBox({
      position: [0, 5.56, zCenter],
      size: [6.7, 0.24, 8.15],
      material: 'roof',
      rotation: [0, 0, -0.31],
      raycast: false,
      name: `${team}-roof-east-slope`,
    });
  }

  buildBattleVillage() {
    this.addBox({
      position: [0, -0.55, 0], size: [44, 1.1, 36], material: 'grass',
      name: 'photographic-grass-field',
    });
    this.addBox({
      position: [0, 0.018, 0], size: [7.4, 0.035, 35.7], material: 'cobblestone',
      raycast: false, castShadow: false, name: 'central-cobblestone-lane',
    });
    for (const x of [-18.4, 18.4]) {
      this.addBox({
        position: [x, 0.022, 0], size: [5.2, 0.04, 31], material: 'dirt',
        raycast: false, castShadow: false, name: 'flank-dirt-path',
      });
    }

    this.addBoundsVisual([-22, 0, -18.5, 22, 6, -17.5], 'paleTimber', 'north-boundary-fence');
    this.addBoundsVisual([-22, 0, 17.5, 22, 6, 18.5], 'paleTimber', 'south-boundary-fence');
    this.addBoundsVisual([-22.5, 0, -18, -21.5, 6, 18], 'hedge', 'west-boundary-hedge');
    this.addBoundsVisual([21.5, 0, -18, 22.5, 6, 18], 'hedge', 'east-boundary-hedge');

    this.addHouse('red', -11.25);
    this.addHouse('blue', 11.25);

    this.addBoundsVisual([-2, 0, -1.2, 2, 1.9, 1.2], 'timber', 'central-cart-cover');
    this.addPropSprite('wooden-cart', [0, 0, 0], 4.7, 3.0, 'central-wooden-cart');

    this.addBoundsVisual([-7.1, 0, -3.7, -4.1, 1.45, -1.5], 'hay', 'west-hay-cover');
    this.addPropSprite('hay-bales', [-5.6, 0, -2.6], 3.65, 2.45, 'west-hay-bales');
    this.addBoundsVisual([4.1, 0, 1.5, 7.1, 1.45, 3.7], 'hay', 'east-hay-cover');
    this.addPropSprite('hay-bales', [5.6, 0, 2.6], 3.65, 2.45, 'east-hay-bales');

    this.addBoundsVisual([-16.2, 0, -2.9, -11.6, 1.8, -1.7], 'hedge', 'west-lane-hedge');
    this.addBoundsVisual([11.6, 0, 1.7, 16.2, 1.8, 2.9], 'hedge', 'east-lane-hedge');

    this.addBoundsVisual([-18.3, 0, -11.1, -15.1, 2.35, -7.5], 'canvas', 'red-flank-tent-cover');
    this.addPropSprite('canvas-tent', [-16.7, 0, -9.3], 4.8, 3.2, 'red-flank-tent');
    this.addBoundsVisual([15.1, 0, 7.5, 18.3, 2.35, 11.1], 'canvas', 'blue-flank-tent-cover');
    this.addPropSprite('canvas-tent', [16.7, 0, 9.3], 4.8, 3.2, 'blue-flank-tent');

    this.addBoundsVisual([-15.7, 0, 7.1, -14.1, 2.15, 8.1], 'timber', 'west-archery-cover');
    this.addPropSprite('archery-target', [-14.9, 0, 7.6], 2.4, 2.85, 'west-archery-target');
    this.addBoundsVisual([14.1, 0, -8.1, 15.7, 2.15, -7.1], 'timber', 'east-archery-cover');
    this.addPropSprite('archery-target', [14.9, 0, -7.6], 2.4, 2.85, 'east-archery-target');

    for (const slot of this.map.pickups) this.addWeaponSlot(...slot);
    const nodes = [
      [0, 16], [-8, 15], [8, 15], [-15, 13], [15, 13],
      [0, 9.5], [-9, 8], [9, 8], [-17, 5], [17, 5],
      [0, 5], [-9, 3.5], [9, 3.5], [-18, 0], [18, 0],
      [0, -5], [-9, -3.5], [9, -3.5], [-17, -5], [17, -5],
      [0, -9.5], [-9, -8], [9, -8], [-15, -13], [15, -13],
      [0, -16], [-8, -15], [8, -15],
    ];
    for (const [x, z] of nodes) this.addNavNode(x, 0, z);
  }

  addWeaponSlot(x, y, z, preferred = null) {
    this.weaponSlots.push({
      position: new THREE.Vector3(x, y, z),
      preferred,
    });
  }

  addNavNode(x, y, z) {
    this.navNodes.push({ position: new THREE.Vector3(x, y, z) });
  }

  addAtmosphere() {
    const count = 180;
    const positions = new Float32Array(count * 3);
    const random = seededRandom(this.seed * 91 + 17);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 43;
      positions[index * 3 + 1] = 0.4 + random() * 7;
      positions[index * 3 + 2] = (random() - 0.5) * 35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.userData.temporary = true;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xf1d6a2,
      size: 0.035,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    material.userData.temporary = true;
    const points = new THREE.Points(geometry, material);
    points.name = 'sunlit-dust-motes';
    this.root.add(points);
    this.animationNodes.push({ type: 'dust', mesh: points, speed: 0.32, accumulator: 0 });
  }

  addBoundaryKillPlane() {
    const geometry = new THREE.PlaneGeometry(120, 120);
    geometry.userData.temporary = true;
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    material.userData.temporary = true;
    const plane = new THREE.Mesh(geometry, material);
    plane.position.y = -10;
    plane.rotation.x = -Math.PI / 2;
    plane.name = 'kill-plane';
    this.root.add(plane);
  }

  update(time, delta) {
    for (const node of this.animationNodes) {
      if (node.type !== 'dust') continue;
      node.mesh.rotation.y += delta * 0.006;
      node.accumulator += delta;
      if (node.accumulator < 0.1) continue;
      const dustDelta = node.accumulator;
      node.accumulator = 0;
      const positions = node.mesh.geometry.attributes.position;
      for (let index = 0; index < positions.count; index += 1) {
        let y = positions.getY(index) - dustDelta * node.speed;
        if (y < 0.08) y = 7.6;
        positions.setY(index, y);
      }
      positions.needsUpdate = true;
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
    return { ...hit, normal };
  }

  hasLineOfSight(origin, target, padding = 0.08) {
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    if (distance <= padding) return true;
    direction.normalize();
    return !this.raycast(origin, direction, distance - padding);
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
      let overlaps = this.getOverlaps(body.position, radius, height, this.overlapScratchA);
      if (overlaps.length && wasGrounded) {
        const oldY = body.position.y;
        body.position.y += stepHeight;
        const steppedOverlaps = this.getOverlaps(body.position, radius, height, this.overlapScratchB);
        if (!steppedOverlaps.length) {
          stepped = true;
          return;
        }
        body.position.y = oldY;
      }
      if (!overlaps.length) return;
      body.position[axis] = old;
      overlaps = this.getOverlaps(body.position, radius + 0.035, height, this.overlapScratchA);
      const sign = Math.sign(amount);
      hitWall = new THREE.Vector3(axis === 'x' ? -sign : 0, 0, axis === 'z' ? -sign : 0);
      body.velocity[axis] = 0;
    };

    moveHorizontal('x');
    moveHorizontal('z');
    const verticalAmount = body.velocity.y * delta;
    const oldY = body.position.y;
    body.position.y += verticalAmount;
    const overlaps = this.getOverlaps(body.position, radius, height, this.overlapScratchA);
    if (overlaps.length) {
      if (verticalAmount <= 0) {
        let highest = -Infinity;
        for (const collider of overlaps) {
          if (oldY >= collider.max.y - 0.55 && collider.max.y > highest) highest = collider.max.y;
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
        for (const collider of overlaps) lowest = Math.min(lowest, collider.min.y);
        body.position.y = Math.min(oldY, lowest - height - 0.001);
        body.velocity.y = Math.min(0, body.velocity.y);
      }
    }
    if (!body.grounded && body.velocity.y <= 0) {
      const probe = this.bodyProbe.copy(body.position);
      probe.y -= 0.055;
      const support = this.getOverlaps(probe, radius * 0.92, height, this.overlapScratchA);
      if (support.length) {
        body.grounded = true;
        body.velocity.y = 0;
      }
    }
    if (stepped && body.velocity.y <= 0) body.velocity.y = -2.8;
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
    return new THREE.Vector3(...(side === 'player' ? this.map.playerSpawn : this.map.botSpawn));
  }

  getSpawnYaw(side) {
    return side === 'player' ? this.map.playerYaw : this.map.botYaw;
  }
}

export { MAPS };
