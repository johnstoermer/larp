import * as THREE from 'three';
import { createPickupPedestal, createWeaponModel, WEAPONS } from './weapons.js';

export class PickupManager {
  constructor(scene, camera = null) {
    this.scene = scene;
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'weapon-pickups';
    this.scene.add(this.root);
    this.pickups = [];
    this.lightAccumulator = 0;
  }

  clear() {
    for (const pickup of this.pickups) pickup.beaconMaterial.dispose();
    for (const child of [...this.root.children]) this.root.remove(child);
    this.pickups.length = 0;
  }

  reset(slots, loadout) {
    this.clear();
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const preferredIndex = slot.preferred ? loadout.indexOf(slot.preferred) : -1;
      const type =
        preferredIndex >= 0
          ? slot.preferred
          : loadout[index % loadout.length];
      const definition = WEAPONS[type];
      const group = new THREE.Group();
      group.position.copy(slot.position);
      group.name = `pickup-${type}`;
      const pedestal = createPickupPedestal(definition.accent);
      group.add(pedestal);

      const modelRoot = new THREE.Group();
      modelRoot.position.y = 1.02;
      modelRoot.rotation.set(0.08, Math.PI * 0.25 * index, 0.12);
      const model = createWeaponModel(type);
      model.rotation.y = Math.PI / 2;
      const longWeapon = ['carbine', 'burst', 'rail', 'rocket', 'scatter'].includes(type);
      model.scale.setScalar(longWeapon ? 0.58 : 0.75);
      modelRoot.add(model);
      group.add(modelRoot);

      const beaconMaterial = new THREE.MeshBasicMaterial({
        color: definition.accent,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.42, 2.4, 8, 1, true),
        beaconMaterial,
      );
      beacon.position.y = 1.35;
      group.add(beacon);
      this.root.add(group);

      this.pickups.push({
        type,
        definition,
        position: slot.position.clone(),
        group,
        pedestal,
        light: pedestal.userData.light,
        modelRoot,
        beacon,
        beaconMaterial,
        active: true,
        phase: index * 1.37,
      });
    }
    this.root.updateMatrixWorld(true);
    return this.pickups;
  }

  collect(pickup) {
    if (!pickup?.active) return false;
    pickup.active = false;
    pickup.group.visible = false;
    return true;
  }

  findPlayerContact(position, radius = 1.25) {
    let closest = null;
    let bestDistance = radius * radius;
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      const distance = pickup.position.distanceToSquared(position);
      if (distance < bestDistance) {
        closest = pickup;
        bestDistance = distance;
      }
    }
    return closest;
  }

  update(time, delta) {
    this.lightAccumulator += delta;
    if (this.lightAccumulator >= 0.2) {
      this.lightAccumulator = 0;
      const nearest = this.camera
        ? this.pickups
            .filter((pickup) => pickup.active)
            .map((pickup) => ({
              pickup,
              distance: pickup.position.distanceToSquared(this.camera.position),
            }))
            .sort((first, second) => first.distance - second.distance)
            .slice(0, 2)
            .map((entry) => entry.pickup)
        : [];
      for (const pickup of this.pickups) {
        pickup.light.visible = pickup.active && nearest.includes(pickup);
      }
    }
    for (const pickup of this.pickups) {
      if (!pickup.active) continue;
      pickup.modelRoot.rotation.y += delta * 0.72;
      pickup.modelRoot.position.y =
        1.03 + Math.sin(time * 2.1 + pickup.phase) * 0.09;
      pickup.modelRoot.rotation.z =
        Math.sin(time * 1.4 + pickup.phase) * 0.06;
      pickup.pedestal.userData.ring.rotation.z += delta * 0.55;
      pickup.light.intensity =
        1.5 + Math.sin(time * 2.8 + pickup.phase) * 0.28;
      pickup.beaconMaterial.opacity =
        0.12 + Math.sin(time * 2.1 + pickup.phase) * 0.035;
      pickup.beacon.rotation.y -= delta * 0.22;
    }
  }
}
