// Dense west/north War-map content shared by rendering, authority, and bot
// navigation. North is negative Z. Every physical part is an axis-aligned box
// so the server and client can consume the same immutable bounds.

import { rotatedFootprintBounds } from './warSceneryGeometry.js';

const freezeVector = (values) => Object.freeze([...values]);

function boundsFromCenter(position, size) {
  return freezeVector([
    position[0] - size[0] / 2,
    position[1] - size[1] / 2,
    position[2] - size[2] / 2,
    position[0] + size[0] / 2,
    position[1] + size[1] / 2,
    position[2] + size[2] / 2,
  ]);
}

function part(id, landmarkId, position, size, material, {
  role = 'wall',
  solid = true,
  rotation = null,
} = {}) {
  const frozenPosition = freezeVector(position);
  const frozenSize = freezeVector(size);
  return Object.freeze({
    id,
    landmarkId,
    role,
    material,
    position: frozenPosition,
    size: frozenSize,
    rotation: rotation ? freezeVector(rotation) : null,
    solid,
    bounds: solid ? boundsFromCenter(frozenPosition, frozenSize) : null,
  });
}

function surface(id, position, size, material = 'dirt') {
  return Object.freeze({
    id,
    material,
    position: freezeVector(position),
    size: freezeVector(size),
  });
}

const PROP_SHAPES = Object.freeze({
  'wooden-cart': Object.freeze({ width: 5.3, height: 3.55, footprint: [4.8, 1.8] }),
  'hay-bales': Object.freeze({ width: 5.5, height: 2.2, footprint: [4.6, 1.6] }),
  'canvas-tent': Object.freeze({ width: 4.8, height: 3.2, footprint: [4, 2.6] }),
  'archery-target': Object.freeze({ width: 2.4, height: 2.85, footprint: [2.2, 0.5] }),
});

const PROP_VISIBLE_BOTTOM = Object.freeze({
  'wooden-cart': 105 / 512,
  'hay-bales': 68 / 512,
  'canvas-tent': 11 / 427,
  'archery-target': 15 / 640,
});

function photoProp(id, type, x, z, { yaw = 0, solid = true } = {}) {
  const shape = PROP_SHAPES[type];
  const collisionHeight = type === 'archery-target'
    ? 2.15
    : type === 'canvas-tent'
      ? 2.35
      : type === 'wooden-cart'
        ? 1.9
        : 1.45;
  const collisionBounds = solid
    ? freezeVector(rotatedFootprintBounds(
      [x, 0, z],
      shape.footprint[0],
      shape.footprint[1],
      collisionHeight,
      yaw,
    ))
    : null;
  return Object.freeze({
    id,
    type,
    asset: `/assets/larp/props/${type}.webp`,
    position: freezeVector([x, 0, z]),
    width: shape.width,
    height: shape.height,
    visibleBottomRatio: PROP_VISIBLE_BOTTOM[type],
    yaw,
    solid,
    collisionBounds,
  });
}

function foliage(id, type, x, z, scale = 1) {
  return Object.freeze({
    id,
    type,
    asset: `/assets/larp/war/${type}.webp`,
    position: freezeVector([x, 0, z]),
    width: (type === 'tree' ? 8.5 : 5.5) * scale,
    height: (type === 'tree' ? 11 : 3.4) * scale,
    fixedCrossedPlane: true,
  });
}

function navNode(id, x, z, tags = []) {
  return Object.freeze({
    id,
    position: freezeVector([x, 0.02, z]),
    clearance: 1.25,
    tags: Object.freeze([...tags]),
  });
}

function navEdge(from, to, tags = []) {
  return Object.freeze({
    from,
    to,
    bidirectional: true,
    tags: Object.freeze([...tags]),
  });
}

export const WAR_WEST_STRUCTURE_PARTS = Object.freeze([
  // Rook Watch: a broken manor-sized shell with two readable entrances.
  part('rook-watch-north-left', 'rook-watch', [-101, 2, -81], [10, 4, 1], 'darkTimber'),
  part('rook-watch-north-right', 'rook-watch', [-87, 1.6, -81], [8, 3.2, 1], 'timber'),
  part('rook-watch-west-wall', 'rook-watch', [-106, 2, -73], [1, 4, 16], 'darkTimber'),
  part('rook-watch-east-high', 'rook-watch', [-82, 1.7, -76], [1, 3.4, 8], 'timber'),
  part('rook-watch-east-low', 'rook-watch', [-82, 1.2, -68], [1, 2.4, 4], 'timber'),
  part('rook-watch-south-left', 'rook-watch', [-102, 1.25, -65], [8, 2.5, 1], 'paleTimber'),
  part('rook-watch-south-right', 'rook-watch', [-86.5, 1.25, -65], [7, 2.5, 1], 'paleTimber'),
  part('rook-watch-fallen-roof', 'rook-watch', [-94, 0.85, -74], [8, 0.25, 6], 'roof', {
    role: 'debris', solid: false, rotation: [0.08, 0.18, -0.12],
  }),

  // The northern barn creates short indoor sightlines without sealing itself.
  part('north-barn-north-left', 'north-barn', [-72.5, 1.8, -80], [7, 3.6, 1], 'timber'),
  part('north-barn-north-right', 'north-barn', [-63.5, 1.8, -80], [5, 3.6, 1], 'timber'),
  part('north-barn-west', 'north-barn', [-76, 1.8, -73], [1, 3.6, 14], 'darkTimber'),
  part('north-barn-east-north', 'north-barn', [-61, 1.55, -77], [1, 3.1, 6], 'timber'),
  part('north-barn-east-south', 'north-barn', [-61, 1.2, -68], [1, 2.4, 4], 'timber'),
  part('north-barn-south', 'north-barn', [-68, 1.2, -66], [9, 2.4, 1], 'paleTimber'),
  part('north-barn-roof-left', 'north-barn', [-68.7, 4.05, -73], [8.2, 0.22, 14.6], 'roof', {
    role: 'roof', solid: false, rotation: [0, 0, 0.36],
  }),
  part('north-barn-roof-right', 'north-barn', [-68.3, 4.05, -73], [8.2, 0.22, 14.6], 'roof', {
    role: 'roof', solid: false, rotation: [0, 0, -0.36],
  }),

  // Lantern Guildhall is the large north-west landmark and has a ruined court.
  part('guildhall-north-left', 'lantern-guildhall', [-101.5, 2.4, -54], [9, 4.8, 1], 'darkTimber'),
  part('guildhall-north-right', 'lantern-guildhall', [-86.5, 1.8, -54], [9, 3.6, 1], 'timber'),
  part('guildhall-west-north', 'lantern-guildhall', [-106, 2.1, -49], [1, 4.2, 9], 'darkTimber'),
  part('guildhall-west-south', 'lantern-guildhall', [-106, 1.5, -37], [1, 3, 5], 'timber'),
  part('guildhall-east', 'lantern-guildhall', [-81, 1.65, -44], [1, 3.3, 20], 'timber'),
  part('guildhall-south-left', 'lantern-guildhall', [-101, 1.25, -34], [10, 2.5, 1], 'paleTimber'),
  part('guildhall-south-right', 'lantern-guildhall', [-85.5, 1.25, -34], [8, 2.5, 1], 'paleTimber'),
  part('guildhall-court-rubble', 'lantern-guildhall', [-94, 0.7, -43], [6, 1.4, 3], 'darkTimber', { role: 'low-cover' }),
  part('guildhall-fallen-roof', 'lantern-guildhall', [-91, 1.15, -48], [9, 0.24, 7], 'roof', {
    role: 'debris', solid: false, rotation: [0.12, -0.26, 0.08],
  }),

  // A narrow granary incorporates the existing west-lane cover into a village.
  part('granary-north', 'crooked-granary', [-61.5, 1.55, -52.5], [6, 3.1, 1], 'timber'),
  part('granary-west', 'crooked-granary', [-65, 1.55, -44.5], [1, 3.1, 15], 'darkTimber'),
  part('granary-east-north', 'crooked-granary', [-58, 1.4, -49], [1, 2.8, 6], 'timber'),
  part('granary-east-south', 'crooked-granary', [-58, 1.1, -39], [1, 2.2, 4], 'paleTimber'),
  part('granary-south-left', 'crooked-granary', [-63.5, 1.1, -37], [3, 2.2, 1], 'timber'),
  part('granary-loft', 'crooked-granary', [-61.5, 2.75, -45], [6, 0.25, 7], 'paleTimber', {
    role: 'loft', solid: false,
  }),

  // Siege workshop and its broken palisade make the far-west center busy.
  part('workshop-north-left', 'siege-workshop', [-100.5, 1.55, -16], [7, 3.1, 1], 'timber'),
  part('workshop-north-right', 'siege-workshop', [-86.5, 1.25, -16], [7, 2.5, 1], 'paleTimber'),
  part('workshop-west', 'siege-workshop', [-105, 1.55, -9], [1, 3.1, 14], 'darkTimber'),
  part('workshop-east-north', 'siege-workshop', [-82, 1.35, -12], [1, 2.7, 7], 'timber'),
  part('workshop-east-south', 'siege-workshop', [-82, 1.05, -3], [1, 2.1, 4], 'timber'),
  part('workshop-south-left', 'siege-workshop', [-100, 1.05, -2], [8, 2.1, 1], 'paleTimber'),
  part('workshop-south-right', 'siege-workshop', [-86.5, 1.05, -2], [7, 2.1, 1], 'paleTimber'),
  part('workshop-bench', 'siege-workshop', [-93.5, 0.65, -8], [6, 1.3, 2], 'darkTimber', { role: 'low-cover' }),
  part('west-palisade-north', 'west-palisade', [-116, 1.45, -9], [1, 2.9, 13], 'paleTimber'),
  part('west-palisade-south', 'west-palisade', [-116, 1.45, 9], [1, 2.9, 13], 'paleTimber'),

  // A scattered healer encampment breaks the southern approach sightline.
  part('healer-camp-west-fence', 'healer-camp', [-108, 1, 26], [1, 2, 12], 'paleTimber'),
  part('healer-camp-north-fence', 'healer-camp', [-101, 1, 20], [8, 2, 1], 'paleTimber'),
  part('healer-camp-south-fence', 'healer-camp', [-87, 1, 39], [10, 2, 1], 'paleTimber'),
  part('healer-camp-table', 'healer-camp', [-93, 0.65, 22], [5, 1.3, 2], 'timber', { role: 'low-cover' }),

  // The inner bailey gives the objective approach close-range cover and exits.
  part('inner-bailey-north', 'inner-bailey', [-45.5, 1.65, 39], [11, 3.3, 1], 'timber'),
  part('inner-bailey-west', 'inner-bailey', [-51, 1.65, 45], [1, 3.3, 12], 'darkTimber'),
  part('inner-bailey-east-north', 'inner-bailey', [-40, 1.5, 42], [1, 3, 6], 'timber'),
  part('inner-bailey-east-south', 'inner-bailey', [-40, 1.15, 49], [1, 2.3, 4], 'paleTimber'),
  part('inner-bailey-south-left', 'inner-bailey', [-48, 1.15, 51], [6, 2.3, 1], 'paleTimber'),
  part('inner-bailey-courtyard-cover', 'inner-bailey', [-45, 0.75, 46], [3.5, 1.5, 2.5], 'darkTimber', { role: 'low-cover' }),

  // Southern farm and tollhouse keep the return journey visually distinct.
  part('hay-farm-west', 'hay-farm', [-106, 1.15, 69], [1, 2.3, 14], 'paleTimber'),
  part('hay-farm-north-left', 'hay-farm', [-102, 1.15, 62], [7, 2.3, 1], 'paleTimber'),
  part('hay-farm-south', 'hay-farm', [-96, 1.15, 76], [12, 2.3, 1], 'timber'),
  part('south-tollhouse-north', 'south-tollhouse', [-67, 1.65, 65], [11, 3.3, 1], 'timber'),
  part('south-tollhouse-west', 'south-tollhouse', [-73, 1.65, 72], [1, 3.3, 14], 'darkTimber'),
  part('south-tollhouse-east-north', 'south-tollhouse', [-61, 1.4, 69], [1, 2.8, 7], 'timber'),
  part('south-tollhouse-east-south', 'south-tollhouse', [-61, 1.1, 78], [1, 2.2, 4], 'paleTimber'),
  part('south-tollhouse-south', 'south-tollhouse', [-68.5, 1.1, 79], [8, 2.2, 1], 'paleTimber'),
  part('south-tollhouse-roof', 'south-tollhouse', [-67, 3.55, 72], [12.8, 0.24, 14.8], 'roof', {
    role: 'roof', solid: false, rotation: [0, 0, 0.24],
  }),
]);

export const WAR_WEST_PHOTO_PROPS = Object.freeze([
  photoProp('rook-watch-cart', 'wooden-cart', -103, -61.5),
  photoProp('rook-watch-target', 'archery-target', -78, -69, { yaw: Math.PI / 2 }),
  photoProp('north-barn-hay', 'hay-bales', -70, -62.5),
  photoProp('north-camp-tent', 'canvas-tent', -47, -76),
  photoProp('north-camp-target', 'archery-target', -43, -68),
  photoProp('guildhall-cart', 'wooden-cart', -115, -43, { yaw: Math.PI / 2 }),
  photoProp('guildhall-target', 'archery-target', -77, -38),
  photoProp('workshop-cart', 'wooden-cart', -109, -3, { yaw: Math.PI / 2 }),
  photoProp('workshop-hay', 'hay-bales', -77, -10),
  photoProp('healer-tent-west', 'canvas-tent', -101, 29),
  photoProp('healer-tent-east', 'canvas-tent', -88, 31, { yaw: Math.PI / 2 }),
  photoProp('healer-cart', 'wooden-cart', -98, 43),
  photoProp('hay-farm-stack', 'hay-bales', -100, 70, { yaw: Math.PI / 2 }),
  photoProp('hay-farm-cart', 'wooden-cart', -84, 68),
  photoProp('tollhouse-target', 'archery-target', -57, 73, { yaw: Math.PI / 2 }),
  photoProp('inner-bailey-tent', 'canvas-tent', -46, 56),
]);

export const WAR_WEST_SURFACES = Object.freeze([
  surface('west-outer-lane', [-112, 0.019, 0], [6, 0.038, 188]),
  surface('west-middle-lane', [-54, 0.02, 0], [5, 0.04, 188]),
  surface('west-inner-lane', [-27, 0.021, 0], [5, 0.042, 188], 'cobblestone'),
  surface('west-north-crossroad', [-70, 0.022, -59], [88, 0.044, 5]),
  surface('west-guild-crossroad', [-70, 0.022, -18], [88, 0.044, 5]),
  surface('west-center-crossroad', [-70, 0.022, 15], [88, 0.044, 5]),
  surface('west-camp-crossroad', [-70, 0.022, 35], [88, 0.044, 5]),
  surface('west-south-crossroad', [-70, 0.022, 59], [88, 0.044, 5]),
  surface('rook-watch-yard', [-94, 0.023, -73], [22, 0.046, 14], 'cobblestone'),
  surface('guildhall-yard', [-93.5, 0.024, -44], [22, 0.048, 18], 'cobblestone'),
  surface('healer-camp-yard', [-95, 0.023, 30], [23, 0.046, 17], 'grass'),
]);

const treePositions = [
  [-116, -87], [-111, -72], [-79, -91], [-77, -62], [-113, -51], [-77, -57],
  [-115, -34], [-76, -30], [-110, -20], [-78, -23], [-112, 27], [-78, 20],
  [-114, 48], [-77, 51], [-111, 81], [-78, 86], [-48, -91], [-43, -60],
  [-48, -31], [-43, -14], [-45, 18], [-36, 33], [-43, 65], [-42, 88],
];

const bushPositions = [
  [-109, -88], [-88, -89], [-79, -84], [-114, -64], [-101, -60], [-88, -61],
  [-76, -54], [-112, -45], [-78, -46], [-113, -27], [-91, -20], [-77, -19],
  [-112, -13], [-103, 12], [-81, 11], [-76, 25], [-114, 38], [-79, 37],
  [-111, 55], [-79, 57], [-112, 66], [-91, 58], [-77, 63], [-113, 91],
  [-89, 86], [-77, 91], [-48, -81], [-43, -51], [-48, -22], [-43, 8],
  [-48, 30], [-37, 56], [-48, 76], [-36, 91],
];

export const WAR_WEST_FOLIAGE = Object.freeze([
  ...treePositions.map(([x, z], index) => foliage(`west-tree-${index}`, 'tree', x, z, 0.88 + (index % 4) * 0.08)),
  ...bushPositions.map(([x, z], index) => foliage(`west-bush-${index}`, 'bush', x, z, 0.85 + (index % 5) * 0.06)),
]);

export const WAR_WEST_NAV_NODES = Object.freeze([
  navNode('west-north-spawn-entry', -28, -90, ['spawn-entry', 'inner-lane']),
  navNode('west-north-outer', -112, -90, ['outer-lane']),
  navNode('west-north-middle', -54, -90, ['middle-lane']),
  navNode('west-north-inner', -27, -59, ['inner-lane']),
  navNode('west-watch-cross-outer', -112, -59, ['outer-lane', 'crossroad']),
  navNode('west-watch-cross-middle', -54, -59, ['middle-lane', 'crossroad']),
  navNode('west-guild-cross-outer', -112, -18, ['outer-lane', 'crossroad']),
  navNode('west-guild-cross-middle', -54, -18, ['middle-lane', 'crossroad']),
  navNode('west-guild-cross-inner', -27, -18, ['inner-lane', 'crossroad']),
  navNode('west-center-cross-outer', -112, 15, ['outer-lane', 'crossroad']),
  navNode('west-center-cross-middle', -54, 15, ['middle-lane', 'crossroad']),
  navNode('west-center-cross-inner', -27, 15, ['inner-lane', 'crossroad']),
  navNode('west-camp-cross-outer', -112, 35, ['outer-lane', 'crossroad']),
  navNode('west-camp-cross-middle', -54, 35, ['middle-lane', 'crossroad']),
  navNode('west-camp-cross-inner', -27, 35, ['inner-lane', 'crossroad']),
  navNode('west-south-cross-outer', -112, 59, ['outer-lane', 'crossroad']),
  navNode('west-south-cross-middle', -54, 59, ['middle-lane', 'crossroad']),
  navNode('west-south-cross-inner', -27, 59, ['inner-lane', 'crossroad']),
  navNode('west-south-outer', -112, 90, ['outer-lane']),
  navNode('west-south-middle', -54, 90, ['middle-lane']),
  navNode('west-south-spawn-entry', -28, 90, ['spawn-entry', 'inner-lane']),
  navNode('west-objective-north-shoulder', -14, -12, ['objective-approach']),
  navNode('west-objective-north-entry', -8, -8, ['objective-entry']),
  navNode('west-objective-south-shoulder', -14, 12, ['objective-approach']),
  navNode('west-objective-south-entry', -8, 8, ['objective-entry']),
  navNode('west-rook-north-door', -93.5, -84, ['landmark-route']),
  navNode('west-rook-courtyard', -94, -72, ['landmark']),
  navNode('west-rook-south-door', -94, -62, ['landmark-route']),
  navNode('west-barn-yard', -64, -61, ['landmark']),
  navNode('west-guildhall-door', -93, -31, ['landmark']),
  navNode('west-workshop-door', -93, 1, ['landmark']),
  navNode('west-healer-yard', -95, 17, ['landmark']),
  navNode('west-bailey-door', -38, 54, ['landmark']),
  navNode('west-farm-yard', -94, 59, ['landmark']),
  navNode('west-tollhouse-door', -59, 82, ['landmark']),
]);

export const WAR_WEST_NAV_EDGES = Object.freeze([
  // Three long routes keep both spawn regions connected to the battle.
  navEdge('west-north-outer', 'west-watch-cross-outer', ['outer-lane']),
  navEdge('west-watch-cross-outer', 'west-guild-cross-outer', ['outer-lane']),
  navEdge('west-guild-cross-outer', 'west-center-cross-outer', ['outer-lane']),
  navEdge('west-center-cross-outer', 'west-camp-cross-outer', ['outer-lane']),
  navEdge('west-camp-cross-outer', 'west-south-cross-outer', ['outer-lane']),
  navEdge('west-south-cross-outer', 'west-south-outer', ['outer-lane']),
  navEdge('west-north-middle', 'west-watch-cross-middle', ['middle-lane']),
  navEdge('west-watch-cross-middle', 'west-guild-cross-middle', ['middle-lane']),
  navEdge('west-guild-cross-middle', 'west-center-cross-middle', ['middle-lane']),
  navEdge('west-center-cross-middle', 'west-camp-cross-middle', ['middle-lane']),
  navEdge('west-camp-cross-middle', 'west-south-cross-middle', ['middle-lane']),
  navEdge('west-south-cross-middle', 'west-south-middle', ['middle-lane']),
  navEdge('west-north-spawn-entry', 'west-north-inner', ['inner-lane']),
  navEdge('west-north-inner', 'west-guild-cross-inner', ['inner-lane']),
  navEdge('west-guild-cross-inner', 'west-center-cross-inner', ['inner-lane']),
  navEdge('west-center-cross-inner', 'west-camp-cross-inner', ['inner-lane']),
  navEdge('west-camp-cross-inner', 'west-south-cross-inner', ['inner-lane']),
  navEdge('west-south-cross-inner', 'west-south-spawn-entry', ['inner-lane']),

  // Frequent cross-connections let bots abandon a blocked or dangerous lane.
  navEdge('west-north-outer', 'west-north-middle', ['crossroad']),
  navEdge('west-north-middle', 'west-north-spawn-entry', ['crossroad']),
  navEdge('west-watch-cross-outer', 'west-watch-cross-middle', ['crossroad']),
  navEdge('west-watch-cross-middle', 'west-north-inner', ['crossroad']),
  navEdge('west-guild-cross-outer', 'west-guild-cross-middle', ['crossroad']),
  navEdge('west-guild-cross-middle', 'west-guild-cross-inner', ['crossroad']),
  navEdge('west-center-cross-outer', 'west-center-cross-middle', ['crossroad']),
  navEdge('west-center-cross-middle', 'west-center-cross-inner', ['crossroad']),
  navEdge('west-camp-cross-outer', 'west-camp-cross-middle', ['crossroad']),
  navEdge('west-camp-cross-middle', 'west-camp-cross-inner', ['crossroad']),
  navEdge('west-south-cross-outer', 'west-south-cross-middle', ['crossroad']),
  navEdge('west-south-cross-middle', 'west-south-cross-inner', ['crossroad']),
  navEdge('west-south-outer', 'west-south-middle', ['crossroad']),
  navEdge('west-south-middle', 'west-south-spawn-entry', ['crossroad']),

  // Existing center cover is approached from either shoulder, never through it.
  navEdge('west-guild-cross-inner', 'west-objective-north-shoulder', ['objective-route']),
  navEdge('west-objective-north-shoulder', 'west-objective-north-entry', ['objective-route']),
  navEdge('west-center-cross-inner', 'west-objective-south-shoulder', ['objective-route']),
  navEdge('west-objective-south-shoulder', 'west-objective-south-entry', ['objective-route']),

  // Optional landmark loops create local flanking and combat pockets.
  navEdge('west-north-outer', 'west-rook-north-door', ['landmark-route']),
  navEdge('west-rook-north-door', 'west-rook-courtyard', ['landmark-route']),
  navEdge('west-rook-courtyard', 'west-rook-south-door', ['landmark-route']),
  navEdge('west-rook-south-door', 'west-watch-cross-middle', ['landmark-route']),
  navEdge('west-watch-cross-middle', 'west-barn-yard', ['landmark-route']),
  navEdge('west-guild-cross-outer', 'west-guildhall-door', ['landmark-route']),
  navEdge('west-guildhall-door', 'west-guild-cross-middle', ['landmark-route']),
  navEdge('west-workshop-door', 'west-center-cross-outer', ['landmark-route']),
  navEdge('west-healer-yard', 'west-center-cross-middle', ['landmark-route']),
  navEdge('west-bailey-door', 'west-south-cross-inner', ['landmark-route']),
  navEdge('west-farm-yard', 'west-south-cross-outer', ['landmark-route']),
  navEdge('west-farm-yard', 'west-south-cross-middle', ['landmark-route']),
  navEdge('west-tollhouse-door', 'west-south-middle', ['landmark-route']),
]);

const partsFor = (landmarkId) => Object.freeze(
  WAR_WEST_STRUCTURE_PARTS
    .filter((entry) => entry.landmarkId === landmarkId)
    .map((entry) => entry.id),
);

export const WAR_WEST_LANDMARKS = Object.freeze([
  ['rook-watch', 'Rook Watch', 'ruined-manor'],
  ['north-barn', 'North Barn', 'barn'],
  ['lantern-guildhall', 'Lantern Guildhall', 'guildhall-ruin'],
  ['crooked-granary', 'Crooked Granary', 'granary'],
  ['siege-workshop', 'Siege Workshop', 'workshop'],
  ['west-palisade', 'West Palisade', 'palisade'],
  ['healer-camp', 'Healer Camp', 'field-camp'],
  ['inner-bailey', 'Inner Bailey', 'bailey'],
  ['hay-farm', 'Hay Farm', 'farmyard'],
  ['south-tollhouse', 'South Tollhouse', 'tollhouse'],
].map(([id, name, type]) => Object.freeze({ id, name, type, partIds: partsFor(id) })));

export const WAR_WEST_COLLIDERS = Object.freeze([
  ...WAR_WEST_STRUCTURE_PARTS.filter((entry) => entry.solid).map((entry) => entry.bounds),
  ...WAR_WEST_PHOTO_PROPS.filter((entry) => entry.solid).map((entry) => entry.collisionBounds),
]);

// No new raster is required for integration: all references above already
// exist. These are explicitly optional future image-generation targets for a
// richer 2010-phone-photo pass, not runtime dependencies.
export const WAR_WEST_OPTIONAL_ASSET_NEEDS = Object.freeze([
  Object.freeze({ id: 'ruined-guildhall', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'broken-palisade', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'wood-supply-crates', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'fallen-signpost', kind: 'fixed-cutout', priority: 'later' }),
]);

export const WAR_WEST_SECTOR = Object.freeze({
  id: 'war-west-sector',
  northIsNegativeZ: true,
  region: Object.freeze({ minX: -118, maxX: -24, minZ: -94, maxZ: 94 }),
  landmarks: WAR_WEST_LANDMARKS,
  structureParts: WAR_WEST_STRUCTURE_PARTS,
  photoProps: WAR_WEST_PHOTO_PROPS,
  surfaces: WAR_WEST_SURFACES,
  foliage: WAR_WEST_FOLIAGE,
  colliders: WAR_WEST_COLLIDERS,
  navigation: Object.freeze({
    nodes: WAR_WEST_NAV_NODES,
    edges: WAR_WEST_NAV_EDGES,
    laneIds: Object.freeze(['outer-lane', 'middle-lane', 'inner-lane']),
    objectiveEntryNodeIds: Object.freeze([
      'west-objective-north-entry',
      'west-objective-south-entry',
    ]),
    spawnEntryNodeIds: Object.freeze([
      'west-north-spawn-entry',
      'west-south-spawn-entry',
    ]),
  }),
  optionalAssetNeeds: WAR_WEST_OPTIONAL_ASSET_NEEDS,
});
