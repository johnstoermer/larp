export const PROTOCOL_VERSION = 3;
export const SERVER_TICK_RATE = 30;
export const SNAPSHOT_RATE = 30;

export const MATCH_RULES = Object.freeze({
  roundsToWin: 4,
  takesToWin: 2,
  roundIntroMs: 2650,
  countdownMs: 3150,
  takeMs: 45_000,
  takeEndMs: 2150,
  roundEndMs: 2750,
  loadTimeoutMs: 12_000,
  reconnectMs: 20_000,
  overtimeIntervalMs: 550,
  overtimeDamage: 5,
});

export const WEAPONS = Object.freeze({
  knives: {
    ammo: 5, reserve: 20, reloadMs: 900, damage: 28, headMultiplier: 1.55,
    interval: 0.42, spread: 0.02, focusSpread: 0.008, pellets: 1,
    range: 24, projectile: false,
  },
  shortbow: {
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    damage: 24, headMultiplier: 1.6,
    interval: 0.46, spread: 0.022, focusSpread: 0.006, pellets: 1,
    range: 72, projectile: false,
  },
  ember: {
    ammo: 6, reserve: 24, reloadMs: 1800, damage: 15, headMultiplier: 1.2,
    interval: 0.72, spread: 0.082, focusSpread: 0.058, pellets: 5,
    range: 28, projectile: false,
  },
  crossbow: {
    ammo: 1, reserve: 15, reloadMs: 1200, damage: 66, headMultiplier: 1.55,
    interval: 1.16, spread: 0.006, focusSpread: 0.0018, pellets: 1,
    range: 112, projectile: false,
  },
  lightning: {
    ammo: 8, reserve: 32, reloadMs: 1650, damage: 20, headMultiplier: 1.35,
    interval: 0.16, spread: 0.016, focusSpread: 0.006, pellets: 1,
    range: 86, projectile: false,
  },
  longbow: {
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    damage: 54, headMultiplier: 1.75,
    interval: 0.98, spread: 0.009, focusSpread: 0.002, pellets: 1,
    range: 126, projectile: false,
  },
  greatsword: {
    ammo: 1, reserve: 0, reloadMs: 0, usesAmmo: false,
    damage: 78, headMultiplier: 1,
    interval: 0.82, spread: 0.06, focusSpread: 0.04, pellets: 1,
    range: 3.55, projectile: false,
  },
  fireball: {
    ammo: 3, reserve: 9, reloadMs: 2400, damage: 86, headMultiplier: 1,
    interval: 0.96, spread: 0.004, focusSpread: 0.002, pellets: 1,
    range: 90, projectile: true, projectileSpeed: 25, splashRadius: 5.6,
  },
});

const PICKUP_POOL = ['shortbow', 'ember', 'crossbow', 'lightning', 'longbow', 'greatsword', 'fireball'];

// One compact, mirrored two-home arena. Three lanes, short spawn-to-action time,
// readable landmark cover, and equivalent routes for both sides follow the
// competitive flow players expect from classic small-team multiplayer maps.
export const MAPS = Object.freeze([
  {
    id: 'battle-village',
    bounds: 22,
    spawns: [
      [0, 0.02, 16],
      [0, 0.02, -16],
    ],
    yaws: [0, Math.PI],
    pickups: [
      [-8.8, 0, -0.4, 'ember'],
      [8.8, 0, 0.4, 'lightning'],
      [-14.2, 0, -6.3, 'crossbow'],
      [14.2, 0, 6.3, 'longbow'],
      [-3.8, 0, 0, 'greatsword'],
      [3.8, 0, 0, 'fireball'],
      [0, 0, 9.6, 'shortbow'],
    ],
    colliders: [
      [-22, -1.1, -18, 22, 0, 18],
      [-22, 0, -18.5, 22, 6, -17.5],
      [-22, 0, 17.5, 22, 6, 18.5],
      [-22.5, 0, -18, -21.5, 6, 18],
      [21.5, 0, -18, 22.5, 6, 18],

      [-6.25, 0, -15, -5.75, 5.5, -7.5],
      [5.75, 0, -15, 6.25, 5.5, -7.5],
      [-6, 0, -15.25, -1.2, 5.5, -14.75],
      [1.2, 0, -15.25, 6, 5.5, -14.75],
      [-6, 0, -7.75, -1.2, 5.5, -7.25],
      [1.2, 0, -7.75, 6, 5.5, -7.25],
      [-5.75, 2.75, -14.75, -1.5, 3.05, -7.75],
      [1.5, 2.75, -14.75, 5.75, 3.05, -7.75],

      [-6.25, 0, 7.5, -5.75, 5.5, 15],
      [5.75, 0, 7.5, 6.25, 5.5, 15],
      [-6, 0, 7.25, -1.2, 5.5, 7.75],
      [1.2, 0, 7.25, 6, 5.5, 7.75],
      [-6, 0, 14.75, -1.2, 5.5, 15.25],
      [1.2, 0, 14.75, 6, 5.5, 15.25],
      [-5.75, 2.75, 7.75, -1.5, 3.05, 14.75],
      [1.5, 2.75, 7.75, 5.75, 3.05, 14.75],

      [-2, 0, -1.2, 2, 1.9, 1.2],
      [-7.1, 0, -3.7, -4.1, 1.45, -1.5],
      [4.1, 0, 1.5, 7.1, 1.45, 3.7],
      [-16.2, 0, -2.9, -11.6, 1.8, -1.7],
      [11.6, 0, 1.7, 16.2, 1.8, 2.9],
      [-18.3, 0, -11.1, -15.1, 2.35, -7.5],
      [15.1, 0, 7.5, 18.3, 2.35, 11.1],
      [-15.7, 0, 7.1, -14.1, 2.15, 8.1],
      [14.1, 0, -8.1, 15.7, 2.15, -7.1],
    ],
  },
]);

export const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function createMapOrder(seed) {
  const random = seededRandom(seed);
  const indices = MAPS.map((_, index) => index);
  const order = shuffle(indices, random);
  while (order.length < 9) order.push(...shuffle(indices, random));
  return order;
}

export function getArenaLoadout(seed, count = 7) {
  return shuffle(PICKUP_POOL, seededRandom(seed)).slice(0, count);
}

export function createPickupState(mapIndex, seed) {
  const map = MAPS[mapIndex];
  const loadout = getArenaLoadout(seed, map.pickups.length);
  return map.pickups.map((slot, index) => {
    const preferredIndex = slot[3] ? loadout.indexOf(slot[3]) : -1;
    return {
      id: index,
      type: preferredIndex >= 0 ? slot[3] : loadout[index % loadout.length],
      position: slot.slice(0, 3),
      active: true,
    };
  });
}

export function sanitizeName(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
  return normalized || 'ROOKIE';
}
