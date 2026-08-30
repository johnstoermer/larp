import * as THREE from 'three';
import {
  WAR_CLASSES,
  WAR_COMBATANT_COUNT,
  normalizeWarClass,
} from '../../shared/warConfig.js';
import { fighterTextureUrl } from './BotController.js';
import {
  HEALTH_BAR_COLORS,
  createHealthBarTexture,
  updateHealthBarTexture,
} from './healthBar.js';
import { loadPhotoTexture } from './photoTexture.js';

export const WAR_RENDER_POOL_SIZE = WAR_COMBATANT_COUNT - 1;
export const WAR_RENDER_DISTANCE = 190;
export const WAR_HEALTH_BAR_DISTANCE = 58;
export const WAR_FULL_ANIMATION_DISTANCE = 72;
export const WAR_HEALTH_BAR_MIN_DISTANCE = 4;
export const WAR_HEALTH_BAR_FRONT_CLEARANCE = 0.25;

const textureCache = new Map();

function fighterTexture(classId, state) {
  const key = `${classId}:${state}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, loadPhotoTexture(fighterTextureUrl(classId, state)));
  }
  return textureCache.get(key);
}

function statePosition(state) {
  return state.position ?? [0, 0, 0];
}

export function selectWarRenderStates(
  states,
  cameraPosition,
  {
    localId = null,
    capacity = WAR_RENDER_POOL_SIZE,
    renderDistance = WAR_RENDER_DISTANCE,
  } = {},
) {
  const limitSquared = renderDistance * renderDistance;
  const cameraX = Number(cameraPosition?.x) || 0;
  const cameraY = Number(cameraPosition?.y) || 0;
  const cameraZ = Number(cameraPosition?.z) || 0;
  return states
    .filter((state) => state && state.id !== localId)
    .map((state) => {
      const position = statePosition(state);
      const dx = (Number(position[0]) || 0) - cameraX;
      const dy = (Number(position[1]) || 0) - cameraY;
      const dz = (Number(position[2]) || 0) - cameraZ;
      return { state, distanceSquared: dx * dx + dy * dy + dz * dz };
    })
    .filter((candidate) => candidate.distanceSquared <= limitSquared)
    .sort((first, second) =>
      first.distanceSquared - second.distanceSquared ||
      String(first.state.id).localeCompare(String(second.state.id)))
    .slice(0, capacity)
    .map((candidate) => candidate.state);
}

export function warFighterState(state, timing = {}, now = performance.now()) {
  if (state.dead) return 'death';
  if ((timing.hitUntil ?? 0) > now) return 'hit';
  if ((timing.attackUntil ?? 0) > now) return 'attack';
  const velocity = state.velocity ?? [0, 0, 0];
  return Math.hypot(Number(velocity[0]) || 0, Number(velocity[2]) || 0) > 0.35
    ? 'walk'
    : 'idle';
}

function createRenderSlot(index) {
  const root = new THREE.Group();
  root.name = `war-fighter-pool-${index}`;
  root.visible = false;

  const spriteMaterial = new THREE.SpriteMaterial({
    map: fighterTexture('shortbow', 'idle'),
    transparent: true,
    alphaTest: 0.055,
    depthWrite: true,
    depthTest: true,
    fog: true,
    toneMapped: true,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.name = 'war-photographic-fighter';
  sprite.center.set(0.5, 0.015);
  sprite.position.y = 0.015;
  sprite.scale.set(1.65, 2.5, 1);
  root.add(sprite);

  const healthTexture = createHealthBarTexture(1, HEALTH_BAR_COLORS.enemy);
  const healthMaterial = new THREE.SpriteMaterial({
    map: healthTexture,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const healthBar = new THREE.Sprite(healthMaterial);
  healthBar.name = 'war-character-health-bar';
  healthBar.position.set(0, 2.82, 0);
  healthBar.scale.set(1.36, 0.16, 1);
  healthBar.renderOrder = 7;
  root.add(healthBar);

  return {
    id: null,
    root,
    sprite,
    spriteMaterial,
    healthBar,
    healthTexture,
    healthRatio: 1,
    healthFill: HEALTH_BAR_COLORS.enemy,
    classId: 'shortbow',
    fighterState: 'idle',
    target: new THREE.Vector3(),
  };
}

export class WarCrowd {
  constructor(scene, {
    capacity = WAR_RENDER_POOL_SIZE,
    renderDistance = WAR_RENDER_DISTANCE,
  } = {}) {
    this.scene = scene;
    this.capacity = Math.max(1, Math.floor(capacity));
    this.renderDistance = Math.max(1, Number(renderDistance) || WAR_RENDER_DISTANCE);
    this.localId = null;
    this.localTeam = null;
    this.root = new THREE.Group();
    this.root.name = 'war-lightweight-fighter-pool';
    this.scene.add(this.root);
    this.slots = Array.from({ length: this.capacity }, (_, index) => {
      const slot = createRenderSlot(index);
      this.root.add(slot.root);
      return slot;
    });
    this.states = new Map();
    this.timing = new Map();
    this.slotById = new Map();
    this.visibleCount = 0;
    this.cameraForward = new THREE.Vector3();
    this.healthDirection = new THREE.Vector3();
  }

  applySnapshot(combatants = [], receivedAt = performance.now()) {
    const nextIds = new Set();
    for (const state of combatants) {
      if (!state || state.id == null || !Array.isArray(state.position)) continue;
      nextIds.add(state.id);
      const previous = this.states.get(state.id);
      const timing = this.timing.get(state.id) ?? { attackUntil: 0, hitUntil: 0 };
      if (previous && Number(state.health) < Number(previous.health)) {
        timing.hitUntil = receivedAt + 150;
      }
      if (previous && state.attackSequence !== previous.attackSequence) {
        timing.attackUntil = receivedAt + 260;
      }
      this.timing.set(state.id, timing);
      this.states.set(state.id, state);
    }
    for (const id of this.states.keys()) {
      if (nextIds.has(id)) continue;
      this.states.delete(id);
      this.timing.delete(id);
      this.releaseId(id);
    }
  }

  releaseId(id) {
    const slot = this.slotById.get(id);
    if (!slot) return;
    slot.id = null;
    slot.root.visible = false;
    this.slotById.delete(id);
  }

  assignSlot(id) {
    const existing = this.slotById.get(id);
    if (existing) return existing;
    const slot = this.slots.find((candidate) => candidate.id == null);
    if (!slot) return null;
    slot.id = id;
    slot.root.visible = false;
    this.slotById.set(id, slot);
    return slot;
  }

  update(camera, delta, now = performance.now()) {
    const selected = selectWarRenderStates(
      [...this.states.values()],
      camera?.position ?? camera,
      {
        localId: this.localId,
        capacity: this.capacity,
        renderDistance: this.renderDistance,
      },
    );
    const selectedIds = new Set(selected.map((state) => state.id));
    for (const id of this.slotById.keys()) {
      if (!selectedIds.has(id)) this.releaseId(id);
    }

    const smoothing = 1 - Math.exp(-Math.max(0, delta) * 13);
    const cameraPosition = camera?.position ?? camera;
    const checkCameraFacing = typeof camera?.getWorldDirection === 'function';
    if (checkCameraFacing) camera.getWorldDirection(this.cameraForward);
    for (const state of selected) {
      const slot = this.assignSlot(state.id);
      if (!slot) continue;
      const position = statePosition(state);
      slot.target.fromArray(position);
      if (!slot.root.visible || slot.root.position.distanceToSquared(slot.target) > 144) {
        slot.root.position.copy(slot.target);
      } else {
        slot.root.position.lerp(slot.target, smoothing);
      }
      slot.root.visible = true;

      const classId = normalizeWarClass(state.classId ?? state.weapon);
      const distanceSquared = slot.target.distanceToSquared(cameraPosition);
      const fullAnimation = distanceSquared <= WAR_FULL_ANIMATION_DISTANCE ** 2;
      const velocity = state.velocity ?? [0, 0, 0];
      const visualState = fullAnimation
        ? warFighterState(state, this.timing.get(state.id), now)
        : state.dead
          ? 'death'
          : Math.hypot(Number(velocity[0]) || 0, Number(velocity[2]) || 0) > 0.35
            ? 'walk'
            : 'idle';
      if (slot.classId !== classId || slot.fighterState !== visualState) {
        slot.classId = classId;
        slot.fighterState = visualState;
        slot.spriteMaterial.map = fighterTexture(classId, visualState);
        slot.spriteMaterial.needsUpdate = true;
        slot.sprite.userData.classId = classId;
        slot.sprite.userData.state = visualState;
      }
      const definition = WAR_CLASSES[classId];
      const maxHealth = Math.max(1, Number(state.maxHealth) || definition.health);
      const ratio = Math.max(0, Math.min(1, Number(state.health) / maxHealth || 0));
      const relationship = this.localTeam != null &&
        Number(state.team) === Number(this.localTeam)
        ? 'ally'
        : 'enemy';
      const healthFill = HEALTH_BAR_COLORS[relationship];
      const metrics = ratio === slot.healthRatio && healthFill === slot.healthFill
        ? slot.healthTexture.userData
        : updateHealthBarTexture(slot.healthTexture, ratio, healthFill);
      slot.healthRatio = ratio;
      slot.healthFill = healthFill;
      slot.healthBar.userData.ratio = ratio;
      slot.healthBar.userData.relationship = relationship;
      slot.healthBar.userData.fill = healthFill;
      slot.healthBar.userData.fillPixels = metrics.fillPixels;
      slot.healthBar.userData.fillCapacity = metrics.fillCapacity;
      this.healthDirection.copy(slot.target);
      this.healthDirection.y += 1.4;
      const healthInFront = !checkCameraFacing || this.healthDirection
        .sub(cameraPosition)
        .dot(this.cameraForward) > WAR_HEALTH_BAR_FRONT_CLEARANCE;
      slot.healthBar.visible =
        !state.dead &&
        healthInFront &&
        distanceSquared >= WAR_HEALTH_BAR_MIN_DISTANCE ** 2 &&
        distanceSquared <= WAR_HEALTH_BAR_DISTANCE ** 2;
      slot.spriteMaterial.color.setHex(state.team === 0 ? 0xffeeee : 0xeef2ff);
    }
    this.visibleCount = selected.length;
    return this.visibleCount;
  }

  clear() {
    this.states.clear();
    this.timing.clear();
    for (const slot of this.slots) {
      slot.id = null;
      slot.root.visible = false;
    }
    this.slotById.clear();
    this.visibleCount = 0;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const slot of this.slots) {
      slot.spriteMaterial.dispose();
      slot.healthBar.material.dispose();
      slot.healthTexture.dispose();
    }
  }
}
