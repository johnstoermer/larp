import * as THREE from 'three';
import { seededRandom, shuffle } from './math.js';
import { loadPhotoTexture } from './photoTexture.js';

export const WEAPONS = Object.freeze({
  knives: {
    id: 'knives', asset: 'throwing-knives', name: 'THROWING KNIVES', shortName: 'KNIVES',
    ammo: 5, reserve: 20, reloadMs: 900, damage: 28, headMultiplier: 1.55,
    interval: 0.42, spread: 0.02, focusSpread: 0.008, pellets: 1, range: 24,
    recoil: 0.42, automatic: false, projectile: false, fireMode: 'THROW / FOAM',
    accent: 0xd6c7a2, casing: 0xd6c7a2, sound: 'knives',
  },
  shortbow: {
    id: 'shortbow', asset: 'shortbow', name: 'ASHWOOD SHORTBOW', shortName: 'SHORTBOW',
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    viewmodelFrames: Object.freeze({ reload: 0 }),
    damage: 24, headMultiplier: 1.6,
    interval: 0.46, spread: 0.022, focusSpread: 0.006, pellets: 1, range: 72,
    recoil: 0.34, automatic: false, projectile: false, fireMode: 'HOLD + RELEASE / ARROW',
    accent: 0xc89d57, casing: 0xc89d57, sound: 'shortbow',
  },
  ember: {
    id: 'ember', asset: 'ember-gauntlet', name: 'EMBER GAUNTLET', shortName: 'EMBER',
    ammo: 6, reserve: 24, reloadMs: 1800, damage: 15, headMultiplier: 1.2,
    interval: 0.72, spread: 0.082, focusSpread: 0.058, pellets: 5, range: 28,
    recoil: 0.86, automatic: false, projectile: false, fireMode: 'CONE / EMBER',
    accent: 0xf26d2f, casing: 0xf26d2f, sound: 'ember',
  },
  crossbow: {
    id: 'crossbow', asset: 'crossbow', name: 'OAKEN CROSSBOW', shortName: 'CROSSBOW',
    ammo: 1, reserve: 15, reloadMs: 1200, damage: 66, headMultiplier: 1.55,
    interval: 1.16, spread: 0.006, focusSpread: 0.0018, pellets: 1, range: 112,
    recoil: 0.82, automatic: false, projectile: false, fireMode: 'SINGLE / BOLT',
    accent: 0x9f6f3e, casing: 0x9f6f3e, sound: 'crossbow',
  },
  lightning: {
    id: 'lightning', asset: 'lightning-wand', name: 'STORM WAND', shortName: 'STORM WAND',
    ammo: 8, reserve: 32, reloadMs: 1650, damage: 20, headMultiplier: 1.35,
    interval: 0.16, spread: 0.016, focusSpread: 0.006, pellets: 1, range: 86,
    recoil: 0.38, automatic: true, projectile: false, fireMode: 'CHANNEL / LIGHTNING',
    accent: 0x71c9ff, casing: 0x71c9ff, sound: 'lightning',
  },
  longbow: {
    id: 'longbow', asset: 'longbow', name: 'YEW LONGBOW', shortName: 'LONGBOW',
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    viewmodelFrames: Object.freeze({ reload: 0 }),
    damage: 54, headMultiplier: 1.75,
    interval: 0.98, spread: 0.009, focusSpread: 0.002, pellets: 1, range: 126,
    recoil: 0.66, automatic: false, projectile: false, fireMode: 'HOLD + RELEASE / ARROW',
    accent: 0xb88d50, casing: 0xb88d50, sound: 'longbow',
  },
  greatsword: {
    id: 'greatsword', asset: 'greatsword', name: 'EVA GREATSWORD', shortName: 'GREATSWORD',
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    viewmodelFrames: Object.freeze({ fire: 6, reload: 0 }),
    damage: 78, headMultiplier: 1,
    interval: 0.82, spread: 0.06, focusSpread: 0.04, pellets: 1, range: 3.55,
    recoil: 1.18, automatic: false, projectile: false, fireMode: 'SWING / FOAM',
    accent: 0xd9dde0, casing: 0xd9dde0, sound: 'greatsword',
  },
  fireball: {
    id: 'fireball', asset: 'fireball-tome', name: 'FIREBALL TOME', shortName: 'FIREBALL',
    ammo: 3, reserve: 9, reloadMs: 2400, damage: 86, headMultiplier: 1,
    interval: 0.96, spread: 0.004, focusSpread: 0.002, pellets: 1, range: 90,
    recoil: 1.28, automatic: false, projectile: true, projectileSpeed: 25,
    splashRadius: 5.6, fireMode: 'CAST / FIREBALL', accent: 0xff6a2f,
    casing: 0xff6a2f, sound: 'fireball',
  },
});

const PICKUP_POOL = ['shortbow', 'ember', 'crossbow', 'lightning', 'longbow', 'greatsword', 'fireball'];

export function getArenaLoadout(seed, count = 7) {
  return shuffle(PICKUP_POOL, seededRandom(seed)).slice(0, count);
}

const pickupTextures = new Map();

function pickupTexture(type) {
  if (!pickupTextures.has(type)) {
    const definition = WEAPONS[type] ?? WEAPONS.knives;
    pickupTextures.set(type, loadPhotoTexture(`/assets/larp/pickups/${definition.asset}.webp`));
  }
  return pickupTextures.get(type);
}

export function createWeaponModel(type) {
  const definition = WEAPONS[type] ?? WEAPONS.knives;
  const group = new THREE.Group();
  group.name = `${definition.id}-individual-photo-pickup`;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pickupTexture(definition.id),
    transparent: true,
    alphaTest: 0.035,
    depthWrite: true,
    depthTest: true,
    fog: true,
    toneMapped: true,
  }));
  sprite.name = `${definition.asset}-photo`;
  const portrait = ['shortbow', 'longbow', 'greatsword', 'lightning', 'knives'].includes(type);
  sprite.scale.set(portrait ? 0.95 : 1.72, portrait ? 1.55 : 1.12, 1);
  group.add(sprite);

  const muzzle = new THREE.Object3D();
  muzzle.name = 'cast-origin';
  muzzle.position.set(0, 0.08, -0.78);
  group.add(muzzle);
  group.userData.definition = definition;
  group.userData.muzzle = muzzle;
  group.userData.casingPort = muzzle;
  return group;
}

export function createPickupPedestal(accent = 0xe8b65c) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.88, 0.18, 8),
    new THREE.MeshStandardMaterial({
      map: loadPhotoTexture('/assets/larp/materials/cobblestone.webp', { repeatX: 2, repeatY: 2 }),
      color: 0xb9af9c,
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    }),
  );
  base.position.y = 0.09;
  base.receiveShadow = true;
  group.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.035, 5, 24),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.76,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);

  const light = new THREE.PointLight(accent, 1.35, 4.5, 2);
  light.position.y = 0.72;
  group.add(light);
  group.userData.ring = ring;
  group.userData.light = light;
  return group;
}
