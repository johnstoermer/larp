import * as THREE from 'three';
import { clamp, damp } from './math.js';

const POSITION = new THREE.Vector3();
const VELOCITY = new THREE.Vector3();
const WISH = new THREE.Vector3();

function angleLerp(start, end, amount) {
  const difference = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + difference * amount;
}

export class RemotePlayer {
  constructor(controller) {
    this.controller = controller;
    this.snapshots = [];
    this.interpolationDelay = 100;
    this.visible = false;
    this.lastState = null;
    this.renderYaw = 0;
    this.renderPitch = 0;
    this.lastPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
  }

  clear() {
    this.snapshots.length = 0;
    this.lastState = null;
    this.visible = false;
    this.controller.root.visible = false;
  }

  reset(position, yaw, weapon = 'sidearm') {
    POSITION.fromArray(position);
    this.controller.reset(POSITION, yaw, 1);
    this.controller.equip(weapon);
    this.controller.root.visible = true;
    this.visible = true;
    this.renderYaw = yaw;
    this.renderPitch = 0;
    this.lastPosition.copy(POSITION);
    this.snapshots.length = 0;
  }

  push(state, receivedAt = performance.now()) {
    if (!state?.position || !state?.velocity) return;
    const snapshot = {
      at: receivedAt,
      state,
      position: new THREE.Vector3().fromArray(state.position),
      velocity: new THREE.Vector3().fromArray(state.velocity),
    };
    const teleport =
      this.lastState &&
      snapshot.position.distanceToSquared(this.lastPosition) > 36;
    if (!this.visible || teleport) {
      this.reset(state.position, state.yaw, state.weapon);
      snapshot.at = receivedAt - this.interpolationDelay;
    }
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 24) this.snapshots.shift();
    this.lastState = state;
  }

  setLatency(rtt) {
    this.interpolationDelay = clamp(65 + rtt * 0.55, 80, 145);
  }

  update(delta, now = performance.now()) {
    if (!this.visible || !this.snapshots.length) return;
    const renderAt = now - this.interpolationDelay;
    while (
      this.snapshots.length > 2 &&
      this.snapshots[1].at <= renderAt
    ) {
      this.snapshots.shift();
    }
    const first = this.snapshots[0];
    const second = this.snapshots[1] ?? first;
    let amount = 1;
    if (second.at > first.at) {
      amount = clamp((renderAt - first.at) / (second.at - first.at), 0, 1);
    }
    POSITION.lerpVectors(first.position, second.position, amount);
    VELOCITY.lerpVectors(first.velocity, second.velocity, amount);
    if (renderAt > second.at) {
      const extrapolation = Math.min(0.08, (renderAt - second.at) / 1000);
      POSITION.addScaledVector(VELOCITY, extrapolation);
    }
    this.renderYaw = angleLerp(first.state.yaw, second.state.yaw, amount);
    this.renderPitch =
      first.state.pitch + (second.state.pitch - first.state.pitch) * amount;
    this.controller.position.copy(POSITION);
    this.controller.velocity.copy(VELOCITY);
    this.controller.yaw = this.renderYaw;
    this.controller.health = second.state.health;
    this.controller.dead = second.state.dead;
    this.controller.grounded = second.state.grounded;
    if (this.controller.weaponType !== second.state.weapon) {
      this.controller.equip(second.state.weapon);
    }
    this.controller.ammo = second.state.ammo;
    this.controller.reserve = second.state.reserve ?? this.controller.reserve;
    this.controller.reloading = Boolean(second.state.reloading);
    const horizontal = Math.cos(this.renderPitch);
    this.controller.aimDirection.set(
      -Math.sin(this.renderYaw) * horizontal,
      Math.sin(this.renderPitch),
      -Math.cos(this.renderYaw) * horizontal,
    );
    WISH.copy(VELOCITY);
    WISH.y = 0;
    const aiming = !second.state.dead;
    this.controller.animate(delta, WISH, aiming);
    this.controller.root.visible = !second.state.dead;
    this.lastPosition.copy(POSITION);
    this.velocity.copy(VELOCITY);
  }

  applyImmediate(state) {
    if (!state) return;
    if (!this.visible) this.reset(state.position, state.yaw, state.weapon);
    this.controller.health = state.health;
    this.controller.dead = state.dead;
    this.controller.ammo = state.ammo;
    this.controller.reserve = state.reserve ?? this.controller.reserve;
    this.controller.reloading = Boolean(state.reloading);
    if (this.controller.weaponType !== state.weapon) {
      this.controller.equip(state.weapon);
    }
    if (state.dead) this.controller.root.visible = false;
  }

  reconcileVisual(delta) {
    if (!this.lastState) return;
    this.controller.recoil = damp(this.controller.recoil, 0, 14, delta);
  }
}
