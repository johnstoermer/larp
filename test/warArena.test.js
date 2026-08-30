import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WAR_COMBATANT_COUNT,
  WAR_FOLIAGE,
  WAR_MAP,
  WAR_TEAM_SIZE,
  warSpawnForSlot,
} from '../shared/warConfig.js';
import { Arena } from '../src/game/Arena.js';
import { createFixedCrossedPlane, WarArena } from '../src/game/WarArena.js';

test('War is an 80-combatant symmetric map with no field pickups', () => {
  assert.equal(WAR_TEAM_SIZE, 40);
  assert.equal(WAR_COMBATANT_COUNT, 80);
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

test('WarArena instantiates every tree and bush as fixed crossed geometry', () => {
  const scene = new THREE.Scene();
  const arena = new WarArena(scene, {});

  assert.equal(arena.root.name, 'war-arena');
  assert.equal(arena.weaponSlots.length, 0);
  assert.equal(arena.foliageCutouts.length, WAR_FOLIAGE.length);
  assert.equal(arena.colliders.length, WAR_MAP.colliders.length);
  assert.ok(arena.raycastMeshes.length < 24);
  for (const cutout of arena.foliageCutouts) {
    assert.equal(cutout.userData.fixedCrossedPlane, true);
    assert.equal(cutout.children.length, 2);
    assert.deepEqual(cutout.children.map((child) => child.rotation.y), [0, Math.PI / 2]);
  }
  assert.equal(
    new Set(arena.foliageCutouts.map((cutout) => cutout.children[0].geometry)).size,
    2,
    'all trees share one geometry and all bushes share one geometry',
  );

  const before = arena.foliageCutouts.map((cutout) => cutout.rotation.y);
  const sharedBeforeReload = arena.foliageCutouts.map(
    (cutout) => cutout.children[0].geometry,
  );
  const objectiveGeometry = arena.objectiveMarker.geometry;
  const objectiveMaterial = arena.objectiveMarker.material;
  let objectiveGeometryDisposed = false;
  let objectiveMaterialDisposed = false;
  objectiveGeometry.addEventListener('dispose', () => {
    objectiveGeometryDisposed = true;
  });
  objectiveMaterial.addEventListener('dispose', () => {
    objectiveMaterialDisposed = true;
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
  assert.equal(shadowMapDisposed, 1, 'reload disposes the prior shadow render target');
  assert.equal(shadowMapPassDisposed, 1, 'reload disposes the prior VSM shadow target');
  assert.deepEqual(
    arena.foliageCutouts.map((cutout) => cutout.children[0].geometry),
    sharedBeforeReload,
    'reloading War must reuse crossed-plane geometry',
  );
  arena.dispose();
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
