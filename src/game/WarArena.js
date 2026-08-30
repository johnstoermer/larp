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

export const WAR_CENTER_ROAD_SEGMENTS = Object.freeze([
  Object.freeze({
    id: 'north', position: Object.freeze([-1.75, 0.012, -56]),
    size: Object.freeze([11.5, 0.024, 48]), material: 'dirt', kind: 'main-road',
  }),
  Object.freeze({
    id: 'middle', position: Object.freeze([0, 0.012, 0]),
    size: Object.freeze([12, 0.024, 68]), material: 'dirt', kind: 'main-road',
  }),
  Object.freeze({
    id: 'south', position: Object.freeze([1.75, 0.012, 56]),
    size: Object.freeze([11.5, 0.024, 48]), material: 'dirt', kind: 'main-road',
  }),
]);

export const WAR_SPAWN_TRACK_PATCHES = Object.freeze([
  Object.freeze({ id: 'north-back', position: Object.freeze([-3.8, 0.014, -86]), size: Object.freeze([3.2, 0.028, 5.8]), rotation: Object.freeze([0, 0.2, 0]), material: 'dirt' }),
  Object.freeze({ id: 'north-middle', position: Object.freeze([3.2, 0.014, -82]), size: Object.freeze([3, 0.028, 5]), rotation: Object.freeze([0, -0.18, 0]), material: 'dirt' }),
  Object.freeze({ id: 'north-front', position: Object.freeze([-2, 0.014, -78]), size: Object.freeze([4, 0.028, 4.5]), rotation: Object.freeze([0, 0.12, 0]), material: 'dirt' }),
  Object.freeze({ id: 'north-crossing', position: Object.freeze([0, 0.018, -64]), size: Object.freeze([21, 0.036, 1.6]), rotation: null, material: 'cobblestone' }),
  Object.freeze({ id: 'south-back', position: Object.freeze([3.8, 0.014, 86]), size: Object.freeze([3.2, 0.028, 5.8]), rotation: Object.freeze([0, 0.2, 0]), material: 'dirt' }),
  Object.freeze({ id: 'south-middle', position: Object.freeze([-3.2, 0.014, 82]), size: Object.freeze([3, 0.028, 5]), rotation: Object.freeze([0, -0.18, 0]), material: 'dirt' }),
  Object.freeze({ id: 'south-front', position: Object.freeze([2, 0.014, 78]), size: Object.freeze([4, 0.028, 4.5]), rotation: Object.freeze([0, 0.12, 0]), material: 'dirt' }),
  Object.freeze({ id: 'south-crossing', position: Object.freeze([0, 0.018, 64]), size: Object.freeze([21, 0.036, 1.6]), rotation: null, material: 'cobblestone' }),
]);

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
  visibleBottomRatio = 0,
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
    plane.position.y = height / 2 - visibleBottomRatio * height;
    plane.rotation.y = yaw;
    plane.castShadow = true;
    plane.receiveShadow = false;
    plane.userData.fixedYaw = yaw;
    group.add(plane);
  }
  return group;
}

/** Builds a fixed world-plane prop that never turns to follow the camera. */
export function createFixedPhotoProp({
  asset,
  width,
  height,
  yaw = 0,
  visibleBottomRatio = 0,
  name = 'war-fixed-photo-prop',
  material = null,
  geometry = null,
  alphaTest = 0.035,
} = {}) {
  const sharedMaterial = material ?? new THREE.MeshBasicMaterial({
    map: loadPhotoTexture(asset),
    transparent: true,
    alphaTest,
    depthWrite: true,
    depthTest: true,
    fog: true,
    toneMapped: true,
    side: THREE.DoubleSide,
  });
  const sharedGeometry = geometry ?? new THREE.PlaneGeometry(width, height);
  const plane = new THREE.Mesh(sharedGeometry, sharedMaterial);
  plane.name = name;
  plane.position.y = height / 2 - visibleBottomRatio * height;
  plane.rotation.y = yaw;
  plane.castShadow = true;
  plane.receiveShadow = false;
  plane.userData.fixedPhotoProp = true;
  plane.userData.asset = asset;
  plane.userData.fixedYaw = yaw;
  return plane;
}

export class WarArena extends Arena {
  constructor(scene, renderer) {
    super(scene, renderer);
    this.root.name = 'war-arena';
  }

  clear() {
    for (const collection of [
      this.roadBatches,
      this.surfaceBatches,
      this.structureBatches,
      this.structureTrimMeshes,
    ]) {
      for (const batch of collection ?? []) batch.dispose();
    }
    super.clear();
    this.roadBatches = [];
    this.surfaceBatches = [];
    this.structureBatches = [];
    this.structureTrimMeshes = [];
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

  addInstancedBoxBatches(items, namePrefix) {
    const groups = new Map();
    for (const item of items) {
      const castShadow = item.castShadow !== false;
      const receiveShadow = item.receiveShadow !== false;
      const key = `${item.material}:${castShadow ? 1 : 0}:${receiveShadow ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...item, castShadow, receiveShadow });
    }

    const batches = [];
    const transform = new THREE.Object3D();
    for (const [batchIndex, records] of [...groups.values()].entries()) {
      const first = records[0];
      const batch = new THREE.InstancedMesh(
        this.geometry([1, 1, 1]),
        this.materials[first.material],
        records.length,
      );
      batch.name = `${namePrefix}-${batchIndex}`;
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      batch.userData.staticBoxBatch = true;
      batch.userData.sceneryIds = records.map(({ id }) => id).filter(Boolean);
      for (const [instanceIndex, record] of records.entries()) {
        transform.position.set(...record.position);
        transform.rotation.set(...(record.rotation ?? [0, 0, 0]));
        transform.scale.set(...record.size);
        transform.updateMatrix();
        batch.setMatrixAt(instanceIndex, transform.matrix);
      }
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.root.add(batch);
      batches.push(batch);
    }
    return batches;
  }

  buildWarField() {
    this.addBox({
      position: [0, -0.55, 0],
      size: [240, 1.1, 200],
      material: 'grass',
      name: 'war-grass-field',
    });
    this.roadMeshes = [];
    const roadInstances = [];
    for (const road of [...WAR_CENTER_ROAD_SEGMENTS, ...WAR_SPAWN_TRACK_PATCHES]) {
      const mesh = this.addBox({
        position: road.position,
        size: road.size,
        rotation: road.rotation ?? undefined,
        material: road.material,
        raycast: false,
        castShadow: false,
        name: `war-road-${road.id}`,
      });
      mesh.userData.roadKind = road.kind ?? 'spawn-track';
      mesh.visible = false;
      this.roadMeshes.push(mesh);
      roadInstances.push({ ...road, castShadow: false });
    }
    this.roadBatches = this.addInstancedBoxBatches(roadInstances, 'war-road-batch');
    this.addBox({
      position: [0, 0.016, 0],
      size: [74, 0.032, 18],
      material: 'cobblestone',
      raycast: false,
      castShadow: false,
      name: 'war-objective-path',
    });

    this.surfaceMeshes = [];
    const surfaceInstances = [];
    for (const surface of WAR_MAP.surfaces) {
      const mesh = this.addBox({
        position: surface.position,
        size: surface.size,
        material: surface.material,
        raycast: false,
        castShadow: false,
        name: `war-surface-${surface.id}`,
      });
      mesh.userData.sceneryId = surface.id;
      mesh.visible = false;
      this.surfaceMeshes.push(mesh);
      surfaceInstances.push({ ...surface, castShadow: false });
    }
    this.surfaceBatches = this.addInstancedBoxBatches(
      surfaceInstances,
      'war-surface-batch',
    );

    for (const [index, bounds] of WAR_MAP.boundaryColliders.entries()) {
      if (index === 0) continue;
      this.addBox({
        position: boundsCenter(bounds),
        size: boundsSize(bounds),
        material: 'hedge',
        name: `war-boundary-${index}`,
      });
    }

    this.structureMeshes = [];
    const structureInstances = [];
    this.structureTrimInstances = [];
    for (const cover of WAR_MAP.legacyCover) {
      if (cover.photoReplacementId) continue;
      const mesh = this.addBox({
        position: boundsCenter(cover.bounds),
        size: boundsSize(cover.bounds),
        material: cover.material,
        name: `war-${cover.id}`,
      });
      mesh.userData.sceneryId = cover.id;
      mesh.userData.collisionBounds = cover.bounds;
      mesh.visible = false;
      this.structureMeshes.push(mesh);
      structureInstances.push({
        id: cover.id,
        position: boundsCenter(cover.bounds),
        size: boundsSize(cover.bounds),
        material: cover.material,
      });
    }
    for (const part of WAR_MAP.structureParts) {
      const mesh = this.addBox({
        position: part.position,
        size: part.size,
        material: part.material,
        rotation: part.rotation ?? undefined,
        raycast: part.solid !== false,
        castShadow: true,
        name: `war-structure-${part.id}`,
      });
      mesh.userData.sceneryId = part.id;
      mesh.userData.collisionBounds = part.solid === false ? null : part.bounds;
      mesh.visible = false;
      this.structureMeshes.push(mesh);
      structureInstances.push({
        id: part.id,
        position: part.position,
        size: part.size,
        material: part.material,
        rotation: part.rotation ?? null,
      });
      if (part.role === 'building-wall') this.addBuildingWallTrim(part);
    }
    this.structureBatches = this.addInstancedBoxBatches(
      structureInstances,
      'war-structure-batch',
    );
    this.structureTrimMeshes = this.addInstancedBoxBatches(
      this.structureTrimInstances,
      'war-structure-trim-batch',
    );

    this.buildControlPoint();
    this.buildPhotoProps();
    this.buildFoliage();
  }

  addBuildingWallTrim(part) {
    const [width, height, depth] = part.size;
    if (height < 2.4) return;
    const alongX = width >= depth;
    const trimDepth = alongX ? depth + 0.09 : 0.22;
    const trimWidth = alongX ? 0.22 : width + 0.09;
    const dominantLength = alongX ? width : depth;
    const dominantCenter = alongX ? part.position[0] : part.position[2];
    const edgeInset = Math.min(0.18, dominantLength * 0.1);
    const postOffsets = [
      -dominantLength / 2 + edgeInset,
      dominantLength / 2 - edgeInset,
    ];
    if (dominantLength >= 8) postOffsets.splice(1, 0, 0);

    this.structureTrimInstances.push({
      id: `${part.id}-top`,
      position: [
        part.position[0],
        part.position[1] + height / 2 - 0.24,
        part.position[2],
      ],
      size: alongX
        ? [width + 0.08, 0.24, depth + 0.09]
        : [width + 0.09, 0.24, depth + 0.08],
      material: 'darkTimber',
    });

    for (const [index, offset] of postOffsets.entries()) {
      const position = [...part.position];
      if (alongX) position[0] = dominantCenter + offset;
      else position[2] = dominantCenter + offset;
      this.structureTrimInstances.push({
        id: `${part.id}-post-${index}`,
        position,
        size: [trimWidth, Math.max(0.4, height - 0.18), trimDepth],
        material: 'darkTimber',
      });
    }
  }

  buildPhotoProps() {
    this.photoPropCutouts = [];
    this.photoPropMaterials ??= new Map();
    this.photoPropGeometries ??= new Map();
    for (const item of WAR_MAP.photoProps) {
      const alphaTest = item.alphaTest ?? 0.035;
      const materialKey = `${item.asset}:${alphaTest}`;
      if (!this.photoPropMaterials.has(materialKey)) {
        this.photoPropMaterials.set(materialKey, new THREE.MeshBasicMaterial({
          map: loadPhotoTexture(item.asset),
          transparent: true,
          alphaTest,
          depthWrite: true,
          depthTest: true,
          fog: true,
          toneMapped: true,
          side: THREE.DoubleSide,
        }));
      }
      const geometryKey = `${item.width}:${item.height}`;
      if (!this.photoPropGeometries.has(geometryKey)) {
        this.photoPropGeometries.set(
          geometryKey,
          new THREE.PlaneGeometry(item.width, item.height),
        );
      }
      const cutout = createFixedPhotoProp({
        asset: item.asset,
        width: item.width,
        height: item.height,
        yaw: item.yaw ?? 0,
        visibleBottomRatio: item.visibleBottomRatio ?? 0,
        name: `war-photo-prop-${item.id}`,
        material: this.photoPropMaterials.get(materialKey),
        geometry: this.photoPropGeometries.get(geometryKey),
        alphaTest,
      });
      cutout.position.x = item.position[0];
      cutout.position.y += item.position[1] ?? 0;
      cutout.position.z = item.position[2];
      this.root.add(cutout);
      const record = {
        id: item.id,
        asset: item.asset,
        cutout,
        sprite: cutout,
        position: [...item.position],
        collisionBounds: item.collisionBounds,
        visibleBottomRatio: item.visibleBottomRatio ?? 0,
        collisionProxy: null,
      };
      if (item.collisionBounds) {
        record.collisionProxy = this.addInvisiblePropCollision(
          item.collisionBounds,
          `war-${item.id}`,
        );
        // Explicit Raycaster queries include invisible objects, so the proxy
        // still blocks local shots without spending a transparent render pass.
        record.collisionProxy.visible = false;
      }
      this.photoProps.push(record);
      this.photoPropCutouts.push(cutout);
    }
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
        visibleBottomRatio: item.visibleBottomRatio ?? 0,
      });
      cutout.position.set(...item.position);
      cutout.rotation.y = item.yaw ?? 0;
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
    for (const material of this.photoPropMaterials?.values() ?? []) material.dispose();
    for (const geometry of this.photoPropGeometries?.values() ?? []) geometry.dispose();
    this.foliageMaterials?.clear();
    this.foliageGeometries?.clear();
    this.photoPropMaterials?.clear();
    this.photoPropGeometries?.clear();
    super.dispose();
  }
}
