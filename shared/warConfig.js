export const WAR_TEAM_SIZE = 40;
export const WAR_TEAM_COUNT = 2;
export const WAR_COMBATANT_COUNT = WAR_TEAM_SIZE * WAR_TEAM_COUNT;

export const WAR_RULES = Object.freeze({
  unlockMs: 15_000,
  captureMs: 8_000,
  scorePerSecond: 1,
  scoreToWin: 100,
  overtimeThreshold: 99,
  overtimeGraceMs: 500,
  respawnMs: 8_000,
  botTickRate: 10,
  snapshotRate: 10,
  reconnectMs: 20_000,
  destroyAfterMs: 45_000,
});

export const WAR_CLASSES = Object.freeze({
  knives: Object.freeze({
    id: 'knives',
    name: 'Throwing Knives',
    weapon: 'knives',
    health: 110,
    speed: 7,
    attackMs: 1_000,
    damage: 16,
    headMultiplier: 1.55,
    spread: 0.02,
    focusSpread: 0.008,
    pellets: 1,
    range: 24,
    ammo: 1,
    reserve: 0,
    reloadMs: 0,
    usesAmmo: false,
  }),
  shortbow: Object.freeze({
    id: 'shortbow',
    name: 'Shortbow',
    weapon: 'shortbow',
    health: 90,
    speed: 7,
    attackMs: 460,
    damage: 24,
    headMultiplier: 1.6,
    spread: 0.022,
    focusSpread: 0.006,
    pellets: 1,
    range: 72,
    ammo: 1,
    reserve: 0,
    reloadMs: 0,
    usesAmmo: false,
  }),
  ember: Object.freeze({
    id: 'ember',
    name: 'Ember Gauntlet',
    weapon: 'ember',
    health: 135,
    speed: 5.7,
    attackMs: 720,
    damage: 15,
    headMultiplier: 1.2,
    spread: 0.082,
    focusSpread: 0.058,
    range: 28,
    pellets: 5,
    ammo: 6,
    reserve: 24,
    reloadMs: 1_800,
    usesAmmo: true,
  }),
  crossbow: Object.freeze({
    id: 'crossbow',
    name: 'Crossbow',
    weapon: 'crossbow',
    health: 105,
    speed: 5.8,
    attackMs: 1_160,
    damage: 66,
    headMultiplier: 1.55,
    spread: 0.006,
    focusSpread: 0.0018,
    pellets: 1,
    range: 112,
    ammo: 1,
    reserve: 15,
    reloadMs: 1_200,
    usesAmmo: true,
  }),
  greatsword: Object.freeze({
    id: 'greatsword',
    name: 'Greatsword',
    weapon: 'greatsword',
    health: 160,
    speed: 5.2,
    attackMs: 820,
    damage: 78,
    headMultiplier: 1,
    spread: 0.06,
    focusSpread: 0.04,
    pellets: 1,
    range: 3.55,
    ammo: 1,
    reserve: 0,
    reloadMs: 0,
    usesAmmo: false,
  }),
  lightning: Object.freeze({
    id: 'lightning',
    name: 'Lightning',
    weapon: 'lightning',
    health: 115,
    speed: 6,
    attackMs: 160,
    damage: 20,
    headMultiplier: 1.35,
    spread: 0.016,
    focusSpread: 0.006,
    pellets: 1,
    range: 86,
    ammo: 8,
    reserve: 32,
    reloadMs: 1_650,
    usesAmmo: true,
  }),
  longbow: Object.freeze({
    id: 'longbow',
    name: 'Longbow',
    weapon: 'longbow',
    health: 85,
    speed: 6,
    attackMs: 980,
    damage: 54,
    headMultiplier: 1.75,
    spread: 0.009,
    focusSpread: 0.002,
    pellets: 1,
    range: 126,
    ammo: 1,
    reserve: 0,
    reloadMs: 0,
    usesAmmo: false,
  }),
  fireball: Object.freeze({
    id: 'fireball',
    name: 'Fireball Tome',
    weapon: 'fireball',
    health: 100,
    speed: 5.6,
    attackMs: 960,
    damage: 86,
    headMultiplier: 1,
    spread: 0.004,
    focusSpread: 0.002,
    pellets: 1,
    range: 90,
    ammo: 3,
    reserve: 9,
    reloadMs: 2_400,
    usesAmmo: true,
    projectile: true,
    projectileSpeed: 25,
    splashRadius: 5.6,
  }),
});

export const WAR_CLASS_IDS = Object.freeze(Object.keys(WAR_CLASSES));

export function normalizeWarClass(value) {
  const id = String(value ?? '').toLowerCase();
  return WAR_CLASSES[id] ? id : WAR_CLASS_IDS[0];
}

export function warSpawnForSlot(team, slot) {
  const safeTeam = team === 1 ? 1 : 0;
  const safeSlot = Math.max(0, Math.min(WAR_TEAM_SIZE - 1, Math.floor(slot) || 0));
  const column = safeSlot % 8;
  const row = Math.floor(safeSlot / 8);
  const x = -31.5 + column * 9;
  const homeZ = safeTeam === 0 ? 84 : -84;
  const inward = safeTeam === 0 ? -1 : 1;
  return [x, 0.02, homeZ + inward * row * 4.5];
}

export function warSpawnYaw(team) {
  return team === 1 ? Math.PI : 0;
}

const mirroredCover = [
  [-22, 0, -4, -16, 3.6, 4],
  [16, 0, -4, 22, 3.6, 4],
  [-5, 0, -27, 5, 3.2, -21],
  [-5, 0, 21, 5, 3.2, 27],
  [-40, 0, -30, -32, 4.2, -22],
  [32, 0, 22, 40, 4.2, 30],
  [-40, 0, 22, -32, 4.2, 30],
  [32, 0, -30, 40, 4.2, -22],
  [-67, 0, -6, -58, 3.8, 6],
  [58, 0, -6, 67, 3.8, 6],
  [-76, 0, -51, -66, 4.5, -41],
  [66, 0, 41, 76, 4.5, 51],
  [-76, 0, 41, -66, 4.5, 51],
  [66, 0, -51, 76, 4.5, -41],
];

export const WAR_FOLIAGE = Object.freeze([
  [-104, -78, 'tree'], [-82, -72, 'tree'], [-55, -82, 'tree'],
  [55, -82, 'tree'], [82, -72, 'tree'], [104, -78, 'tree'],
  [-108, -34, 'tree'], [108, -34, 'tree'], [-108, 34, 'tree'], [108, 34, 'tree'],
  [-104, 78, 'tree'], [-82, 72, 'tree'], [-55, 82, 'tree'],
  [55, 82, 'tree'], [82, 72, 'tree'], [104, 78, 'tree'],
  [-92, -55, 'bush'], [-70, -52, 'bush'], [70, -52, 'bush'], [92, -55, 'bush'],
  [-90, -18, 'bush'], [90, -18, 'bush'], [-90, 18, 'bush'], [90, 18, 'bush'],
  [-92, 55, 'bush'], [-70, 52, 'bush'], [70, 52, 'bush'], [92, 55, 'bush'],
].map(([x, z, type], index) => Object.freeze({
  id: `${type}-${index}`,
  type,
  asset: `/assets/larp/war/${type}.webp`,
  position: Object.freeze([x, 0, z]),
  width: type === 'tree' ? 8.5 : 5.5,
  height: type === 'tree' ? 11 : 3.4,
})));

export const WAR_MAP = Object.freeze({
  id: 'war-field',
  bounds: Object.freeze({ x: 120, z: 100 }),
  objective: Object.freeze({ position: Object.freeze([0, 0.02, 0]), radius: 12 }),
  spawns: Object.freeze([warSpawnForSlot(0, 0), warSpawnForSlot(1, 0)]),
  yaws: Object.freeze([warSpawnYaw(0), warSpawnYaw(1)]),
  pickups: Object.freeze([]),
  colliders: Object.freeze([
    Object.freeze([-120, -1.1, -100, 120, 0, 100]),
    Object.freeze([-121, 0, -101, -120, 7, 101]),
    Object.freeze([120, 0, -101, 121, 7, 101]),
    Object.freeze([-121, 0, -101, 121, 7, -100]),
    Object.freeze([-121, 0, 100, 121, 7, 101]),
    ...mirroredCover.map((bounds) => Object.freeze(bounds)),
  ]),
  foliage: WAR_FOLIAGE,
});
