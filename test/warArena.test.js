import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WAR_APPROACH_FOLIAGE,
  WAR_COMBATANT_COUNT,
  WAR_FOLIAGE,
  WAR_MAP,
  WAR_TEAM_SIZE,
  warSpawnForSlot,
} from '../shared/warConfig.js';
import {
  FIXED_PHOTO_PROP_PLANE_DEPTH,
  fixedPhotoPropCollisionBounds,
  quantizeFixedPhotoPropYaw,
  rotatedFootprintExtents,
} from '../shared/warSceneryGeometry.js';
import { Arena } from '../src/game/Arena.js';
import {
  WAR_CENTER_ROAD_SEGMENTS,
  WAR_SPAWN_TRACK_PATCHES,
  createFixedCrossedPlane,
  createFixedPhotoProp,
  WarArena,
} from '../src/game/WarArena.js';

test('War is a 40-combatant symmetric map with no field pickups', () => {
  assert.equal(WAR_TEAM_SIZE, 20);
  assert.equal(WAR_COMBATANT_COUNT, 40);
  assert.deepEqual(WAR_MAP.pickups, []);
  assert.ok(WAR_MAP.bounds.x >= 100);
  assert.ok(WAR_MAP.bounds.z >= 80);
  assert.deepEqual(WAR_MAP.objective.position, [0, 0.02, 0]);

  for (let slot = 0; slot < WAR_TEAM_SIZE; slot += 1) {
    const first = warSpawnForSlot(0, slot);
    const second = warSpawnForSlot(1, slot);
    assert.equal(first[0], second[0]);
    assert.equal(first[1], second[1]);
    assert.equal(first[2], -second[2]);
  }
});

test('foliage uses two identical fixed planes at exactly 90 degrees', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true });
  const group = createFixedCrossedPlane({
    asset: '/assets/larp/war/tree.webp',
    width: 8,
    height: 11,
    material,
  });

  assert.equal(group.type, 'Group');
  assert.equal(group.userData.fixedCrossedPlane, true);
  assert.equal(group.children.length, 2);
  assert.ok(group.children.every((child) => child.type === 'Mesh'));
  assert.ok(group.children.every((child) => !child.isSprite));
  assert.equal(group.children[0].material, group.children[1].material);
  assert.equal(group.children[0].geometry, group.children[1].geometry);
  assert.equal(group.children[0].rotation.y, 0);
  assert.equal(group.children[1].rotation.y, Math.PI / 2);
  assert.equal(group.children[0].position.y, 5.5);
  assert.equal(group.children[1].position.y, 5.5);

  const rotations = group.children.map((child) => child.rotation.y);
  group.position.set(10, 0, -20);
  group.updateMatrixWorld(true);
  assert.deepEqual(group.children.map((child) => child.rotation.y), rotations);
});

test('fixed photo props keep their authored yaw and grounded transparent padding', () => {
  const prop = createFixedPhotoProp({
    asset: '/assets/larp/war/watchtower.webp',
    width: 20,
    height: 12,
    yaw: Math.PI / 2,
    visibleBottomRatio: 0.125,
  });
  assert.equal(prop.type, 'Mesh');
  assert.equal(prop.userData.fixedPhotoProp, true);
  assert.equal(prop.rotation.y, Math.PI / 2);
  assert.equal(prop.position.y, 4.5);
  assert.equal(prop.material.transparent, true);
  assert.equal(prop.material.side, THREE.DoubleSide);
  prop.geometry.dispose();
  prop.material.dispose();
});

test('every War photo prop shares one thin-plane visual and authority footprint', () => {
  const colliderKeys = new Set(WAR_MAP.colliders.map((bounds) => JSON.stringify(bounds)));
  const visibleCover = [
    ...WAR_MAP.structureParts
      .filter((part) => part.solid)
      .map((part) => ({ id: part.id, bounds: part.bounds })),
    ...WAR_MAP.legacyCover
      .filter((cover) => !cover.photoReplacementId)
      .map((cover) => ({ id: cover.id, bounds: cover.bounds })),
  ];
  const horizontalGap = (first, second) => Math.hypot(
    Math.max(first[0] - second[3], second[0] - first[3], 0),
    Math.max(first[2] - second[5], second[2] - first[5], 0),
  );

  for (const prop of WAR_MAP.photoProps) {
    assert.equal(prop.fixedPlane, true, `${prop.id}: not marked as a fixed plane`);
    assert.equal(prop.presentation, 'fixed-plane', `${prop.id}: wrong presentation`);
    assert.equal(prop.yaw, quantizeFixedPhotoPropYaw(prop.yaw));
    const collisionHeight = prop.collisionBounds[4] - prop.position[1];
    assert.deepEqual(
      prop.collisionBounds,
      fixedPhotoPropCollisionBounds(prop.position, prop.width, collisionHeight, prop.yaw),
      `${prop.id}: collision does not match its fixed photo plane`,
    );
    const [extentX, extentZ] = rotatedFootprintExtents(
      prop.width,
      FIXED_PHOTO_PROP_PLANE_DEPTH,
      prop.yaw,
    );
    assert.ok(Math.abs(prop.collisionBounds[3] - prop.collisionBounds[0] - extentX) < 1e-10);
    assert.ok(Math.abs(prop.collisionBounds[5] - prop.collisionBounds[2] - extentZ) < 1e-10);
    assert.ok(
      Math.min(
        prop.collisionBounds[3] - prop.collisionBounds[0],
        prop.collisionBounds[5] - prop.collisionBounds[2],
      ) <= 0.081,
      `${prop.id}: fixed photo wall is thicker than 8.1 cm`,
    );
    assert.ok(
      colliderKeys.has(JSON.stringify(prop.collisionBounds)),
      `${prop.id}: thin photo collider missing from server authority`,
    );
    for (const cover of visibleCover) {
      assert.ok(
        horizontalGap(prop.collisionBounds, cover.bounds) >= 0.35,
        `${prop.id}: fixed plane is embedded in visible cover ${cover.id}`,
      );
    }
  }
});

test('WarArena instantiates all dense scenery with fixed photo geometry', () => {
  const scene = new THREE.Scene();
  const arena = new WarArena(scene, {});

  assert.equal(arena.root.name, 'war-arena');
  assert.equal(arena.weaponSlots.length, 0);
  assert.equal(arena.foliageCutouts.length, WAR_FOLIAGE.length);
  assert.equal(arena.photoPropCutouts.length, WAR_MAP.photoProps.length);
  assert.equal(arena.surfaceMeshes.length, WAR_MAP.surfaces.length);
  assert.equal(
    arena.roadMeshes.length,
    WAR_CENTER_ROAD_SEGMENTS.length + WAR_SPAWN_TRACK_PATCHES.length,
  );
  assert.equal(
    arena.structureMeshes.length,
    WAR_MAP.structureParts.length +
      WAR_MAP.legacyCover.filter((cover) => !cover.photoReplacementId).length,
  );
  assert.equal(arena.colliders.length, WAR_MAP.colliders.length);
  assert.equal(
    arena.raycastMeshes.length,
    WAR_MAP.colliders.length,
    'every authority collider has one client ray obstruction',
  );
  assert.ok(arena.structureMeshes.every((mesh) => mesh.visible === false));
  assert.ok(arena.surfaceMeshes.every((mesh) => mesh.visible === false));
  assert.ok(arena.roadMeshes.every((mesh) => mesh.visible === false));
  assert.ok(arena.structureBatches.every((mesh) => mesh.isInstancedMesh));
  assert.ok(WAR_MAP.structureParts.some((part) => part.role === 'roof'));
  assert.ok(
    arena.structureBatches.some((mesh) => mesh.material === arena.materials.roof),
    'Arena-only roof removal must retain War roof/debris material batches',
  );
  assert.ok(arena.surfaceBatches.every((mesh) => mesh.isInstancedMesh));
  assert.ok(arena.roadBatches.every((mesh) => mesh.isInstancedMesh));
  assert.ok(arena.structureTrimMeshes.every((mesh) => mesh.isInstancedMesh));
  assert.ok(arena.structureBatches.length <= 7);
  assert.ok(arena.surfaceBatches.length <= 4);
  assert.ok(arena.roadBatches.length <= 2);
  assert.equal(arena.structureTrimMeshes.length, 1);
  assert.ok(arena.photoProps.every(({ collisionProxy }) =>
    collisionProxy?.visible === false));
  arena.setControlState(null);
  assert.equal(arena.objectiveMarker.visible, false);
  assert.equal(arena.objectiveFill.visible, false);
  arena.setControlState({ owner: null, contested: false });
  assert.equal(arena.objectiveMarker.visible, true);
  assert.equal(arena.objectiveFill.visible, true);
  const proxy = arena.photoProps[0].collisionProxy;
  const proxyBounds = arena.photoProps[0].collisionBounds;
  const proxyCenter = new THREE.Vector3(
    proxyBounds[0] - 2,
    (proxyBounds[1] + proxyBounds[4]) / 2,
    (proxyBounds[2] + proxyBounds[5]) / 2,
  );
  arena.raycaster.set(proxyCenter, new THREE.Vector3(1, 0, 0));
  arena.raycaster.far = proxyBounds[3] - proxyBounds[0] + 4;
  assert.ok(
    arena.raycaster.intersectObject(proxy, false).length > 0,
    'hidden collision proxies must remain available to explicit shot raycasts',
  );
  for (const [index, cutout] of arena.photoPropCutouts.entries()) {
    const authored = WAR_MAP.photoProps[index];
    const runtime = arena.photoProps[index];
    assert.equal(cutout.type, 'Mesh');
    assert.equal(cutout.userData.fixedPhotoProp, true);
    assert.equal(cutout.isSprite, undefined);
    assert.equal(cutout.rotation.y, authored.yaw);
    assert.equal(cutout.position.x, authored.position[0]);
    assert.equal(cutout.position.z, authored.position[2]);
    assert.equal(runtime.collisionBounds, authored.collisionBounds);
    assert.equal(runtime.collisionProxy.userData.bounds, authored.collisionBounds);
    assert.deepEqual(runtime.collisionProxy.position.toArray(), [
      (authored.collisionBounds[0] + authored.collisionBounds[3]) / 2,
      (authored.collisionBounds[1] + authored.collisionBounds[4]) / 2,
      (authored.collisionBounds[2] + authored.collisionBounds[5]) / 2,
    ]);
  }
  for (const cutout of arena.foliageCutouts) {
    assert.equal(cutout.userData.fixedCrossedPlane, true);
    assert.equal(cutout.children.length, 2);
    assert.deepEqual(cutout.children.map((child) => child.rotation.y), [0, Math.PI / 2]);
  }
  assert.equal(
    new Set(arena.foliageCutouts.map((cutout) => cutout.children[0].geometry)).size,
    new Set(WAR_FOLIAGE.map((item) => `${item.width}:${item.height}`)).size,
    'every repeated authored foliage size shares one geometry',
  );

  const before = arena.foliageCutouts.map((cutout) => cutout.rotation.y);
  const sharedBeforeReload = arena.foliageCutouts.map(
    (cutout) => cutout.children[0].geometry,
  );
  const objectiveGeometry = arena.objectiveMarker.geometry;
  const objectiveMaterial = arena.objectiveMarker.material;
  const structureBatch = arena.structureBatches[0];
  let objectiveGeometryDisposed = false;
  let objectiveMaterialDisposed = false;
  let structureBatchDisposed = false;
  objectiveGeometry.addEventListener('dispose', () => {
    objectiveGeometryDisposed = true;
  });
  objectiveMaterial.addEventListener('dispose', () => {
    objectiveMaterialDisposed = true;
  });
  structureBatch.addEventListener('dispose', () => {
    structureBatchDisposed = true;
  });
  let shadowMapDisposed = 0;
  let shadowMapPassDisposed = 0;
  arena.sun.shadow.map = { dispose: () => { shadowMapDisposed += 1; } };
  arena.sun.shadow.mapPass = { dispose: () => { shadowMapPassDisposed += 1; } };
  arena.update(2, 1 / 30, new THREE.Vector3(80, 1.6, 70));
  assert.deepEqual(
    arena.foliageCutouts.map((cutout) => cutout.rotation.y),
    before,
    'foliage must never turn toward the camera',
  );
  arena.load(0, 2);
  assert.equal(objectiveGeometryDisposed, true, 'reload disposes the prior control geometry');
  assert.equal(objectiveMaterialDisposed, true, 'reload disposes the prior control material');
  assert.equal(structureBatchDisposed, true, 'reload releases prior instance buffers');
  assert.equal(shadowMapDisposed, 1, 'reload disposes the prior shadow render target');
  assert.equal(shadowMapPassDisposed, 1, 'reload disposes the prior VSM shadow target');
  assert.deepEqual(
    arena.foliageCutouts.map((cutout) => cutout.children[0].geometry),
    sharedBeforeReload,
    'reloading War must reuse crossed-plane geometry',
  );
  arena.dispose();
});

test('spawn views use a narrow broken road and mirrored non-solid foreground foliage', () => {
  assert.equal(WAR_CENTER_ROAD_SEGMENTS.length, 3);
  assert.ok(WAR_CENTER_ROAD_SEGMENTS.every(({ size }) => size[0] <= 12));
  assert.ok(
    WAR_CENTER_ROAD_SEGMENTS.every(({ position, size }) =>
      Math.abs(position[2]) + size[2] / 2 <= 80),
    'the main dirt slab must stop before the rear spawn-camera foreground',
  );
  assert.equal(WAR_SPAWN_TRACK_PATCHES.length, 8);
  assert.equal(WAR_APPROACH_FOLIAGE.length, 8);
  assert.ok(WAR_APPROACH_FOLIAGE.every((item) => !item.solid && !item.collisionBounds));

  for (const item of WAR_APPROACH_FOLIAGE) {
    const mirror = WAR_APPROACH_FOLIAGE.find((candidate) =>
      candidate.type === item.type &&
      candidate.position[0] === -item.position[0] &&
      candidate.position[2] === -item.position[2]);
    assert.ok(mirror, `${item.id} has no rotationally mirrored deployment counterpart`);
    assert.equal(mirror.width, item.width);
    assert.equal(mirror.height, item.height);
    assert.ok(
      Math.hypot(item.position[0], item.position[2]) >= WAR_MAP.objective.radius + 20,
      `${item.id} crowds the objective sightline`,
    );
    for (let team = 0; team < 2; team += 1) {
      for (let slot = 0; slot < WAR_TEAM_SIZE; slot += 1) {
        const spawn = warSpawnForSlot(team, slot);
        assert.ok(
          Math.hypot(item.position[0] - spawn[0], item.position[2] - spawn[2]) >=
            item.width / 2 + 3,
          `${item.id} visually crowds team ${team} spawn ${slot}`,
        );
      }
    }
  }
});

test('Arena and War restore their own sky and fog on every activation', () => {
  const scene = new THREE.Scene();
  const arena = new Arena(scene, {});
  const war = new WarArena(scene, {});

  arena.activateEnvironment();
  const arenaBackground = scene.background.getHex();
  const arenaFog = scene.fog.color.getHex();
  const arenaDensity = scene.fog.density;

  war.activateEnvironment();
  assert.equal(scene.background.getHex(), 0x9eb8c5);
  assert.equal(scene.fog.color.getHex(), 0xc4cfbf);
  assert.equal(scene.fog.density, 0.0048);

  arena.activateEnvironment();
  assert.equal(scene.background.getHex(), arenaBackground);
  assert.equal(scene.fog.color.getHex(), arenaFog);
  assert.equal(scene.fog.density, arenaDensity);

  war.activateEnvironment();
  assert.equal(scene.background.getHex(), 0x9eb8c5);
  assert.equal(scene.fog.color.getHex(), 0xc4cfbf);
  assert.equal(scene.fog.density, 0.0048);

  arena.dispose();
  war.dispose();
});

test('the central objective is open and cannot hide a collision box', () => {
  const radius = WAR_MAP.objective.radius;
  for (const bounds of WAR_MAP.colliders.slice(5)) {
    const nearestX = Math.max(bounds[0], Math.min(0, bounds[3]));
    const nearestZ = Math.max(bounds[2], Math.min(0, bounds[5]));
    assert.ok(
      Math.hypot(nearestX, nearestZ) >= radius + 3,
      `cover enters the control point: ${bounds.join(',')}`,
    );
  }
});
