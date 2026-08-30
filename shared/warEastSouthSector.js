// Authored scenery and navigation for the eastern half of War. This module is
// intentionally renderer-agnostic so the browser arena and server authority can
// consume the same footprints. The layout borrows only the broad design ideas
// of layered lanes, recognizable landmarks, broken sightlines, and flank loops.

import { rotatedFootprintBounds } from './warSceneryGeometry.js';

const freezePoint = (point) => Object.freeze([...point]);
const freezeBounds = (bounds) => Object.freeze([...bounds]);

function solid(id, landmark, bounds, material, role = 'cover', collision = true) {
  const frozenBounds = freezeBounds(bounds);
  return Object.freeze({
    id,
    landmark,
    landmarkId: landmark,
    bounds: frozenBounds,
    position: freezePoint([
      (bounds[0] + bounds[3]) / 2,
      (bounds[1] + bounds[4]) / 2,
      (bounds[2] + bounds[5]) / 2,
    ]),
    size: freezePoint([
      bounds[3] - bounds[0],
      bounds[4] - bounds[1],
      bounds[5] - bounds[2],
    ]),
    material,
    role,
    collision,
    solid: collision,
    rotation: null,
  });
}

function surface(id, landmark, position, size, material, role = 'ground-dressing') {
  return Object.freeze({
    id,
    landmark,
    landmarkId: landmark,
    position: freezePoint(position),
    size: freezePoint(size),
    material,
    role,
  });
}

function photoProp({
  id,
  landmark,
  file,
  position,
  yaw = 0,
  width,
  height,
  depth,
  visibleBottomRatio = 0,
}) {
  return Object.freeze({
    id,
    landmark,
    landmarkId: landmark,
    type: file,
    asset: `/assets/larp/props/${file}.webp`,
    position: freezePoint(position),
    yaw,
    width,
    height,
    depth,
    visibleBottomRatio,
    presentation: 'fixed-plane',
    fixedPlane: true,
    solid: true,
    collisionBounds: freezeBounds(rotatedFootprintBounds(
      position,
      width,
      depth,
      height * 0.72,
      yaw,
    )),
  });
}

function foliage(id, type, x, z, scale = 1, yaw = 0) {
  const tree = type === 'tree';
  return Object.freeze({
    id,
    type,
    asset: `/assets/larp/war/${type}.webp`,
    position: freezePoint([x, 0, z]),
    width: (tree ? 8.5 : 5.5) * scale,
    height: (tree ? 11 : 3.4) * scale,
    yaw,
    presentation: 'fixed-cross',
    fixedCrossedPlane: true,
  });
}

function landmark(id, name, position, radius, role) {
  return Object.freeze({
    id,
    name,
    position: freezePoint(position),
    radius,
    role,
  });
}

function route(id, role, width, points, landmarks = []) {
  return Object.freeze({
    id,
    role,
    width,
    bidirectional: true,
    points: Object.freeze(points.map(freezePoint)),
    landmarks: Object.freeze([...landmarks]),
  });
}

function vault(id, from, to, obstacleId) {
  return Object.freeze({
    id,
    kind: 'vault',
    from: freezePoint(from),
    to: freezePoint(to),
    obstacleId,
    minimumUpwardVelocity: 5.4,
  });
}

export const WAR_EAST_SOUTH_LANDMARKS = Object.freeze([
  landmark(
    'east-watch-hall',
    'East Watch Hall',
    [61, 0, -42],
    17,
    'roofless close-quarters ruin with two entrances',
  ),
  landmark(
    'east-market-ruins',
    'East Market Ruins',
    [91, 0, 0],
    17,
    'broken street block dividing the long eastern sightline',
  ),
  landmark(
    'sunken-road',
    'Sunken Road',
    [30, 0, 0],
    45,
    'protected north-south approach with frequent vault gaps',
  ),
  landmark(
    'south-guildhall',
    'South Guildhall',
    [66, 0, 42],
    17,
    'three-door ruin supporting an interior shortcut',
  ),
  landmark(
    'south-muster-camp',
    'South Muster Camp',
    [94, 0, 72],
    22,
    'busy tent-and-cart staging ground outside the spawn lanes',
  ),
]);

export const WAR_EAST_SOUTH_SURFACES = Object.freeze([
  surface('sunken-road-floor', 'sunken-road', [30, 0.012, 0], [10, 0.024, 116], 'dirt', 'lane'),
  surface('east-crossroad-floor', 'east-market-ruins', [70, 0.014, 0], [72, 0.028, 12], 'cobblestone', 'lane'),
  surface('watch-hall-floor', 'east-watch-hall', [61, 0.016, -42], [20, 0.032, 18], 'dirt', 'interior'),
  surface('market-court-floor', 'east-market-ruins', [91, 0.016, 0], [21, 0.032, 17], 'cobblestone', 'interior'),
  surface('guildhall-floor', 'south-guildhall', [66, 0.016, 42], [20, 0.032, 18], 'dirt', 'interior'),
  surface('south-supply-road', 'south-muster-camp', [74, 0.012, 61], [76, 0.024, 9], 'dirt', 'lane'),
  surface('muster-yard-floor', 'south-muster-camp', [95, 0.013, 75], [38, 0.026, 29], 'dirt', 'yard'),
  surface('watch-burn-scar', 'east-watch-hall', [77, 0.018, -47], [9, 0.036, 7], 'darkTimber', 'debris-scar'),
  surface('guild-burn-scar', 'south-guildhall', [52, 0.018, 48], [8, 0.036, 6], 'darkTimber', 'debris-scar'),
]);

export const WAR_EAST_SOUTH_SOLIDS = Object.freeze([
  // Low revetments make the inner approach readable while regular gaps keep
  // forty bodies from funnelling into a single choke.
  solid('trench-nw-a', 'sunken-road', [22, 0, -58, 24, 1.05, -43], 'darkTimber', 'vault-cover'),
  solid('trench-nw-b', 'sunken-road', [22, 0, -38, 24, 1.05, -21], 'darkTimber', 'vault-cover'),
  solid('trench-ne-a', 'sunken-road', [36, 0, -58, 38, 1.05, -48], 'darkTimber', 'vault-cover'),
  solid('trench-ne-b', 'sunken-road', [36, 0, -43, 38, 1.05, -21], 'darkTimber', 'vault-cover'),
  solid('trench-sw-a', 'sunken-road', [22, 0, 21, 24, 1.05, 34], 'darkTimber', 'vault-cover'),
  solid('trench-sw-b', 'sunken-road', [22, 0, 39, 24, 1.05, 58], 'darkTimber', 'vault-cover'),
  solid('trench-se-a', 'sunken-road', [36, 0, 21, 38, 1.05, 43], 'darkTimber', 'vault-cover'),
  solid('trench-se-b', 'sunken-road', [36, 0, 48, 38, 1.05, 58], 'darkTimber', 'vault-cover'),

  // East Watch Hall: the roof is gone, the walls are broken into playable
  // pieces, and both its south and west sides retain broad door openings.
  solid('watch-north-wall', 'east-watch-hall', [50, 0, -53, 72, 5.2, -51], 'red', 'building-wall'),
  solid('watch-south-wall-west', 'east-watch-hall', [50, 0, -33, 57, 3.8, -31], 'red', 'building-wall'),
  solid('watch-south-wall-east', 'east-watch-hall', [65, 0, -33, 72, 4.5, -31], 'red', 'building-wall'),
  solid('watch-west-wall-north', 'east-watch-hall', [50, 0, -51, 52, 4.6, -44], 'red', 'building-wall'),
  solid('watch-west-wall-south', 'east-watch-hall', [50, 0, -39, 52, 3.6, -33], 'red', 'building-wall'),
  solid('watch-east-wall', 'east-watch-hall', [70, 0, -51, 72, 5.1, -33], 'red', 'building-wall'),
  solid('watch-inner-broken-wall', 'east-watch-hall', [61, 0, -51, 63, 2.15, -43], 'paleTimber', 'interior-cover'),
  solid('watch-roof-beam-north', 'east-watch-hall', [51, 4.35, -50.5, 70, 4.75, -49.7], 'darkTimber', 'roof-debris'),
  solid('watch-roof-beam-east', 'east-watch-hall', [68.8, 3.9, -49, 69.5, 4.35, -34], 'darkTimber', 'roof-debris'),

  // A roofless market block creates two alleys and a passable central court.
  solid('market-north-west', 'east-market-ruins', [80, 0, -11, 87, 3.4, -9], 'blue', 'building-wall'),
  solid('market-north-east', 'east-market-ruins', [94, 0, -11, 102, 4.7, -9], 'blue', 'building-wall'),
  solid('market-south-west', 'east-market-ruins', [80, 0, 9, 88, 4.5, 11], 'blue', 'building-wall'),
  solid('market-south-east', 'east-market-ruins', [96, 0, 9, 102, 3.1, 11], 'blue', 'building-wall'),
  solid('market-west-north', 'east-market-ruins', [80, 0, -9, 82, 4.2, -3], 'blue', 'building-wall'),
  solid('market-west-south', 'east-market-ruins', [80, 0, 3, 82, 3.25, 9], 'blue', 'building-wall'),
  solid('market-east-wall', 'east-market-ruins', [100, 0, -9, 102, 4.8, 9], 'blue', 'building-wall'),
  solid('market-stall-cover-a', 'east-market-ruins', [86, 0, -3, 91, 1.35, -1], 'paleTimber', 'interior-cover'),
  solid('market-stall-cover-b', 'east-market-ruins', [92, 0, 3, 97, 1.35, 5], 'paleTimber', 'interior-cover'),

  // South Guildhall mirrors neither the watch hall nor the market. Three
  // staggered entrances support through-building and around-building choices.
  solid('guild-north-west', 'south-guildhall', [55, 0, 32, 62, 4.8, 34], 'red', 'building-wall'),
  solid('guild-north-east', 'south-guildhall', [69, 0, 32, 77, 3.5, 34], 'red', 'building-wall'),
  solid('guild-south-west', 'south-guildhall', [55, 0, 50, 64, 3.7, 52], 'red', 'building-wall'),
  solid('guild-south-east', 'south-guildhall', [71, 0, 50, 77, 4.9, 52], 'red', 'building-wall'),
  solid('guild-west-north', 'south-guildhall', [55, 0, 34, 57, 3.6, 39], 'red', 'building-wall'),
  solid('guild-west-south', 'south-guildhall', [55, 0, 45, 57, 4.6, 50], 'red', 'building-wall'),
  solid('guild-east-wall', 'south-guildhall', [75, 0, 34, 77, 4.7, 50], 'red', 'building-wall'),
  solid('guild-inner-dais', 'south-guildhall', [64, 0, 42, 68, 1.15, 46], 'paleTimber', 'interior-cover'),
  solid('guild-fallen-beam', 'south-guildhall', [59, 0, 37, 60.2, 1.25, 44], 'darkTimber', 'vault-cover'),

  // Broken camp perimeter. These are waist-high or split by broad gates; the
  // team-zero formation remains clear on the other side of x=40.
  solid('muster-west-fence-a', 'south-muster-camp', [82, 0, 64, 83.2, 1.45, 72], 'timber', 'camp-fence'),
  solid('muster-west-fence-b', 'south-muster-camp', [82, 0, 79, 83.2, 1.45, 88], 'timber', 'camp-fence'),
  solid('muster-north-fence-a', 'south-muster-camp', [83, 0, 64, 93, 1.45, 65.2], 'timber', 'camp-fence'),
  solid('muster-north-fence-b', 'south-muster-camp', [101, 0, 64, 113, 1.45, 65.2], 'timber', 'camp-fence'),
  solid('muster-east-fence-a', 'south-muster-camp', [112, 0, 65, 113.2, 1.45, 74], 'timber', 'camp-fence'),
  solid('muster-east-fence-b', 'south-muster-camp', [112, 0, 81, 113.2, 1.45, 89], 'timber', 'camp-fence'),
  solid('muster-south-fence-a', 'south-muster-camp', [83, 0, 88, 96, 1.45, 89.2], 'timber', 'camp-fence'),
  solid('muster-south-fence-b', 'south-muster-camp', [104, 0, 88, 113, 1.45, 89.2], 'timber', 'camp-fence'),
  solid('muster-pavilion-post-a', 'south-muster-camp', [89, 0, 69, 90, 3.1, 70], 'darkTimber', 'camp-structure'),
  solid('muster-pavilion-post-b', 'south-muster-camp', [101, 0, 69, 102, 3.1, 70], 'darkTimber', 'camp-structure'),
  solid('muster-pavilion-post-c', 'south-muster-camp', [89, 0, 80, 90, 3.1, 81], 'darkTimber', 'camp-structure'),
  solid('muster-pavilion-post-d', 'south-muster-camp', [101, 0, 80, 102, 3.1, 81], 'darkTimber', 'camp-structure'),
  solid('muster-pavilion-roof', 'south-muster-camp', [88.5, 3.05, 68.5, 102.5, 3.55, 81.5], 'canvas', 'camp-structure'),

  // Isolated pieces break up sightlines without forming another hard choke.
  solid('east-barricade-north', 'east-watch-hall', [78, 0, -67, 86, 1.4, -64], 'paleTimber', 'field-cover'),
  solid('east-barricade-middle', 'east-market-ruins', [108, 0, -4, 111, 1.6, 4], 'paleTimber', 'field-cover'),
  solid('east-barricade-south', 'south-guildhall', [43, 0, 52, 49, 1.4, 55], 'paleTimber', 'field-cover'),
  solid('south-road-barricade', 'south-muster-camp', [68, 0, 68, 75, 1.4, 71], 'paleTimber', 'field-cover'),
]);

export const WAR_EAST_SOUTH_PHOTO_PROPS = Object.freeze([
  photoProp({ id: 'north-supply-cart', landmark: 'east-watch-hall', file: 'wooden-cart', position: [58, 0, -78], yaw: 0.28, width: 5.4, height: 3.55, depth: 2.4, visibleBottomRatio: 105 / 512 }),
  photoProp({ id: 'watch-hay-stack', landmark: 'east-watch-hall', file: 'hay-bales', position: [42, 0, -27], yaw: -0.22, width: 5.5, height: 2.2, depth: 2.2, visibleBottomRatio: 68 / 512 }),
  photoProp({ id: 'watch-field-tent', landmark: 'east-watch-hall', file: 'canvas-tent', position: [91, 0, -43], yaw: -0.42, width: 4.8, height: 3.2, depth: 3.2, visibleBottomRatio: 11 / 427 }),
  photoProp({ id: 'north-practice-target', landmark: 'east-market-ruins', file: 'archery-target', position: [76, 0, -20], yaw: Math.PI * 0.48, width: 2.4, height: 2.85, depth: 0.65, visibleBottomRatio: 15 / 640 }),
  photoProp({ id: 'market-broken-cart', landmark: 'east-market-ruins', file: 'wooden-cart', position: [106, 0, -22], yaw: -0.6, width: 5.4, height: 3.55, depth: 2.4, visibleBottomRatio: 105 / 512 }),
  photoProp({ id: 'south-road-hay', landmark: 'sunken-road', file: 'hay-bales', position: [44, 0, 29], yaw: 0.16, width: 5.5, height: 2.2, depth: 2.2, visibleBottomRatio: 68 / 512 }),
  photoProp({ id: 'guild-refuge-tent', landmark: 'south-guildhall', file: 'canvas-tent', position: [91, 0, 30], yaw: 0.37, width: 4.8, height: 3.2, depth: 3.2, visibleBottomRatio: 11 / 427 }),
  photoProp({ id: 'guild-supply-cart', landmark: 'south-guildhall', file: 'wooden-cart', position: [84, 0, 52], yaw: -0.36, width: 5.4, height: 3.55, depth: 2.4, visibleBottomRatio: 105 / 512 }),
  photoProp({ id: 'camp-front-tent', landmark: 'south-muster-camp', file: 'canvas-tent', position: [96, 0, 57], yaw: Math.PI, width: 4.8, height: 3.2, depth: 3.2, visibleBottomRatio: 11 / 427 }),
  photoProp({ id: 'camp-west-tent', landmark: 'south-muster-camp', file: 'canvas-tent', position: [75, 0, 78], yaw: Math.PI * 0.54, width: 4.8, height: 3.2, depth: 3.2, visibleBottomRatio: 11 / 427 }),
  photoProp({ id: 'camp-east-hay', landmark: 'south-muster-camp', file: 'hay-bales', position: [106, 0, 73], yaw: -0.24, width: 5.5, height: 2.2, depth: 2.2, visibleBottomRatio: 68 / 512 }),
  photoProp({ id: 'camp-practice-target', landmark: 'south-muster-camp', file: 'archery-target', position: [84, 0, 94], yaw: Math.PI, width: 2.4, height: 2.85, depth: 0.65, visibleBottomRatio: 15 / 640 }),
]);

const FOLIAGE_PLACEMENTS = [
  ['tree', 44, -92, 1.02, 0.1], ['tree', 57, -88, 0.9, 0.5],
  ['bush', 69, -91, 1.08, 0.2], ['tree', 85, -88, 1.06, 0.8],
  ['bush', 98, -92, 0.95, 0.1], ['tree', 113, -85, 1.04, 0.4],
  ['bush', 47, -74, 0.92, 0.6], ['tree', 59, -70, 0.82, 0.2],
  ['bush', 68, -74, 1.16, 0.8], ['tree', 96, -72, 0.96, 0.4],
  ['bush', 107, -69, 1.02, 0.1], ['tree', 116, -57, 0.9, 0.5],
  ['bush', 44, -49, 1.1, 0.2], ['bush', 78, -54, 0.9, 0.7],
  ['tree', 82, -45, 0.92, 0.4], ['bush', 105, -48, 1.14, 0.1],
  ['tree', 115, -32, 1.02, 0.7], ['bush', 46, -17, 0.95, 0.3],
  ['tree', 59, -19, 0.86, 0.8], ['bush', 69, -13, 1.08, 0.2],
  ['tree', 112, -14, 0.96, 0.5], ['bush', 116, 12, 1.12, 0.1],
  ['tree', 66, 16, 0.92, 0.7], ['bush', 76, 22, 0.94, 0.4],
  ['tree', 108, 24, 0.98, 0.2], ['bush', 116, 38, 1.08, 0.8],
  ['bush', 43, 38, 1.12, 0.5], ['tree', 47, 44, 0.88, 0.1],
  ['bush', 83, 34, 0.93, 0.3], ['tree', 105, 43, 0.94, 0.7],
  ['bush', 113, 54, 1.15, 0.4], ['tree', 44, 62, 0.96, 0.2],
  ['bush', 55, 61, 0.9, 0.6], ['tree', 61, 72, 0.84, 0.4],
  ['bush', 76, 65, 1.1, 0.2], ['tree', 116, 69, 0.92, 0.8],
  ['bush', 47, 83, 1.06, 0.1], ['tree', 56, 91, 0.98, 0.5],
  ['bush', 70, 94, 0.94, 0.2], ['tree', 101, 95, 1.02, 0.7],
  ['bush', 115, 92, 1.05, 0.4], ['bush', 88, 59, 0.9, 0.1],
  ['bush', 51, 23, 1.0, 0.4], ['bush', 104, 15, 1.08, 0.7],
  ['bush', 74, -31, 0.94, 0.2], ['bush', 88, -60, 1.04, 0.6],
];

export const WAR_EAST_SOUTH_FOLIAGE = Object.freeze(
  FOLIAGE_PLACEMENTS.map(([type, x, z, scale, yaw], index) =>
    foliage(`east-south-${type}-${index}`, type, x, z, scale, yaw)),
);

export const WAR_EAST_SOUTH_COLLIDERS = Object.freeze([
  ...WAR_EAST_SOUTH_SOLIDS
    .filter((item) => item.collision)
    .map((item) => item.bounds),
  ...WAR_EAST_SOUTH_PHOTO_PROPS.map((item) => item.collisionBounds),
]);

const NAV_ROUTES = Object.freeze([
  route(
    'east-inner-north',
    'protected-assault',
    8,
    [[15.5, 0.02, -8], [20, 0.02, -14], [30, 0.02, -20], [30, 0.02, -39], [30, 0.02, -59], [40, 0.02, -64], [48, 0.02, -73]],
    ['sunken-road', 'east-watch-hall'],
  ),
  route(
    'east-inner-south',
    'protected-assault',
    8,
    [[15.5, 0.02, 8], [20, 0.02, 14], [30, 0.02, 20], [30, 0.02, 39], [30, 0.02, 59], [40, 0.02, 64], [48, 0.02, 73]],
    ['sunken-road', 'south-guildhall'],
  ),
  route(
    'east-crossroad-north',
    'middle-flank',
    6,
    [[15.5, 0.02, -8], [28, 0.02, -14], [48, 0.02, -17], [66, 0.02, -17], [84, 0.02, -18], [103, 0.02, -17], [112, 0.02, -10], [114, 0.02, 0]],
    ['sunken-road', 'east-market-ruins'],
  ),
  route(
    'east-crossroad-south',
    'middle-flank',
    6,
    [[15.5, 0.02, 8], [28, 0.02, 14], [48, 0.02, 17], [66, 0.02, 17], [84, 0.02, 18], [103, 0.02, 17], [112, 0.02, 10], [114, 0.02, 0]],
    ['sunken-road', 'east-market-ruins', 'south-guildhall'],
  ),
  route(
    'east-outer-loop',
    'wide-flank',
    7,
    [[48, 0.02, -73], [69, 0.02, -61], [92, 0.02, -60], [108, 0.02, -54], [115, 0.02, -38], [114, 0.02, 0], [115, 0.02, 38], [110, 0.02, 57], [116, 0.02, 62], [116, 0.02, 94]],
    ['east-watch-hall', 'east-market-ruins', 'south-muster-camp'],
  ),
  route(
    'watch-hall-interior',
    'interior-shortcut',
    5,
    [[46, 0.02, -41.5], [54, 0.02, -41.5], [58, 0.02, -38], [61, 0.02, -36], [61, 0.02, -27], [66, 0.02, -17]],
    ['east-watch-hall'],
  ),
  route(
    'guildhall-interior',
    'interior-shortcut',
    2,
    [[48, 0.02, 42], [53, 0.02, 42], [58, 0.02, 42], [58, 0.02, 35.5], [62, 0.02, 35.5], [67, 0.02, 37], [66, 0.02, 29], [66, 0.02, 17]],
    ['south-guildhall'],
  ),
  route(
    'south-supply-loop',
    'spawn-safe-flank',
    7,
    [[48, 0.02, 73], [59, 0.02, 63], [80, 0.02, 60], [102, 0.02, 60], [110, 0.02, 57], [116, 0.02, 62]],
    ['south-guildhall', 'south-muster-camp'],
  ),
]);

const encodeCoordinate = (value) => String(value)
  .replaceAll('-', 'm')
  .replaceAll('.', 'p');

function buildNavigationGraph(routes) {
  const nodeDrafts = new Map();
  const edgeDrafts = new Map();
  const nodeId = (point) =>
    `east-nav-x${encodeCoordinate(point[0])}-z${encodeCoordinate(point[2])}`;

  for (const item of routes) {
    for (const [index, point] of item.points.entries()) {
      const id = nodeId(point);
      if (!nodeDrafts.has(id)) {
        nodeDrafts.set(id, {
          id,
          position: point,
          clearance: PLAYER_NAV_CLEARANCE,
          tags: new Set(),
        });
      }
      const node = nodeDrafts.get(id);
      node.tags.add(item.role);
      node.tags.add(item.id);
      if (index === 0 && Math.hypot(point[0], point[2]) <= 18) {
        node.tags.add('objective-entry');
      }
      if (Math.abs(point[2]) >= 70 && point[0] <= 50) {
        node.tags.add('spawn-entry');
      }

      if (index === 0) continue;
      const from = nodeId(item.points[index - 1]);
      const to = id;
      const key = [from, to].sort().join(':');
      if (!edgeDrafts.has(key)) {
        edgeDrafts.set(key, {
          from,
          to,
          bidirectional: true,
          tags: new Set(),
        });
      }
      edgeDrafts.get(key).tags.add(item.role);
      edgeDrafts.get(key).tags.add(item.id);
    }
  }

  return Object.freeze({
    nodes: Object.freeze([...nodeDrafts.values()].map((node) => Object.freeze({
      ...node,
      tags: Object.freeze([...node.tags]),
    }))),
    edges: Object.freeze([...edgeDrafts.values()].map((edge) => Object.freeze({
      ...edge,
      tags: Object.freeze([...edge.tags]),
    }))),
  });
}

const PLAYER_NAV_CLEARANCE = 0.9;
const NAV_GRAPH = buildNavigationGraph(NAV_ROUTES);

export const WAR_EAST_SOUTH_NAV_NODES = NAV_GRAPH.nodes;
export const WAR_EAST_SOUTH_NAV_EDGES = NAV_GRAPH.edges;

const VAULT_LINKS = Object.freeze([
  vault('vault-trench-nw-a', [21, 0.02, -46], [25, 0.02, -46], 'trench-nw-a'),
  vault('vault-trench-nw-b', [21, 0.02, -31], [25, 0.02, -31], 'trench-nw-b'),
  vault('vault-trench-ne-a', [35, 0.02, -52], [39, 0.02, -52], 'trench-ne-a'),
  vault('vault-trench-ne-b', [35, 0.02, -36], [39, 0.02, -36], 'trench-ne-b'),
  vault('vault-trench-sw-a', [21, 0.02, 27], [25, 0.02, 27], 'trench-sw-a'),
  vault('vault-trench-sw-b', [21, 0.02, 49], [25, 0.02, 49], 'trench-sw-b'),
  vault('vault-trench-se-a', [35, 0.02, 32], [39, 0.02, 32], 'trench-se-a'),
  vault('vault-trench-se-b', [35, 0.02, 53], [39, 0.02, 53], 'trench-se-b'),
  vault('vault-guild-beam', [59.6, 0.02, 36], [59.6, 0.02, 45], 'guild-fallen-beam'),
]);

const COVER_ANCHORS = Object.freeze([
  [25.5, -31], [34.5, -36], [25.5, -49], [34.5, -52],
  [25.5, 27], [34.5, 32], [25.5, 49], [34.5, 53],
  [48, -42], [54, -36], [67, -37], [74, -42],
  [78, -7], [84, -5], [98, 0], [104, 5],
  [53, 42], [61, 36], [71, 47], [79, 42],
  [80, 70], [86, 63], [105, 63], [109, 82],
].map(([x, z], index) => Object.freeze({
  id: `east-south-cover-${index}`,
  position: freezePoint([x, 0.02, z]),
  orbitRadius: 2.2,
})));

export const WAR_EAST_SOUTH_NAV = Object.freeze({
  routes: NAV_ROUTES,
  nodes: WAR_EAST_SOUTH_NAV_NODES,
  edges: WAR_EAST_SOUTH_NAV_EDGES,
  vaultLinks: VAULT_LINKS,
  coverAnchors: COVER_ANCHORS,
  obstacles: Object.freeze([
    ...WAR_EAST_SOUTH_SOLIDS.filter((item) => item.collision).map((item) =>
      Object.freeze({ id: item.id, bounds: item.bounds, role: item.role })),
    ...WAR_EAST_SOUTH_PHOTO_PROPS.map((item) =>
      Object.freeze({ id: item.id, bounds: item.collisionBounds, role: 'photo-prop' })),
  ]),
  objectiveApproachIds: Object.freeze([
    'east-inner-north',
    'east-inner-south',
    'east-crossroad-north',
    'east-crossroad-south',
  ]),
  objectiveEntryNodeIds: Object.freeze(
    WAR_EAST_SOUTH_NAV_NODES
      .filter((node) => node.tags.includes('objective-entry'))
      .map((node) => node.id),
  ),
  spawnEntryNodeIds: Object.freeze(
    WAR_EAST_SOUTH_NAV_NODES
      .filter((node) => node.tags.includes('spawn-entry'))
      .map((node) => node.id),
  ),
  laneIds: Object.freeze([
    'protected-assault',
    'middle-flank',
    'wide-flank',
    'interior-shortcut',
    'spawn-safe-flank',
  ]),
});

// Everything above is integration-ready with existing photographs. These are
// optional later image-generation targets for the same transparent, direct-
// flash 2010 phone-photo treatment; no runtime record depends on them yet.
export const WAR_EAST_SOUTH_OPTIONAL_ASSET_NEEDS = Object.freeze([
  Object.freeze({ id: 'larp-supply-crates', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'broken-foam-shield-barricade', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'torn-guild-pennant', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'trench-stakes-and-rubble', kind: 'fixed-cutout', priority: 'later' }),
  Object.freeze({ id: 'cold-campfire-and-pot', kind: 'fixed-cutout', priority: 'later' }),
]);

export const WAR_EAST_SOUTH_SECTOR = Object.freeze({
  id: 'war-east-south-sector',
  bounds: freezeBounds([12, 0, -98, 118, 6, 98]),
  landmarks: WAR_EAST_SOUTH_LANDMARKS,
  surfaces: WAR_EAST_SOUTH_SURFACES,
  solids: WAR_EAST_SOUTH_SOLIDS,
  structureParts: WAR_EAST_SOUTH_SOLIDS,
  photoProps: WAR_EAST_SOUTH_PHOTO_PROPS,
  foliage: WAR_EAST_SOUTH_FOLIAGE,
  colliders: WAR_EAST_SOUTH_COLLIDERS,
  navigation: WAR_EAST_SOUTH_NAV,
  optionalAssetNeeds: WAR_EAST_SOUTH_OPTIONAL_ASSET_NEEDS,
});
