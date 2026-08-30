import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WAR_RENDER_POOL_SIZE,
  WarCrowd,
  selectWarRenderStates,
  warFighterState,
} from '../src/game/WarCrowd.js';

function combatant(id, overrides = {}) {
  return {
    id,
    team: id % 2,
    slot: Math.floor(id / 2),
    human: false,
    name: `Bot ${id}`,
    classId: 'shortbow',
    position: [id - 40, 0.02, 0],
    velocity: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    health: 90,
    maxHealth: 90,
    dead: false,
    respawnRemaining: 0,
    attackSequence: 0,
    ...overrides,
  };
}

test('visibility selection culls by distance, local identity, and fixed pool cap', () => {
  const states = Array.from({ length: 80 }, (_, id) => combatant(id));
  const selected = selectWarRenderStates(states, new THREE.Vector3(0, 1, 0), {
    localId: 40,
    capacity: 12,
    renderDistance: 18,
  });
  assert.equal(selected.length, 12);
  assert.ok(selected.every((state) => state.id !== 40));
  assert.ok(selected.every((state) => Math.abs(state.position[0]) <= 18));
  for (let index = 1; index < selected.length; index += 1) {
    assert.ok(
      Math.abs(selected[index - 1].position[0]) <= Math.abs(selected[index].position[0]),
    );
  }
});

test('fighter animation state covers walk, attack, hit, death, and idle', () => {
  assert.equal(warFighterState(combatant(1), {}, 100), 'idle');
  assert.equal(warFighterState(combatant(1, { velocity: [1, 0, 0] }), {}, 100), 'walk');
  assert.equal(warFighterState(combatant(1), { attackUntil: 101 }, 100), 'attack');
  assert.equal(warFighterState(combatant(1), { hitUntil: 101, attackUntil: 102 }, 100), 'hit');
  assert.equal(warFighterState(combatant(1, { dead: true }), { hitUntil: 101 }, 100), 'death');
});

test('WarCrowd represents 80 states with a bounded lightweight render pool', () => {
  const scene = new THREE.Scene();
  const crowd = new WarCrowd(scene);
  const states = Array.from({ length: 80 }, (_, id) => combatant(id, {
    position: [(id % 10) - 5, 0.02, Math.floor(id / 10) - 4],
  }));
  crowd.localId = 0;
  crowd.applySnapshot(states, 1_000);
  const visible = crowd.update({ position: new THREE.Vector3(0, 1.6, 0) }, 1 / 60, 1_016);

  assert.equal(crowd.states.size, 80);
  assert.equal(crowd.slots.length, WAR_RENDER_POOL_SIZE);
  assert.equal(visible, 79);
  assert.equal(crowd.slotById.size, WAR_RENDER_POOL_SIZE);
  assert.ok(crowd.slots.every((slot) => slot.root.children.length === 2));
  assert.ok(crowd.slots.every((slot) => slot.sprite.isSprite));
  assert.ok(crowd.slots.every((slot) => slot.healthBar.isSprite));
});

test('snapshot changes drive pooled attack and hit frames without allocating actors', () => {
  const scene = new THREE.Scene();
  const crowd = new WarCrowd(scene, { capacity: 2 });
  crowd.applySnapshot([combatant(1), combatant(2)], 100);
  crowd.update({ position: new THREE.Vector3() }, 1 / 60, 101);
  const slots = [...crowd.slots];

  crowd.applySnapshot([
    combatant(1, { attackSequence: 1 }),
    combatant(2, { health: 25 }),
  ], 200);
  crowd.update({ position: new THREE.Vector3() }, 1 / 60, 201);

  assert.deepEqual(crowd.slots, slots);
  assert.equal(crowd.slotById.get(1).fighterState, 'attack');
  assert.equal(crowd.slotById.get(2).fighterState, 'hit');
  assert.ok(crowd.slots.every((slot) => slot.healthBar.userData.fillPixels <= 90));
});

test('health bars cull behind and too near the camera without hiding fighters', () => {
  const scene = new THREE.Scene();
  const crowd = new WarCrowd(scene, { capacity: 3 });
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 300);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);
  crowd.applySnapshot([
    combatant(1, { position: [0, 0.02, -8] }),
    combatant(2, { position: [0, 0.02, 3] }),
    combatant(3, { position: [0, 0.02, -0.5] }),
  ], 100);
  crowd.update(camera, 1 / 60, 101);

  assert.equal(crowd.slotById.get(1).healthBar.visible, true);
  assert.equal(crowd.slotById.get(2).healthBar.visible, false);
  assert.equal(crowd.slotById.get(3).healthBar.visible, false);
  assert.ok(crowd.slots.every((slot) => slot.root.visible));
  assert.ok(crowd.slots.every((slot) => slot.sprite.visible));
});

test('1,000 client LOD passes for 80 actors stay within a conservative CPU budget', () => {
  const states = Array.from({ length: 80 }, (_, id) => combatant(id, {
    position: [(id % 10) * 2 - 9, 0.02, Math.floor(id / 10) * 2 - 7],
  }));
  const camera = new THREE.Vector3(0, 1.6, 0);
  const startedAt = performance.now();
  for (let index = 0; index < 1_000; index += 1) {
    const selected = selectWarRenderStates(states, camera);
    assert.equal(selected.length, WAR_RENDER_POOL_SIZE);
  }
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 500, `LOD selection took ${elapsed.toFixed(1)} ms`);
});
