import * as THREE from 'three';
import { CHARACTER_HITBOX } from '../../shared/characterHitbox.js';
import { clamp, damp, moveToward } from './math.js';
import { createHealthBarTexture, updateHealthBarTexture } from './healthBar.js';
import { loadPhotoTexture } from './photoTexture.js';
import { WEAPONS } from './weapons.js';

const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_C = new THREE.Vector3();
const fighterTextures = new Map();

export const FIGHTER_ANIMATION_STATES = Object.freeze([
  'idle',
  'walk',
  'attack',
  'hit',
  'death',
]);
export const FIGHTER_WALK_SPEED_THRESHOLD = 0.35;

function normalizeFighterState(state) {
  return FIGHTER_ANIMATION_STATES.includes(state) ? state : 'idle';
}

export function fighterTextureUrl(type, state = 'idle') {
  const definition = WEAPONS[type] ?? WEAPONS.knives;
  return `/assets/larp/fighters/${definition.asset}-${normalizeFighterState(state)}.webp`;
}

function fighterTexture(type, state = 'idle') {
  const definition = WEAPONS[type] ?? WEAPONS.knives;
  const normalizedState = normalizeFighterState(state);
  const key = `${definition.id}:${normalizedState}`;
  if (!fighterTextures.has(key)) {
    fighterTextures.set(
      key,
      loadPhotoTexture(fighterTextureUrl(definition.id, normalizedState)),
    );
  }
  return fighterTextures.get(key);
}

function preloadFighterTextures() {
  for (const definition of Object.values(WEAPONS)) {
    for (const state of FIGHTER_ANIMATION_STATES) {
      fighterTexture(definition.id, state);
    }
  }
}

export function selectFighterState({
  dead = false,
  flashHit = 0,
  attackTime = 0,
  speed = 0,
} = {}) {
  if (dead) return 'death';
  if (Number.isFinite(flashHit) && flashHit > 0) return 'hit';
  if (Number.isFinite(attackTime) && attackTime > 0) return 'attack';
  if (Number.isFinite(speed) && speed > FIGHTER_WALK_SPEED_THRESHOLD) return 'walk';
  return 'idle';
}

const ATTACK_MOTION = Object.freeze({
  knives: { duration: 0.18, rotate: -0.07, x: 0.12, y: 0.01, scale: 0.04 },
  shortbow: { duration: 0.28, rotate: 0.025, x: -0.02, y: -0.025, scale: 0.025 },
  ember: { duration: 0.32, rotate: -0.035, x: 0.02, y: 0.045, scale: 0.08 },
  crossbow: { duration: 0.2, rotate: 0.018, x: -0.035, y: -0.035, scale: -0.025 },
  lightning: { duration: 0.2, rotate: 0.055, x: 0.035, y: 0.025, scale: 0.055 },
  longbow: { duration: 0.3, rotate: -0.018, x: 0.015, y: -0.03, scale: 0.02 },
  greatsword: { duration: 0.46, rotate: -0.17, x: 0.14, y: 0.02, scale: 0.035 },
  fireball: { duration: 0.38, rotate: 0.04, x: -0.03, y: 0.06, scale: 0.1 },
});

// The greatsword and longbow photographs devote more of their canvas to a
// tall prop, so their people need a small presentation correction to match the
// apparent body scale of the rest of the roster.
const FIGHTER_PRESENTATION_SCALE = Object.freeze({
  longbow: 1.13,
  greatsword: 1.18,
});

function fighterPresentationScale(type) {
  return FIGHTER_PRESENTATION_SCALE[type] ?? 1;
}

function angleDifference(from, to) {
  let difference = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
  if (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

export class BotController {
  constructor(scene, arena, audio) {
    this.scene = scene;
    this.arena = arena;
    this.audio = audio;
    this.root = new THREE.Group();
    this.root.name = 'larp-opponent';
    this.scene.add(this.root);
    this.position = this.root.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.airTime = 0;
    this.weaponType = 'knives';
    this.ammo = WEAPONS.knives.ammo;
    this.reserve = WEAPONS.knives.reserve;
    this.reloading = false;
    this.lastShotAt = -Infinity;
    this.sightTime = 0;
    this.lostSightTime = 0;
    this.repathTimer = 0;
    this.strafeDirection = 1;
    this.strafeTimer = 0;
    this.jumpCooldown = 0;
    this.stuckTime = 0;
    this.lastPosition = new THREE.Vector3();
    this.targetPickup = null;
    this.aimDirection = new THREE.Vector3(0, 0, -1);
    this.aimError = new THREE.Vector3();
    this.errorTimer = 0;
    this.recoil = 0;
    this.animTime = 0;
    this.difficulty = 1;
    this.flashHit = 0;
    this.attackTime = 0;
    this.fighterState = 'idle';
    preloadFighterTextures();
    this.createModel();
    this.setWeaponModel('knives');
  }

  createModel() {
    this.spriteTexture = fighterTexture('knives', 'idle');
    this.spriteMaterial = new THREE.SpriteMaterial({
      map: this.spriteTexture,
      transparent: true,
      alphaTest: 0.055,
      depthWrite: true,
      depthTest: true,
      fog: true,
      toneMapped: true,
    });
    this.sprite = new THREE.Sprite(this.spriteMaterial);
    this.sprite.name = 'individual-photographic-larp-fighter';
    this.sprite.userData.state = 'idle';
    this.sprite.center.set(0.5, 0.015);
    this.sprite.position.y = 0.015;
    this.sprite.scale.set(1.6, 2.4, 1);
    this.root.add(this.sprite);
    this.createHealthBar();
  }

  createHealthBar() {
    this.healthBarTexture = createHealthBarTexture(1);
    const material = new THREE.SpriteMaterial({
      map: this.healthBarTexture,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.healthBar = new THREE.Sprite(material);
    this.healthBar.name = 'character-health-bar';
    this.healthBar.position.set(0, 2.76, 0);
    this.healthBar.scale.set(1.36, 0.16, 1);
    this.healthBar.renderOrder = 7;
    this.root.add(this.healthBar);
    this.updateHealthBar();
  }

  updateHealthBar() {
    if (!this.healthBar || !this.healthBarTexture) return;
    const ratio = clamp(this.health / 100, 0, 1);
    const metrics = updateHealthBarTexture(this.healthBarTexture, ratio);
    this.healthBar.userData.health = this.health;
    this.healthBar.userData.ratio = ratio;
    this.healthBar.userData.fillPixels = metrics.fillPixels;
    this.healthBar.userData.fillCapacity = metrics.fillCapacity;
    this.healthBar.userData.fillBounds = metrics.fillBounds;
    this.healthBar.visible = this.root.visible;
  }

  setWeaponModel(type) {
    const definition = WEAPONS[type] ?? WEAPONS.knives;
    this.sprite.userData.weapon = definition.id;
    this.setFighterState(this.fighterState, true);
    const presentationScale = fighterPresentationScale(definition.id);
    this.sprite.scale.set(1.6 * presentationScale, 2.4 * presentationScale, 1);
  }

  setFighterState(state, force = false) {
    const normalizedState = normalizeFighterState(state);
    if (!force && normalizedState === this.fighterState) return false;
    this.fighterState = normalizedState;
    this.sprite.userData.state = normalizedState;
    this.spriteTexture = fighterTexture(this.weaponType, normalizedState);
    this.spriteMaterial.map = this.spriteTexture;
    this.spriteMaterial.needsUpdate = true;
    return true;
  }

  updateFighterState() {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const state = selectFighterState({
      dead: this.dead,
      flashHit: this.flashHit,
      attackTime: this.attackTime,
      speed,
    });
    this.setFighterState(state);
    return state;
  }

  reset(position, yaw, difficulty = 1) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.airTime = 0;
    this.lastShotAt = -Infinity;
    this.sightTime = 0;
    this.lostSightTime = 0;
    this.targetPickup = null;
    this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 0.7 + Math.random();
    this.jumpCooldown = 0;
    this.stuckTime = 0;
    this.lastPosition.copy(position);
    this.aimDirection.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.aimError.set(0, 0, 0);
    this.errorTimer = 0;
    this.recoil = 0;
    this.difficulty = clamp(difficulty, 0.65, 1.35);
    this.flashHit = 0;
    this.root.visible = true;
    this.root.rotation.set(0, yaw, 0);
    this.attackTime = 0;
    this.equip('knives');
    this.setFighterState('idle', true);
    this.updateHealthBar();
  }

  equip(type) {
    this.weaponType = type in WEAPONS ? type : 'knives';
    this.ammo = WEAPONS[this.weaponType].ammo;
    this.reserve = WEAPONS[this.weaponType].reserve;
    this.reloading = false;
    this.lastShotAt = -Infinity;
    this.setWeaponModel(this.weaponType);
  }

  get definition() {
    return WEAPONS[this.weaponType];
  }

  getEyePosition(target = new THREE.Vector3()) {
    return target.copy(this.position).add(new THREE.Vector3(0, 1.72, 0));
  }

  getHeadCenter(target = new THREE.Vector3()) {
    return target
      .copy(this.position)
      .add(new THREE.Vector3(0, CHARACTER_HITBOX.head.offsetY, 0));
  }

  getBodyCenter(target = new THREE.Vector3()) {
    return target
      .copy(this.position)
      .add(new THREE.Vector3(0, CHARACTER_HITBOX.body.offsetY, 0));
  }

  getMuzzlePosition(target = new THREE.Vector3()) {
    return target
      .copy(this.position)
      .add(new THREE.Vector3(0, 1.35, 0))
      .addScaledVector(this.aimDirection, 0.72);
  }

  damage(amount) {
    if (this.dead) return 0;
    const applied = Math.min(this.health, Math.max(0, amount));
    this.health -= applied;
    this.flashHit = 0.1;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.root.visible = true;
      this.velocity.multiplyScalar(0.2);
    }
    this.updateFighterState();
    this.updateHealthBar();
    return applied;
  }

  choosePickup(pickups, playerPosition) {
    const active = pickups.filter((pickup) => pickup.active);
    if (!active.length) {
      this.targetPickup = null;
      return;
    }
    let best = null;
    let bestScore = Infinity;
    for (const pickup of active) {
      const distance = pickup.position.distanceTo(this.position);
      const playerDistance = pickup.position.distanceTo(playerPosition);
      const desirability =
        pickup.type === 'fireball' || pickup.type === 'greatsword'
          ? -3.5
          : pickup.type === 'ember'
            ? -1
            : 0;
      const score = distance + desirability + Math.max(0, 4 - playerDistance) * 0.5;
      if (score < bestScore) {
        best = pickup;
        bestScore = score;
      }
    }
    this.targetPickup = best;
  }

  getNavigationTarget(target) {
    const origin = this.getBodyCenter(new THREE.Vector3());
    const destination = target.clone();
    destination.y += 0.8;
    if (this.arena.hasLineOfSight(origin, destination, 0.2)) return target;

    let bestNode = null;
    let bestScore = Infinity;
    for (const node of this.arena.navNodes) {
      const nodeEye = node.position.clone().add(new THREE.Vector3(0, 0.8, 0));
      if (!this.arena.hasLineOfSight(origin, nodeEye, 0.2)) continue;
      const progress = node.position.distanceTo(target);
      const travel = node.position.distanceTo(this.position);
      const score = progress + travel * 0.32;
      if (score < bestScore) {
        bestNode = node.position;
        bestScore = score;
      }
    }
    return bestNode ?? target;
  }

  update(delta, time, player, pickups, canAct = true) {
    const dt = Math.min(delta, 0.034);
    if (this.dead) return { fire: false, pickup: null };
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.repathTimer -= dt;
    this.strafeTimer -= dt;
    this.errorTimer -= dt;
    this.recoil = damp(this.recoil, 0, 12, dt);

    const eye = this.getEyePosition(TEMP_A);
    const playerEye = TEMP_B
      .copy(player.position)
      .add(new THREE.Vector3(0, player.cameraHeight * 0.96, 0));
    const toPlayer = TEMP_C.copy(playerEye).sub(eye);
    const playerDistance = toPlayer.length();
    const hasSight =
      !player.dead &&
      playerDistance < 75 &&
      this.arena.hasLineOfSight(eye, playerEye, 0.22);

    if (hasSight) {
      this.sightTime += dt;
      this.lostSightTime = 0;
    } else {
      this.sightTime = Math.max(0, this.sightTime - dt * 0.7);
      this.lostSightTime += dt;
    }

    const needsWeapon =
      this.definition.usesAmmo !== false && (
        this.ammo <= Math.max(2, Math.floor(this.definition.ammo * 0.12)) ||
        (this.weaponType === 'knives' && this.ammo <= 2)
      );
    if (
      this.repathTimer <= 0 ||
      (this.targetPickup && !this.targetPickup.active)
    ) {
      if (needsWeapon || (this.weaponType === 'knives' && Math.random() > 0.35)) {
        this.choosePickup(pickups, player.position);
      } else {
        this.targetPickup = null;
      }
      this.repathTimer = 0.35 + Math.random() * 0.35;
    }

    if (this.strafeTimer <= 0) {
      this.strafeDirection *= Math.random() > 0.25 ? -1 : 1;
      this.strafeTimer = 0.55 + Math.random() * 1.1;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    let desiredYaw = this.yaw;
    let target = null;

    if (this.targetPickup?.active) {
      target = this.targetPickup.position;
      const navigationTarget = this.getNavigationTarget(target);
      const direction = navigationTarget.clone().sub(this.position);
      direction.y = 0;
      if (direction.lengthSq() > 0.01) {
        direction.normalize();
        wish.copy(direction);
        desiredYaw = Math.atan2(-direction.x, -direction.z);
      }
    } else if (hasSight) {
      const horizontal = toPlayer.clone();
      horizontal.y = 0;
      const distance = horizontal.length();
      if (distance > 0.01) horizontal.normalize();
      desiredYaw = Math.atan2(-horizontal.x, -horizontal.z);
      const idealDistance =
        this.weaponType === 'greatsword'
          ? 2.1
          : this.weaponType === 'ember'
          ? 7
          : this.weaponType === 'fireball'
            ? 11
            : this.weaponType === 'longbow' || this.weaponType === 'crossbow'
              ? 18
              : 12;
      const forwardAmount = clamp((distance - idealDistance) / 3, -1, 1);
      wish
        .addScaledVector(horizontal, forwardAmount)
        .addScaledVector(right, this.strafeDirection * (0.72 + this.difficulty * 0.12));
      if (wish.lengthSq() > 1) wish.normalize();
    } else {
      const node = this.arena.findNearestNavNode(player.position);
      target = node?.position ?? player.position;
      const navigationTarget = this.getNavigationTarget(target);
      const direction = navigationTarget.clone().sub(this.position);
      direction.y = 0;
      if (direction.lengthSq() > 0.01) {
        direction.normalize();
        wish.copy(direction);
        desiredYaw = Math.atan2(-direction.x, -direction.z);
      }
    }

    const turnRate = (hasSight ? 5.8 : 4.1) * this.difficulty;
    this.yaw += clamp(angleDifference(this.yaw, desiredYaw), -turnRate * dt, turnRate * dt);
    const speed = this.targetPickup ? 7.15 : hasSight ? 6.3 : 6.8;
    const targetX = canAct ? wish.x * speed : 0;
    const targetZ = canAct ? wish.z * speed : 0;
    const acceleration = this.grounded ? 25 : 6.5;
    this.velocity.x = moveToward(this.velocity.x, targetX, acceleration * dt);
    this.velocity.z = moveToward(this.velocity.z, targetZ, acceleration * dt);
    this.velocity.y -= 22 * dt;

    const moved = this.position.distanceToSquared(this.lastPosition);
    if (wish.lengthSq() > 0.1 && moved < 0.0005) this.stuckTime += dt;
    else this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    this.lastPosition.copy(this.position);
    const wall = this.arena.getWallContact(this.position, 0.43, 1.8);
    if (
      canAct &&
      this.grounded &&
      this.jumpCooldown <= 0 &&
      (this.stuckTime > 0.24 || (wall && wish.dot(wall.normal) < -0.35))
    ) {
      this.velocity.y = 7.3;
      this.grounded = false;
      this.jumpCooldown = 0.85;
      this.stuckTime = 0;
    }

    this.arena.moveBody(this, dt, {
      radius: 0.43,
      height: 1.84,
      stepHeight: 0.48,
    });
    if (this.grounded) this.airTime = 0;
    else this.airTime += dt;

    let collected = null;
    for (const pickup of pickups) {
      if (
        pickup.active &&
        pickup.position.distanceToSquared(this.position) < 1.35 * 1.35
      ) {
        this.equip(pickup.type);
        collected = pickup;
        this.targetPickup = null;
        break;
      }
    }

    let fire = false;
    if (
      canAct &&
      hasSight &&
      !player.dead &&
      (this.definition.usesAmmo === false || this.ammo > 0)
    ) {
      if (this.errorTimer <= 0) {
        const errorScale =
          (0.075 - this.difficulty * 0.025) *
          (this.sightTime < 0.5 ? 1.65 : 1) *
          (this.weaponType === 'ember' ? 1.25 : 1);
        this.aimError.set(
          (Math.random() - 0.5) * errorScale,
          (Math.random() - 0.5) * errorScale * 0.75,
          (Math.random() - 0.5) * errorScale,
        );
        this.errorTimer = 0.18 + Math.random() * 0.24;
      }
      const prediction = player.velocity.clone().multiplyScalar(
        this.definition.projectile
          ? playerDistance / this.definition.projectileSpeed
          : 0.035 + playerDistance * 0.0015,
      );
      const desiredAim = playerEye
        .clone()
        .add(prediction)
        .sub(eye)
        .normalize()
        .add(this.aimError)
        .normalize();
      this.aimDirection.lerp(desiredAim, 1 - Math.exp(-dt * (5.5 + this.difficulty * 3.2))).normalize();
      const aimAgreement = this.aimDirection.dot(desiredAim);
      const reactionDelay = 0.52 - this.difficulty * 0.17;
      const interval = this.definition.interval * (1.08 + (1.2 - this.difficulty) * 0.32);
      if (
        this.sightTime > reactionDelay &&
        aimAgreement > 0.992 &&
        time - this.lastShotAt >= interval
      ) {
        this.lastShotAt = time;
        if (this.definition.usesAmmo !== false) this.ammo -= 1;
        this.recoil = Math.min(1.8, this.recoil + this.definition.recoil);
        this.attackTime = ATTACK_MOTION[this.weaponType]?.duration ?? 0.2;
        fire = true;
      }
    } else {
      const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.aimDirection.lerp(facing, 1 - Math.exp(-dt * 4)).normalize();
    }

    if (this.position.y < -8) {
      this.damage(999);
    }
    this.animate(dt, wish, hasSight);
    return { fire, pickup: collected };
  }

  animate(delta, wish, aiming) {
    const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    this.animTime += dt;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const motion = clamp(speed / 6, 0, 1);
    const phase = this.animTime * (5.5 + speed * 0.6);
    const horizontalAim = Math.hypot(this.aimDirection.x, this.aimDirection.z);
    this.pitch = Math.atan2(this.aimDirection.y, Math.max(0.001, horizontalAim));
    const fighterState = this.updateFighterState();
    const attack = ATTACK_MOTION[this.weaponType] ?? ATTACK_MOTION.knives;
    const attackAmount = fighterState === 'attack' && this.attackTime > 0
      ? Math.sin((this.attackTime / attack.duration) * Math.PI)
      : 0;
    const walking = fighterState === 'walk';
    const bob = walking ? Math.abs(Math.sin(phase)) * 0.025 * motion : 0;
    const stride = walking ? Math.sin(phase) * 0.025 * motion : 0;
    this.sprite.position.set(
      stride + attack.x * attackAmount,
      0.015 + bob + attack.y * attackAmount,
      0,
    );
    const scale = fighterPresentationScale(this.weaponType) * (1 + attack.scale * attackAmount);
    this.sprite.scale.set(1.6 * scale, 2.4 * scale, 1);
    this.sprite.material.rotation = attack.rotate * attackAmount + stride * 0.4;
    this.spriteMaterial.color.setHex(this.flashHit > 0 ? 0xffc2b2 : 0xffffff);
    this.flashHit = Math.max(0, this.flashHit - dt);
    this.attackTime = Math.max(0, this.attackTime - dt);
    this.updateHealthBar();
    this.root.updateMatrixWorld(true);
  }
}
