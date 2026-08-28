import * as THREE from 'three';
import { clamp, damp, moveToward } from './math.js';
import { loadPhotoAtlas, photoAtlasCell } from './photoAtlas.js';
import { WEAPONS } from './weapons.js';

const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_C = new THREE.Vector3();
const characterAtlas = loadPhotoAtlas('./assets/cookout/grillmaster-frames.png');

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
    this.root.name = 'grillmaster';
    this.scene.add(this.root);
    this.position = this.root.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.airTime = 0;
    this.weaponType = 'sidearm';
    this.ammo = WEAPONS.sidearm.ammo;
    this.reserve = WEAPONS.sidearm.reserve;
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
    this.createModel();
    this.setWeaponModel('sidearm');
  }

  createModel() {
    this.spriteTexture = photoAtlasCell(characterAtlas, 0, 4);
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
    this.sprite.name = 'photographic-grillmaster-sprite';
    this.sprite.center.set(0.5, 0.015);
    this.sprite.position.y = 0.015;
    this.sprite.scale.set(1.55, 2.34, 1);
    this.root.add(this.sprite);
    this.currentFrame = -1;
  }

  setWeaponModel(type) {
    this.sprite.userData.weapon = type;
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
    this.equip('sidearm');
  }

  equip(type) {
    this.weaponType = type in WEAPONS ? type : 'sidearm';
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
    return target.copy(this.position).add(new THREE.Vector3(0, 1.78, 0));
  }

  getBodyCenter(target = new THREE.Vector3()) {
    return target.copy(this.position).add(new THREE.Vector3(0, 1.0, 0));
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
      this.root.visible = false;
      this.velocity.multiplyScalar(0.2);
    }
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
        pickup.type === 'rocket' || pickup.type === 'rail'
          ? -3.5
          : pickup.type === 'scatter'
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
    this.animTime += dt;
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.repathTimer -= dt;
    this.strafeTimer -= dt;
    this.errorTimer -= dt;
    this.flashHit = Math.max(0, this.flashHit - dt);
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
      this.ammo <= Math.max(2, Math.floor(this.definition.ammo * 0.12)) ||
      (this.weaponType === 'sidearm' && this.ammo <= 8);
    if (
      this.repathTimer <= 0 ||
      (this.targetPickup && !this.targetPickup.active)
    ) {
      if (needsWeapon || (this.weaponType === 'sidearm' && Math.random() > 0.35)) {
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
        this.weaponType === 'scatter'
          ? 7
          : this.weaponType === 'rocket'
            ? 11
            : this.weaponType === 'rail' || this.weaponType === 'carbine'
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
    if (canAct && hasSight && !player.dead && this.ammo > 0) {
      if (this.errorTimer <= 0) {
        const errorScale =
          (0.075 - this.difficulty * 0.025) *
          (this.sightTime < 0.5 ? 1.65 : 1) *
          (this.weaponType === 'scatter' ? 1.25 : 1);
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
        this.ammo -= 1;
        this.recoil = Math.min(1.8, this.recoil + this.definition.recoil);
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
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const motion = clamp(speed / 6, 0, 1);
    const phase = this.animTime * (5.5 + speed * 0.6);
    const horizontalAim = Math.hypot(this.aimDirection.x, this.aimDirection.z);
    this.pitch = Math.atan2(this.aimDirection.y, Math.max(0.001, horizontalAim));
    let frame = 0;
    if (this.flashHit > 0) frame = 3;
    else if (this.recoil > 0.12) frame = 2;
    else if (motion > 0.12) frame = Math.sin(phase) > 0 ? 1 : 0;
    if (frame !== this.currentFrame) {
      this.currentFrame = frame;
      this.spriteTexture.offset.x = frame * 0.25;
    }
    const bob = Math.abs(Math.sin(phase)) * 0.025 * motion;
    this.sprite.position.y = 0.015 + bob;
    this.spriteMaterial.color.setHex(this.flashHit > 0 ? 0xffc2b2 : 0xffffff);
    this.root.updateMatrixWorld(true);
  }
}
