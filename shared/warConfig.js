import { WAR_EAST_SOUTH_SECTOR } from './warEastSouthSector.js';
import { rotatedFootprintBounds } from './warSceneryGeometry.js';
import { WAR_WEST_SECTOR } from './warWestSector.js';

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

const LEGACY_COVER_EXCLUSIONS = new Set([5, 7, 11, 13]);
const LEGACY_PHOTO_REPLACEMENTS = new Map([
  [0, Object.freeze({
    id: 'west-inner-foam-barricade',
    asset: '/assets/larp/war/foam-barricade.webp',
    position: Object.freeze([-19, 0, 0]),
    width: 8.7,
    height: 3.4,
    yaw: Math.PI / 2,
    visibleBottomRatio: 0.046,
    alphaTest: 0.08,
  })],
  [1, Object.freeze({
    id: 'east-inner-foam-barricade',
    asset: '/assets/larp/war/foam-barricade.webp',
    position: Object.freeze([19, 0, 0]),
    width: 8.7,
    height: 3.4,
    yaw: Math.PI / 2,
    visibleBottomRatio: 0.046,
    alphaTest: 0.08,
  })],
  [2, Object.freeze({
    id: 'north-center-supply-hut',
    asset: '/assets/larp/war/supply-hut.webp',
    position: Object.freeze([0, 0, -24]),
    width: 12,
    height: 7,
    yaw: 0,
    visibleBottomRatio: 0.03,
    alphaTest: 0.08,
  })],
  [3, Object.freeze({
    id: 'south-center-supply-hut',
    asset: '/assets/larp/war/supply-hut.webp',
    position: Object.freeze([0, 0, 24]),
    width: 12,
    height: 7,
    yaw: Math.PI,
    visibleBottomRatio: 0.03,
    alphaTest: 0.08,
  })],
  [8, Object.freeze({
    id: 'west-field-watchtower',
    asset: '/assets/larp/war/watchtower.webp',
    position: Object.freeze([-62.5, 0, 0]),
    width: 20,
    height: 12,
    yaw: Math.PI / 2,
    visibleBottomRatio: 0.013,
    alphaTest: 0.1,
  })],
  [9, Object.freeze({
    id: 'east-field-watchtower',
    asset: '/assets/larp/war/watchtower.webp',
    position: Object.freeze([62.5, 0, 0]),
    width: 20,
    height: 12,
    yaw: Math.PI / 2,
    visibleBottomRatio: 0.013,
    alphaTest: 0.1,
  })],
]);

export const WAR_LEGACY_COVER = Object.freeze(mirroredCover
  .map((bounds, index) => ({ bounds, index }))
  .filter(({ index }) => !LEGACY_COVER_EXCLUSIONS.has(index))
  .map(({ bounds, index }) => Object.freeze({
    id: `legacy-cover-${index}`,
    bounds: Object.freeze(bounds),
    material: index % 3 === 0 ? 'paleTimber' : 'timber',
    photoReplacementId: LEGACY_PHOTO_REPLACEMENTS.get(index)?.id ?? null,
  })));

export const WAR_GENERATED_PHOTO_PROPS = Object.freeze(
  [...LEGACY_PHOTO_REPLACEMENTS.entries()]
    .filter(([index]) => !LEGACY_COVER_EXCLUSIONS.has(index))
    .map(([index, replacement]) => {
      const collisionBounds = Object.freeze([...mirroredCover[index]]);
      return Object.freeze({
        ...replacement,
        type: replacement.id,
        fixedPlane: true,
        presentation: 'fixed-plane',
        solid: true,
        collisionBounds,
        replacesLegacyCoverIndex: index,
      });
    }),
);

function roadsidePhotoProp({
  id,
  asset,
  position,
  width,
  height,
  depth,
  yaw = 0,
  visibleBottomRatio = 0,
  collisionHeight = height * 0.68,
  alphaTest = 0.035,
}) {
  return Object.freeze({
    id,
    type: id,
    asset,
    position: Object.freeze(position),
    width,
    height,
    yaw,
    visibleBottomRatio,
    alphaTest,
    fixedPlane: true,
    presentation: 'fixed-plane',
    solid: true,
    collisionBounds: Object.freeze(rotatedFootprintBounds(
      position,
      width,
      depth,
      collisionHeight,
      yaw,
    )),
  });
}

export const WAR_ROADSIDE_PHOTO_PROPS = Object.freeze([
  roadsidePhotoProp({
    id: 'north-road-cart', asset: '/assets/larp/props/wooden-cart.webp',
    position: [-10.5, 0, -50], width: 5.3, height: 3.55, depth: 2.2,
    yaw: 0.18, visibleBottomRatio: 105 / 512, collisionHeight: 1.9,
  }),
  roadsidePhotoProp({
    id: 'north-road-hay', asset: '/assets/larp/props/hay-bales.webp',
    position: [11.5, 0, -57], width: 5.5, height: 2.2, depth: 2.2,
    yaw: -0.22, visibleBottomRatio: 68 / 512, collisionHeight: 1.45,
  }),
  roadsidePhotoProp({
    id: 'north-road-target', asset: '/assets/larp/props/archery-target.webp',
    position: [-12, 0, -37], width: 2.4, height: 2.85, depth: 0.65,
    yaw: Math.PI * 0.1, visibleBottomRatio: 15 / 640, collisionHeight: 2.15,
  }),
  roadsidePhotoProp({
    id: 'north-spawn-camp', asset: '/assets/larp/props/canvas-tent.webp',
    position: [44, 0, -88], width: 4.8, height: 3.2, depth: 3.2,
    yaw: -0.32, visibleBottomRatio: 11 / 427, collisionHeight: 2.35,
  }),
  roadsidePhotoProp({
    id: 'north-road-barricade', asset: '/assets/larp/war/foam-barricade.webp',
    position: [0, 0, -43], width: 8.7, height: 3.4, depth: 2.8,
    visibleBottomRatio: 0.046, collisionHeight: 2.4, alphaTest: 0.08,
  }),
  roadsidePhotoProp({
    id: 'south-road-cart', asset: '/assets/larp/props/wooden-cart.webp',
    position: [10.5, 0, 50], width: 5.3, height: 3.55, depth: 2.2,
    yaw: Math.PI + 0.18, visibleBottomRatio: 105 / 512, collisionHeight: 1.9,
  }),
  roadsidePhotoProp({
    id: 'central-south-road-hay', asset: '/assets/larp/props/hay-bales.webp',
    position: [-11.5, 0, 57], width: 5.5, height: 2.2, depth: 2.2,
    yaw: Math.PI - 0.22, visibleBottomRatio: 68 / 512, collisionHeight: 1.45,
  }),
  roadsidePhotoProp({
    id: 'south-road-target', asset: '/assets/larp/props/archery-target.webp',
    position: [12, 0, 37], width: 2.4, height: 2.85, depth: 0.65,
    yaw: Math.PI * 1.1, visibleBottomRatio: 15 / 640, collisionHeight: 2.15,
  }),
  roadsidePhotoProp({
    id: 'south-spawn-camp', asset: '/assets/larp/props/canvas-tent.webp',
    position: [44, 0, 88], width: 4.8, height: 3.2, depth: 3.2,
    yaw: Math.PI - 0.32, visibleBottomRatio: 11 / 427, collisionHeight: 2.35,
  }),
  roadsidePhotoProp({
    id: 'central-south-road-barricade', asset: '/assets/larp/war/foam-barricade.webp',
    position: [0, 0, 43], width: 8.7, height: 3.4, depth: 2.8,
    yaw: Math.PI, visibleBottomRatio: 0.046, collisionHeight: 2.4, alphaTest: 0.08,
  }),
]);

// Near-field vegetation is rotationally mirrored between deployments. It is
// deliberately non-solid, like the rest of War foliage, and sits beyond the
// front spawn row so it breaks the empty horizon without trapping forty-body
// formations or adding hidden authority obstacles.
export const WAR_APPROACH_FOLIAGE = Object.freeze([
  Object.freeze({
    id: 'south-approach-tree-west', type: 'tree',
    asset: '/assets/larp/war/tree.webp', position: Object.freeze([-30, 0, 52]),
    width: 8.5, height: 11, yaw: 0.18, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'south-approach-tree-east', type: 'tree',
    asset: '/assets/larp/war/tree.webp', position: Object.freeze([30, 0, 52]),
    width: 8.5, height: 11, yaw: 0.62, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'north-approach-tree-east', type: 'tree',
    asset: '/assets/larp/war/tree.webp', position: Object.freeze([30, 0, -52]),
    width: 8.5, height: 11, yaw: 0.18, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'north-approach-tree-west', type: 'tree',
    asset: '/assets/larp/war/tree.webp', position: Object.freeze([-30, 0, -52]),
    width: 8.5, height: 11, yaw: 0.62, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'south-approach-bush-east', type: 'bush',
    asset: '/assets/larp/war/bush.webp', position: Object.freeze([16, 0, 56]),
    width: 5.5, height: 3.4, yaw: 0.24, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'north-approach-bush-west', type: 'bush',
    asset: '/assets/larp/war/bush.webp', position: Object.freeze([-16, 0, -56]),
    width: 5.5, height: 3.4, yaw: 0.24, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'south-approach-bush-west', type: 'bush',
    asset: '/assets/larp/war/bush.webp', position: Object.freeze([-10, 0, 48]),
    width: 5.5, height: 3.4, yaw: 0.71, fixedCrossedPlane: true,
  }),
  Object.freeze({
    id: 'north-approach-bush-east', type: 'bush',
    asset: '/assets/larp/war/bush.webp', position: Object.freeze([10, 0, -48]),
    width: 5.5, height: 3.4, yaw: 0.71, fixedCrossedPlane: true,
  }),
]);

const sectorFoliage = [
  ...WAR_WEST_SECTOR.foliage,
  ...WAR_EAST_SOUTH_SECTOR.foliage,
  ...WAR_APPROACH_FOLIAGE,
];
let treeVariantIndex = 0;
export const WAR_FOLIAGE = Object.freeze(sectorFoliage.map((item) => {
  if (item.type !== 'tree') return item;
  treeVariantIndex += 1;
  if (treeVariantIndex % 3 !== 0) return item;
  return Object.freeze({
    ...item,
    type: 'damaged-tree',
    asset: '/assets/larp/war/damaged-tree.webp',
    visibleBottomRatio: 0.0365,
  });
}));

export const WAR_SECTORS = Object.freeze([
  WAR_WEST_SECTOR,
  WAR_EAST_SOUTH_SECTOR,
]);

const WAR_STRUCTURE_PARTS = Object.freeze(WAR_SECTORS.flatMap(
  (sector) => sector.structureParts,
));
const WAR_SURFACES = Object.freeze(WAR_SECTORS.flatMap(
  (sector) => sector.surfaces,
));
const WAR_PHOTO_PROPS = Object.freeze([
  ...WAR_SECTORS.flatMap((sector) => sector.photoProps),
  ...WAR_GENERATED_PHOTO_PROPS,
  ...WAR_ROADSIDE_PHOTO_PROPS,
]);
const WAR_LANDMARKS = Object.freeze(WAR_SECTORS.flatMap(
  (sector) => sector.landmarks,
));
const WAR_NAVIGATION = Object.freeze({
  sectors: Object.freeze(WAR_SECTORS.map((sector) => sector.navigation)),
  nodes: Object.freeze(WAR_SECTORS.flatMap((sector) => sector.navigation.nodes ?? [])),
  edges: Object.freeze(WAR_SECTORS.flatMap((sector) => sector.navigation.edges ?? [])),
  routes: Object.freeze(WAR_SECTORS.flatMap((sector) => sector.navigation.routes ?? [])),
});

const WAR_BOUNDARY_COLLIDERS = Object.freeze([
  Object.freeze([-120, -1.1, -100, 120, 0, 100]),
  Object.freeze([-121, 0, -101, -120, 7, 101]),
  Object.freeze([120, 0, -101, 121, 7, 101]),
  Object.freeze([-121, 0, -101, 121, 7, -100]),
  Object.freeze([-121, 0, 100, 121, 7, 101]),
]);

export const WAR_MAP = Object.freeze({
  id: 'war-field',
  bounds: Object.freeze({ x: 120, z: 100 }),
  objective: Object.freeze({ position: Object.freeze([0, 0.02, 0]), radius: 12 }),
  spawns: Object.freeze([warSpawnForSlot(0, 0), warSpawnForSlot(1, 0)]),
  yaws: Object.freeze([warSpawnYaw(0), warSpawnYaw(1)]),
  pickups: Object.freeze([]),
  sectors: WAR_SECTORS,
  landmarks: WAR_LANDMARKS,
  legacyCover: WAR_LEGACY_COVER,
  structureParts: WAR_STRUCTURE_PARTS,
  surfaces: WAR_SURFACES,
  photoProps: WAR_PHOTO_PROPS,
  navigation: WAR_NAVIGATION,
  boundaryColliders: WAR_BOUNDARY_COLLIDERS,
  colliders: Object.freeze([
    ...WAR_BOUNDARY_COLLIDERS,
    ...WAR_LEGACY_COVER.map((entry) => entry.bounds),
    ...WAR_SECTORS.flatMap((sector) => sector.colliders),
    ...WAR_ROADSIDE_PHOTO_PROPS.map((entry) => entry.collisionBounds),
  ]),
  foliage: WAR_FOLIAGE,
});
