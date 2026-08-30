import * as THREE from 'three';
import { BotController } from './BotController.js';
import { clamp } from './math.js';

const FIXED_STEP = 1 / 60;
const BATTLE_MIN_X = 9.0;
const BATTLE_MAX_X = 17.4;
const BATTLE_MIN_Z = -5.6;
const BATTLE_MAX_Z = 0.45;
const BATTLE_CENTER = new THREE.Vector3(13.2, 0.02, -2.55);
const CAMERA_TARGET = new THREE.Vector3(10.6, 1.05, -2.55);
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_C = new THREE.Vector3();

const ATTACK_DURATIONS = Object.freeze({
  greatsword: 0.46,
  shortbow: 0.28,
  lightning: 0.2,
  ember: 0.32,
});

export const TITLE_ATTRACT_ROSTER = Object.freeze([
  Object.freeze({
    id: 'sword',
    weapon: 'greatsword',
    spawn: Object.freeze([11.25, 0.02, -1.0]),
    speed: 2.75,
    idealDistance: 1.65,
    attackRange: 2.35,
    attackInterval: 1.28,
    firstAttack: 0.18,
    damage: 58,
    orbit: 1,
    respawnDelay: 1.95,
  }),
  Object.freeze({
    id: 'bow',
    weapon: 'shortbow',
    spawn: Object.freeze([14.05, 0.02, -1.45]),
    speed: 2.15,
    idealDistance: 4.25,
    attackRange: 7.4,
    attackInterval: 1.02,
    firstAttack: 0.48,
    damage: 36,
    orbit: -1,
    respawnDelay: 2.2,
  }),
  Object.freeze({
    id: 'storm',
    weapon: 'lightning',
    spawn: Object.freeze([11.1, 0.02, -4.65]),
    speed: 2.35,
    idealDistance: 4.5,
    attackRange: 7.8,
    attackInterval: 0.88,
    firstAttack: 0.72,
    damage: 34,
    orbit: -1,
    respawnDelay: 2.05,
  }),
  Object.freeze({
    id: 'ember',
    weapon: 'ember',
    spawn: Object.freeze([15.05, 0.02, -4.0]),
    speed: 2.25,
    idealDistance: 3.6,
    attackRange: 6.8,
    attackInterval: 1.16,
    firstAttack: 1.0,
    damage: 42,
    orbit: 1,
    respawnDelay: 2.35,
  }),
]);

function hiddenController(scene, arena, definition, index) {
  // Attract combat never calls the gameplay bot's audio hooks. Giving each
  // presentation controller a deliberately empty audio object makes that
  // separation explicit and prevents title playback from initializing audio.
  const controller = new BotController(scene, arena, Object.freeze({}));
  controller.root.name = `title-attract-fighter-${definition.id}`;
  controller.root.userData.titleAttract = true;
  controller.root.userData.attractIndex = index;
  controller.root.userData.identity = definition.id;
  controller.root.userData.weapon = definition.weapon;
  controller.root.visible = false;
  controller.healthBar.visible = false;
  return controller;
}

function nearestLivingTarget(record, records) {
  let target = null;
  let bestDistance = Infinity;
  for (const candidate of records) {
    if (candidate === record || candidate.controller.dead) continue;
    const distance = record.controller.position.distanceToSquared(candidate.controller.position);
    if (
      distance < bestDistance - 0.0001 ||
      (Math.abs(distance - bestDistance) <= 0.0001 && candidate.index < (target?.index ?? Infinity))
    ) {
      target = candidate;
      bestDistance = distance;
    }
  }
  return target;
}

function stateArray(states) {
  return [...states].sort();
}

/**
 * A silent, deterministic title-screen combat vignette. The actors are real
 * BotController fighter models, but this class owns their movement, health,
 * attacks and effects so none of the player, opponent, projectile or network
 * state used by a match can be mutated.
 */
export class TitleAttractBattle {
  constructor(scene, arena, vfx) {
    this.scene = scene;
    this.arena = arena;
    this.vfx = vfx;
    this.active = false;
    this.time = 0;
    this.accumulator = 0;
    this.session = 0;
    this.stats = this.createStats();
    this.actors = TITLE_ATTRACT_ROSTER.map((definition, index) => ({
      index,
      definition,
      controller: hiddenController(scene, arena, definition, index),
      nextAttackAt: definition.firstAttack,
      deadAt: null,
      respawnAt: Infinity,
      respawnCount: 0,
      targetIndex: null,
    }));
  }

  createStats() {
    return {
      attacks: 0,
      hits: 0,
      deaths: 0,
      respawns: 0,
      targetingSteps: 0,
      observedStates: new Set(['idle']),
    };
  }

  start() {
    this.stop(false);
    this.vfx.clear();
    this.active = true;
    this.time = 0;
    this.accumulator = 0;
    this.session += 1;
    this.stats = this.createStats();
    for (const record of this.actors) this.resetActor(record, true);
  }

  stop(clearEffects = true) {
    this.active = false;
    this.accumulator = 0;
    for (const record of this.actors) {
      record.controller.root.visible = false;
      record.controller.healthBar.visible = false;
      record.controller.velocity.set(0, 0, 0);
      record.targetIndex = null;
    }
    if (clearEffects) this.vfx.clear();
  }

  resetActor(record, initial = false) {
    const { controller, definition } = record;
    controller.reset(new THREE.Vector3(...definition.spawn), Math.PI, 1);
    controller.equip(definition.weapon);
    controller.root.visible = true;
    controller.healthBar.visible = true;
    controller.root.userData.titleAttract = true;
    controller.root.userData.identity = definition.id;
    controller.root.userData.weapon = definition.weapon;
    record.deadAt = null;
    record.respawnAt = Infinity;
    record.targetIndex = null;
    record.nextAttackAt = this.time + (initial ? definition.firstAttack : 0.35 + record.index * 0.12);
    if (!initial) {
      record.respawnCount += 1;
      this.stats.respawns += 1;
      this.vfx.spawnPhotoEffect(
        'dust',
        controller.position.clone().add(new THREE.Vector3(0, 0.85, 0)),
        1.05,
        1.05,
        0.48,
        { opacity: 0.72, growth: 0.38, rise: 0.24 },
      );
    }
  }

  update(delta, camera = null) {
    if (!this.active) return;
    this.accumulator += Math.min(Math.max(Number(delta) || 0, 0), 0.1);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 8) {
      this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (camera) this.frameCamera(camera);
  }

  step(delta) {
    this.time += delta;

    for (const record of this.actors) {
      if (record.controller.dead && this.time >= record.respawnAt) this.resetActor(record);
    }

    for (const record of this.actors) {
      const { controller, definition } = record;
      if (controller.dead) {
        controller.velocity.set(0, 0, 0);
        controller.animate(delta, TEMP_A.set(0, 0, 0), false);
        this.stats.observedStates.add(controller.fighterState);
        continue;
      }

      const target = nearestLivingTarget(record, this.actors);
      record.targetIndex = target?.index ?? null;
      if (target) this.stats.targetingSteps += 1;
      const wish = TEMP_A.set(0, 0, 0);
      if (target) {
        const offset = TEMP_B.copy(target.controller.position).sub(controller.position);
        offset.y = 0;
        const distance = Math.max(0.001, offset.length());
        const direction = offset.multiplyScalar(1 / distance);
        const rangeError = clamp((distance - definition.idealDistance) / 0.8, -1, 1);
        wish.addScaledVector(direction, rangeError);
        wish.x += -direction.z * definition.orbit * 0.38;
        wish.z += direction.x * definition.orbit * 0.38;

        const eye = controller.getEyePosition(TEMP_C);
        const targetPoint = target.controller.getBodyCenter(new THREE.Vector3());
        controller.aimDirection.copy(targetPoint.sub(eye).normalize());
        controller.yaw = Math.atan2(-direction.x, -direction.z);
        controller.root.rotation.y = controller.yaw;

        if (
          distance <= definition.attackRange &&
          this.time >= record.nextAttackAt
        ) {
          this.attack(record, target);
        }
      } else {
        wish.copy(BATTLE_CENTER).sub(controller.position);
        wish.y = 0;
      }

      const fromCenter = TEMP_C.copy(controller.position).sub(BATTLE_CENTER);
      fromCenter.y = 0;
      if (fromCenter.lengthSq() > 11) wish.addScaledVector(fromCenter.normalize(), -0.62);
      if (wish.lengthSq() > 1) wish.normalize();
      const desiredX = wish.x * definition.speed;
      const desiredZ = wish.z * definition.speed;
      const response = 1 - Math.exp(-delta * 7.5);
      controller.velocity.x += (desiredX - controller.velocity.x) * response;
      controller.velocity.z += (desiredZ - controller.velocity.z) * response;
      controller.position.x = clamp(
        controller.position.x + controller.velocity.x * delta,
        BATTLE_MIN_X,
        BATTLE_MAX_X,
      );
      controller.position.y = 0.02;
      controller.position.z = clamp(
        controller.position.z + controller.velocity.z * delta,
        BATTLE_MIN_Z,
        BATTLE_MAX_Z,
      );
      controller.animate(delta, wish, Boolean(target));
      this.stats.observedStates.add(controller.fighterState);
    }
  }

  attack(record, target) {
    const { controller, definition } = record;
    record.nextAttackAt = this.time + definition.attackInterval;
    controller.attackTime = ATTACK_DURATIONS[definition.weapon] ?? 0.24;
    controller.lastShotAt = this.time;
    this.stats.attacks += 1;

    const muzzle = controller.getMuzzlePosition(new THREE.Vector3());
    const impact = target.controller.getBodyCenter(new THREE.Vector3());
    const direction = impact.clone().sub(muzzle).normalize();
    const accent = controller.definition.accent;
    this.vfx.spawnMuzzle(muzzle, direction, accent, 0.72, definition.weapon);
    if (definition.weapon === 'shortbow') {
      this.vfx.spawnFlyingProp(muzzle, impact, definition.weapon);
    } else if (definition.weapon === 'lightning') {
      this.vfx.spawnTracer(muzzle, impact, 0x8cefff, 0.026, 0.12);
    } else if (definition.weapon === 'ember') {
      this.vfx.spawnTracer(muzzle, impact, 0xff9d5c, 0.018, 0.09);
    }

    const applied = target.controller.damage(definition.damage);
    if (applied <= 0) return;
    this.stats.hits += 1;
    target.controller.flashHit = Math.max(target.controller.flashHit, 0.24);
    target.controller.updateFighterState();
    this.vfx.spawnBloodImpact(impact, direction, false);
    this.vfx.spawnDamageNumber(
      target.controller.getHeadCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.22, 0)),
      applied,
    );

    if (target.controller.dead) {
      target.deadAt = this.time;
      target.respawnAt = this.time + target.definition.respawnDelay;
      target.targetIndex = null;
      this.stats.deaths += 1;
      this.vfx.spawnDeathBurst(target.controller.position.clone(), direction);
    }
  }

  frameCamera(camera) {
    const sway = Math.sin(this.time * 0.16);
    camera.position.set(
      20.05 + sway * 0.42,
      4.25 + Math.sin(this.time * 0.21) * 0.16,
      -9.7 + Math.cos(this.time * 0.13) * 0.35,
    );
    camera.lookAt(CAMERA_TARGET);
  }

  snapshot() {
    return {
      active: this.active,
      session: this.session,
      time: this.time,
      stats: {
        attacks: this.stats.attacks,
        hits: this.stats.hits,
        deaths: this.stats.deaths,
        respawns: this.stats.respawns,
        targetingSteps: this.stats.targetingSteps,
        observedStates: stateArray(this.stats.observedStates),
      },
      actors: this.actors.map((record) => ({
        id: record.definition.id,
        weapon: record.definition.weapon,
        position: record.controller.position.toArray(),
        velocity: record.controller.velocity.toArray(),
        state: record.controller.fighterState,
        health: record.controller.health,
        dead: record.controller.dead,
        visible: record.controller.root.visible,
        targetIndex: record.targetIndex,
        respawnCount: record.respawnCount,
      })),
    };
  }
}
