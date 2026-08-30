import * as THREE from 'three';
import { WAR_MAP, warSpawnForSlot, warSpawnYaw } from '../../shared/warConfig.js';
import { Arena } from './Arena.js';
import { loadPhotoTexture } from './photoTexture.js';

const WAR_COLORS = Object.freeze({
  neutral: 0xc0c0c0,
  team0: 0xd94b43,
  team1: 0x3d69c7,
  contested: 0xffd83d,
});

function boundsSize(bounds) {
  return [
    bounds[3] - bounds[0],
    bounds[4] - bounds[1],
    bounds[5] - bounds[2],
  ];
}

function boundsCenter(bounds) {
  return [
    (bounds[0] + bounds[3]) / 2,
    (bounds[1] + bounds[4]) / 2,
    (bounds[2] + bounds[5]) / 2,
  ];
}

/**
 * Builds vegetation from two identical alpha cutouts at a fixed right angle.
 * The group is deliberately never aimed at the camera: viewed from overhead,
 * its two planes form an X instead of behaving like a sprite/billboard.
 */
export function createFixedCrossedPlane({
  asset,
  width,
  height,
  name = 'war-fixed-crossed-plane',
  material = null,
  geometry = null,
} = {}) {
  const texture = material ? null : loadPhotoTexture(asset);
  const sharedMaterial = material ?? new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.035,
    depthWrite: true,
    depthTest: true,
    fog: true,
    toneMapped: true,
    side: THREE.DoubleSide,
  });
  const sharedGeometry = geometry ?? new THREE.PlaneGeometry(width, height);
  const group = new THREE.Group();
  group.name = name;
  group.userData.fixedCrossedPlane = true;
  group.userData.asset = asset;

  for (const [index, yaw] of [0, Math.PI / 2].entries()) {
    const plane = new THREE.Mesh(sharedGeometry, sharedMaterial);
    plane.name = `${name}-plane-${index}`;
    plane.position.y = height / 2;
    plane.rotation.y = yaw;
    plane.castShadow = true;
    plane.receiveShadow = false;
    plane.userData.fixedYaw = yaw;
    group.add(plane);
  }
  return group;
}

export class WarArena extends Arena {
  constructor(scene, renderer) {
    super(scene, renderer);
    this.root.name = 'war-arena';
  }

  activateEnvironment() {
    this.scene.background = new THREE.Color(0x9eb8c5);
    this.scene.fog = new THREE.FogExp2(0xc4cfbf, 0.0048);
  }

  load(_index = 0, seed = 1) {
    this.disposeSunShadow();
    this.clear();
    this.mapIndex = 0;
    this.map = WAR_MAP;
    this.seed = seed;
    this.colliders = WAR_MAP.colliders.map((bounds, colliderIndex) => {
      const collider = new THREE.Box3(
        new THREE.Vector3(bounds[0], bounds[1], bounds[2]),
        new THREE.Vector3(bounds[3], bounds[4], bounds[5]),
      );
      collider.userData = { name: `war-collider-${colliderIndex}` };
      return collider;
    });

    this.activateEnvironment();
    this.root.add(new THREE.HemisphereLight(0xd8e6e9, 0x536142, 2.15));
    this.root.add(new THREE.AmbientLight(0xd8dfcd, 1.05));
    const sun = new THREE.DirectionalLight(0xffd8a1, 2.05);
    sun.position.set(-34, 42, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -62;
    sun.shadow.camera.right = 62;
    sun.shadow.camera.top = 62;
    sun.shadow.camera.bottom = -62;
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    this.root.add(sun);
    this.sun = sun;

    this.buildWarField();
    this.addBoundaryKillPlane();
    this.root.updateMatrixWorld(true);
    return this.map;
  }

  buildWarField() {
    this.addBox({
      position: [0, -0.55, 0],
      size: [240, 1.1, 200],
      material: 'grass',
      name: 'war-grass-field',
    });
    this.addBox({
      position: [0, 0.012, 0],
      size: [18, 0.024, 194],
      material: 'dirt',
      raycast: false,
      castShadow: false,
      name: 'war-center-path',
    });
    this.addBox({
      position: [0, 0.016, 0],
      size: [74, 0.032, 18],
      material: 'cobblestone',
      raycast: false,
      castShadow: false,
      name: 'war-objective-path',
    });

    for (const [index, bounds] of WAR_MAP.colliders.entries()) {
      if (index === 0) continue;
      const boundary = index <= 4;
      this.addBox({
        position: boundsCenter(bounds),
        size: boundsSize(bounds),
        material: boundary ? 'hedge' : index % 3 === 0 ? 'paleTimber' : 'timber',
        name: boundary ? `war-boundary-${index}` : `war-cover-${index - 5}`,
      });
    }

    this.buildControlPoint();
    this.buildFoliage();
  }

  buildControlPoint() {
    const radius = WAR_MAP.objective.radius;
    const ringGeometry = new THREE.RingGeometry(radius - 0.45, radius, 64);
    ringGeometry.userData.temporary = true;
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: WAR_COLORS.neutral,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    ringMaterial.userData.temporary = true;
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.name = 'war-central-control-point';
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(...WAR_MAP.objective.position);
    ring.position.y += 0.035;
    this.root.add(ring);
    this.objectiveMarker = ring;

    const centerGeometry = new THREE.CircleGeometry(radius - 0.55, 64);
    centerGeometry.userData.temporary = true;
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: WAR_COLORS.neutral,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    centerMaterial.userData.temporary = true;
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.name = 'war-control-point-floor';
    center.rotation.x = -Math.PI / 2;
    center.position.copy(ring.position);
    center.position.y -= 0.002;
    this.root.add(center);
    this.objectiveFill = center;
  }

  buildFoliage() {
    this.foliageCutouts = [];
    this.foliageMaterials ??= new Map();
    this.foliageGeometries ??= new Map();
    for (const item of WAR_MAP.foliage) {
      if (!this.foliageMaterials.has(item.type)) {
        this.foliageMaterials.set(item.type, new THREE.MeshBasicMaterial({
          map: loadPhotoTexture(item.asset),
          transparent: true,
          alphaTest: 0.035,
          depthWrite: true,
          depthTest: true,
          fog: true,
          toneMapped: true,
          side: THREE.DoubleSide,
        }));
      }
      const geometryKey = `${item.width}:${item.height}`;
      if (!this.foliageGeometries.has(geometryKey)) {
        this.foliageGeometries.set(
          geometryKey,
          new THREE.PlaneGeometry(item.width, item.height),
        );
      }
      const cutout = createFixedCrossedPlane({
        asset: item.asset,
        width: item.width,
        height: item.height,
        name: `war-${item.id}`,
        material: this.foliageMaterials.get(item.type),
        geometry: this.foliageGeometries.get(geometryKey),
      });
      cutout.position.set(...item.position);
      this.root.add(cutout);
      this.foliageCutouts.push(cutout);
    }
  }

  setControlState(state = {}) {
    if (!this.objectiveMarker || !this.objectiveFill) return;
    const color = state.contested
      ? WAR_COLORS.contested
      : state.owner === 0
        ? WAR_COLORS.team0
        : state.owner === 1
          ? WAR_COLORS.team1
          : WAR_COLORS.neutral;
    this.objectiveMarker.material.color.setHex(color);
    this.objectiveFill.material.color.setHex(color);
    this.objectiveFill.material.opacity = state.contested ? 0.22 : 0.13;
  }

  getMapCount() {
    return 1;
  }

  getSpawn(team = 0, slot = 0) {
    if (team === 'player') return new THREE.Vector3(...warSpawnForSlot(0, slot));
    if (team === 'bot') return new THREE.Vector3(...warSpawnForSlot(1, slot));
    return new THREE.Vector3(...warSpawnForSlot(Number(team) === 1 ? 1 : 0, slot));
  }

  getSpawnYaw(team = 0) {
    if (team === 'bot') return warSpawnYaw(1);
    return warSpawnYaw(Number(team) === 1 ? 1 : 0);
  }

  dispose() {
    for (const material of this.foliageMaterials?.values() ?? []) material.dispose();
    for (const geometry of this.foliageGeometries?.values() ?? []) geometry.dispose();
    this.foliageMaterials?.clear();
    this.foliageGeometries?.clear();
    super.dispose();
  }
}
