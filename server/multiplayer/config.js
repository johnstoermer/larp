export const PROTOCOL_VERSION = 2;
export const SERVER_TICK_RATE = 30;
export const SNAPSHOT_RATE = 20;

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
  sidearm: {
    ammo: 15,
    reserve: 60,
    reloadMs: 1450,
    damage: 24,
    headMultiplier: 1.7,
    interval: 0.24,
    spread: 0.008,
    focusSpread: 0.003,
    pellets: 1,
    range: 82,
    projectile: false,
  },
  machine: {
    ammo: 30,
    reserve: 90,
    reloadMs: 1720,
    damage: 12,
    headMultiplier: 1.55,
    interval: 0.078,
    spread: 0.027,
    focusSpread: 0.012,
    pellets: 1,
    range: 58,
    projectile: false,
  },
  scatter: {
    ammo: 6,
    reserve: 30,
    reloadMs: 2150,
    damage: 12,
    headMultiplier: 1.28,
    interval: 0.74,
    spread: 0.094,
    focusSpread: 0.068,
    pellets: 9,
    range: 38,
    projectile: false,
  },
  carbine: {
    ammo: 14,
    reserve: 56,
    reloadMs: 1850,
    damage: 29,
    headMultiplier: 1.75,
    interval: 0.19,
    spread: 0.011,
    focusSpread: 0.0035,
    pellets: 1,
    range: 105,
    projectile: false,
  },
  burst: {
    ammo: 24,
    reserve: 72,
    reloadMs: 1780,
    damage: 18,
    headMultiplier: 1.6,
    interval: 0.115,
    spread: 0.018,
    focusSpread: 0.007,
    pellets: 1,
    range: 92,
    projectile: false,
  },
  revolver: {
    ammo: 6,
    reserve: 30,
    reloadMs: 2050,
    damage: 47,
    headMultiplier: 1.85,
    interval: 0.43,
    spread: 0.014,
    focusSpread: 0.003,
    pellets: 1,
    range: 96,
    projectile: false,
  },
  rail: {
    ammo: 3,
    reserve: 12,
    reloadMs: 2420,
    damage: 82,
    headMultiplier: 1.25,
    interval: 1.08,
    spread: 0.0018,
    focusSpread: 0.0004,
    pellets: 1,
    range: 150,
    projectile: false,
  },
  rocket: {
    ammo: 3,
    reserve: 9,
    reloadMs: 2650,
    damage: 86,
    headMultiplier: 1,
    interval: 0.92,
    spread: 0.004,
    focusSpread: 0.002,
    pellets: 1,
    range: 90,
    projectile: true,
    projectileSpeed: 26,
    splashRadius: 5.8,
  },
});

const PICKUP_POOL = [
  'machine',
  'scatter',
  'carbine',
  'burst',
  'revolver',
  'rail',
  'rocket',
];

export const MAPS = Object.freeze([
  {
    id: 'sinter',
    bounds: 21,
    spawns: [
      [-14, 0.02, 13.4],
      [14, 0.02, -13.4],
    ],
    yaws: [-0.81, 2.33],
    pickups: [
      [-7.2, 0, 0.8, 'scatter'],
      [7.2, 0, -0.8, 'machine'],
      [0, 4.6, 10.8, 'rail'],
      [-14.3, 0, 7.1, 'rocket'],
      [14.3, 0, -7.1, 'carbine'],
      [0, 0, -10.8, 'revolver'],
    ],
    colliders: [
      [-20, -1.1, -17, 20, 0, 17],
      [-20, 0, -17.5, 20, 5.4, -16.5],
      [-20, 0, 16.5, 20, 5.4, 17.5],
      [-20.5, 0, -17.5, -19.5, 5.4, 17.5],
      [19.5, 0, -17.5, 20.5, 5.4, 17.5],
      [-2.85, 0, -2.85, 2.85, 3.6, 2.85],
      [-2.25, 3.6, -2.25, 2.25, 4.2, 2.25],
      [-14.3, 0, -7.8, -6.7, 2.7, -4.8],
      [7, 0, 4.9, 13.8, 2.5, 8.1],
      [-13.4, 0, 4.7, -10.6, 2.7, 8.7],
      [11, 0, -8.45, 14.2, 2.4, -4.95],
      [-7.8, 0, 10.3, -4.8, 1.7, 12.5],
      [5.15, 0, -12.3, 8.45, 1.6, -10.1],
      [-17.03, 0.02, -12.03, -15.97, 1.08, -10.97],
      [-15.88, 0.02, -12.03, -14.82, 1.08, -10.97],
      [-16.45, 1.12, -12.03, -15.39, 2.18, -10.97],
      [13.97, 0.02, 10.87, 15.03, 1.08, 11.93],
      [13.97, 0.02, 12.02, 15.03, 1.08, 13.08],
      [13.97, 1.12, 11.45, 15.03, 2.18, 12.51],
      [-7, 4.175, 9.65, 7, 4.525, 11.95],
      [-8.475, 0, 9.675, -7.825, 0.43, 11.925],
      [-7.855, 0, 9.675, -7.205, 0.86, 11.925],
      [-7.235, 0, 9.675, -6.585, 1.29, 11.925],
      [-6.615, 0, 9.675, -5.965, 1.72, 11.925],
      [-5.995, 0, 9.675, -5.345, 2.15, 11.925],
      [-5.375, 0, 9.675, -4.725, 2.58, 11.925],
      [-4.755, 0, 9.675, -4.105, 3.01, 11.925],
      [-4.135, 0, 9.675, -3.485, 3.44, 11.925],
      [-3.515, 0, 9.675, -2.865, 3.87, 11.925],
      [-2.895, 0, 9.675, -2.245, 4.3, 11.925],
      [7.825, 0, 9.675, 8.475, 0.43, 11.925],
      [7.205, 0, 9.675, 7.855, 0.86, 11.925],
      [6.585, 0, 9.675, 7.235, 1.29, 11.925],
      [5.965, 0, 9.675, 6.615, 1.72, 11.925],
      [5.345, 0, 9.675, 5.995, 2.15, 11.925],
      [4.725, 0, 9.675, 5.375, 2.58, 11.925],
      [4.105, 0, 9.675, 4.755, 3.01, 11.925],
      [3.485, 0, 9.675, 4.135, 3.44, 11.925],
      [2.865, 0, 9.675, 3.515, 3.87, 11.925],
      [2.245, 0, 9.675, 2.895, 4.3, 11.925],
    ],
  },
  {
    id: 'flood',
    bounds: 21,
    spawns: [
      [-14, 0.02, -12.6],
      [14, 0.02, 12.6],
    ],
    yaws: [-2.3, 0.84],
    pickups: [
      [-10, 0.92, 0, 'machine'],
      [10, 0.92, 0, 'scatter'],
      [0, 0, -4.8, 'rail'],
      [0, 0, 4.8, 'rocket'],
      [-16.5, 0, 0, 'carbine'],
      [16.5, 0, 0, 'revolver'],
    ],
    colliders: [
      [-20, -1.2, -16, 20, 0, 16],
      [-20, 0, -16.6, 20, 6.8, -15.4],
      [-20, 0, 15.4, 20, 6.8, 16.6],
      [-20.6, 0, -16, -19.4, 6.8, 16],
      [19.4, 0, -16, 20.6, 6.8, 16],
      [-12.5, 0, -3.9, -7.1, 0.9, 3.9],
      [7.1, 0, -3.9, 12.5, 0.9, 3.9],
      [-3.1, 0, -10.4, 3.1, 2.8, -7],
      [-2.5, 0, 7.2, 2.5, 3.8, 10.2],
      [-16.8, 0, -9.8, -13.4, 2.3, -6.6],
      [13.4, 0, 6.6, 16.8, 2.3, 9.8],
      [-16.85, 0, 7.5, -13.15, 2.1, 10.1],
      [13.15, 0, -10.1, 16.85, 2.1, -7.5],
      [-5.23, 0.02, -13.33, -4.17, 1.08, -12.27],
      [-4.08, 0.02, -13.33, -3.02, 1.08, -12.27],
      [2.97, 0.02, 11.07, 4.03, 1.08, 12.13],
      [2.97, 0.02, 12.22, 4.03, 1.08, 13.28],
      [2.97, 1.12, 11.65, 4.03, 2.18, 12.71],
    ],
  },
  {
    id: 'glass',
    bounds: 20,
    spawns: [
      [-12, 0.02, 12],
      [12, 0.02, -12],
    ],
    yaws: [-0.79, 2.36],
    pickups: [
      [-6.1, 0, -0.3, 'scatter'],
      [6.1, 0, 0.3, 'machine'],
      [0, 0, -9.2, 'rail'],
      [0, 0, 9.2, 'rocket'],
      [-13.2, 0, 6.5, 'carbine'],
      [13.2, 0, -6.5, 'revolver'],
    ],
    colliders: [
      [-18, -1.1, -18, 18, 0, 18],
      [-18, 0, -18.4, 18, 4.8, -17.6],
      [-18, 0, 17.6, 18, 4.8, 18.4],
      [-18.4, 0, -18, -17.6, 4.8, 18],
      [17.6, 0, -18, 18.4, 4.8, 18],
      [-10.75, 0, -6.9, -6.25, 1.3, -4.1],
      [5.2, 0, 4.85, 10.4, 1.3, 7.55],
      [-9.4, 0, 6, -6.2, 1.3, 11],
      [7, 0, -10.7, 10.2, 1.3, -5.7],
      [-2.7, 0, -2.7, 2.7, 3.1, 2.7],
      [-2.95, 3.1, -2.95, 2.95, 3.26, 2.95],
      [-15.2, 0, -0.9, -11.8, 2.9, 2.9],
      [11.6, 0, -2.9, 15, 2.9, 0.9],
      [-14.83, 0.02, -13.23, -13.77, 1.08, -12.17],
      [-13.68, 0.02, -13.23, -12.62, 1.08, -12.17],
      [11.97, 0.02, 11.97, 13.03, 1.08, 13.03],
      [13.12, 0.02, 11.97, 14.18, 1.08, 13.03],
      [12.55, 1.12, 11.97, 13.61, 2.18, 13.03],
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
  const order = shuffle([0, 1, 2], random);
  while (order.length < 9) order.push(...shuffle([0, 1, 2], random));
  return order;
}

export function getArenaLoadout(seed, count = 6) {
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
