import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import {
  WAR_EAST_SOUTH_COLLIDERS,
  WAR_EAST_SOUTH_FOLIAGE,
  WAR_EAST_SOUTH_LANDMARKS,
  WAR_EAST_SOUTH_NAV,
  WAR_EAST_SOUTH_NAV_EDGES,
  WAR_EAST_SOUTH_NAV_NODES,
  WAR_EAST_SOUTH_OPTIONAL_ASSET_NEEDS,
  WAR_EAST_SOUTH_PHOTO_PROPS,
  WAR_EAST_SOUTH_SECTOR,
  WAR_EAST_SOUTH_SOLIDS,
  WAR_EAST_SOUTH_SURFACES,
} from '../shared/warEastSouthSector.js';
import {
  WAR_MAP,
  WAR_TEAM_SIZE,
  warSpawnForSlot,
} from '../shared/warConfig.js';

const PLAYER_ROUTE_CLEARANCE = 0.9;

function horizontalGap(first, second) {
  const gapX = Math.max(first[0] - second[3], second[0] - first[3], 0);
  const gapZ = Math.max(first[2] - second[5], second[2] - first[5], 0);
  return Math.hypot(gapX, gapZ);
}

function pointToBoundsGap(point, bounds) {
  return Math.hypot(
    Math.max(bounds[0] - point[0], point[0] - bounds[3], 0),
    Math.max(bounds[2] - point[2], point[2] - bounds[5], 0),
  );
}

// Liang-Barsky against the horizontal footprint. Expanding before testing
// proves a bot centerline has room for its body and steering correction.
function segmentIntersectsBounds(from, to, bounds, padding = 0) {
  const minX = bounds[0] - padding;
  const maxX = bounds[3] + padding;
  const minZ = bounds[2] - padding;
  const maxZ = bounds[5] + padding;
  const deltaX = to[0] - from[0];
  const deltaZ = to[2] - from[2];
  let minimum = 0;
  let maximum = 1;

  for (const [direction, distance] of [
    [-deltaX, from[0] - minX],
    [deltaX, maxX - from[0]],
    [-deltaZ, from[2] - minZ],
    [deltaZ, maxZ - from[2]],
  ]) {
    if (Math.abs(direction) < 1e-9) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > maximum) return false;
      minimum = Math.max(minimum, ratio);
    } else {
      if (ratio < minimum) return false;
      maximum = Math.min(maximum, ratio);
    }
  }
  return true;
}

function graphCanReach(adjacency, start, goals) {
  const pending = [start];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.shift();
    if (goals.has(current)) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

test('east/south War sector is dense, varied, immutable authored data', () => {
  assert.equal(WAR_EAST_SOUTH_SECTOR.id, 'war-east-south-sector');
  assert.ok(WAR_EAST_SOUTH_LANDMARKS.length >= 5);
  assert.ok(WAR_EAST_SOUTH_SURFACES.length >= 8);
  assert.ok(WAR_EAST_SOUTH_SOLIDS.length >= 48);
  assert.ok(WAR_EAST_SOUTH_PHOTO_PROPS.length >= 12);
  assert.ok(WAR_EAST_SOUTH_FOLIAGE.length >= 40);
  assert.ok(WAR_EAST_SOUTH_NAV.routes.length >= 7);
  assert.ok(WAR_EAST_SOUTH_NAV_NODES.length >= 45);
  assert.ok(WAR_EAST_SOUTH_NAV_EDGES.length >= 45);
  assert.ok(WAR_EAST_SOUTH_NAV.vaultLinks.length >= 8);
  assert.ok(WAR_EAST_SOUTH_NAV.coverAnchors.length >= 20);

  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_SECTOR));
  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_SOLIDS));
  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_SOLIDS[0]));
  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_SOLIDS[0].bounds));
  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_NAV.routes[0].points));
  assert.ok(Object.isFrozen(WAR_EAST_SOUTH_NAV.routes[0].points[0]));

  const ids = [
    ...WAR_EAST_SOUTH_LANDMARKS,
    ...WAR_EAST_SOUTH_SURFACES,
    ...WAR_EAST_SOUTH_SOLIDS,
    ...WAR_EAST_SOUTH_PHOTO_PROPS,
    ...WAR_EAST_SOUTH_FOLIAGE,
    ...WAR_EAST_SOUTH_NAV.routes,
    ...WAR_EAST_SOUTH_NAV.vaultLinks,
    ...WAR_EAST_SOUTH_NAV.coverAnchors,
  ].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'all authored records need stable unique ids');

  assert.ok(new Set(WAR_EAST_SOUTH_SOLIDS.map((item) => item.role)).size >= 7);
  assert.ok(new Set(WAR_EAST_SOUTH_PHOTO_PROPS.map((item) => item.asset)).size >= 4);
  assert.deepEqual(
    new Set(WAR_EAST_SOUTH_FOLIAGE.map((item) => item.presentation)),
    new Set(['fixed-cross']),
  );
  assert.equal(WAR_EAST_SOUTH_SECTOR.structureParts, WAR_EAST_SOUTH_SOLIDS);
  assert.ok(WAR_EAST_SOUTH_SOLIDS.every((item) =>
    item.solid === item.collision && item.landmarkId === item.landmark));
  assert.ok(WAR_EAST_SOUTH_OPTIONAL_ASSET_NEEDS.length >= 5);
  assert.ok(WAR_EAST_SOUTH_OPTIONAL_ASSET_NEEDS.every((item) => item.priority === 'later'));
});

test('sector colliders exactly match physical scenery and remain in map bounds', () => {
  const physicalSolids = WAR_EAST_SOUTH_SOLIDS.filter((item) => item.collision);
  assert.equal(
    WAR_EAST_SOUTH_COLLIDERS.length,
    physicalSolids.length + WAR_EAST_SOUTH_PHOTO_PROPS.length,
  );
  assert.equal(WAR_EAST_SOUTH_NAV.obstacles.length, WAR_EAST_SOUTH_COLLIDERS.length);

  for (const bounds of WAR_EAST_SOUTH_COLLIDERS) {
    assert.equal(bounds.length, 6);
    assert.ok(bounds[0] < bounds[3]);
    assert.ok(bounds[1] < bounds[4]);
    assert.ok(bounds[2] < bounds[5]);
    assert.ok(bounds[0] >= -WAR_MAP.bounds.x && bounds[3] <= WAR_MAP.bounds.x);
    assert.ok(bounds[2] >= -WAR_MAP.bounds.z && bounds[5] <= WAR_MAP.bounds.z);
    assert.ok(
      pointToBoundsGap(WAR_MAP.objective.position, bounds)
        >= WAR_MAP.objective.radius + 3,
      `sector cover enters the open control point: ${bounds.join(',')}`,
    );
  }

  assert.deepEqual(
    WAR_EAST_SOUTH_COLLIDERS,
    [
      ...physicalSolids.map((item) => item.bounds),
      ...WAR_EAST_SOUTH_PHOTO_PROPS.map((item) => item.collisionBounds),
    ],
  );
});

test('all forty spawn positions retain a broad unobstructed deployment area', () => {
  for (let team = 0; team < 2; team += 1) {
    for (let slot = 0; slot < WAR_TEAM_SIZE; slot += 1) {
      const spawn = warSpawnForSlot(team, slot);
      for (const obstacle of WAR_EAST_SOUTH_NAV.obstacles) {
        assert.ok(
          pointToBoundsGap(spawn, obstacle.bounds) >= 8,
          `team ${team} slot ${slot} is crowded by ${obstacle.id}`,
        );
      }
    }
  }
});

test('fixed photo props have their own footprints and are not embedded in boxes', () => {
  for (const prop of WAR_EAST_SOUTH_PHOTO_PROPS) {
    assert.equal(prop.presentation, 'fixed-plane');
    assert.ok(prop.collisionBounds[0] < prop.position[0]);
    assert.ok(prop.collisionBounds[3] > prop.position[0]);
    assert.ok(prop.collisionBounds[2] < prop.position[2]);
    assert.ok(prop.collisionBounds[5] > prop.position[2]);
    for (const structure of WAR_EAST_SOUTH_SOLIDS) {
      assert.ok(
        horizontalGap(prop.collisionBounds, structure.bounds) >= 0.5,
        `${prop.id} is embedded in ${structure.id}`,
      );
    }
  }

  for (let first = 0; first < WAR_EAST_SOUTH_PHOTO_PROPS.length; first += 1) {
    for (let second = first + 1; second < WAR_EAST_SOUTH_PHOTO_PROPS.length; second += 1) {
      assert.ok(
        horizontalGap(
          WAR_EAST_SOUTH_PHOTO_PROPS[first].collisionBounds,
          WAR_EAST_SOUTH_PHOTO_PROPS[second].collisionBounds,
        ) >= 2,
        `${WAR_EAST_SOUTH_PHOTO_PROPS[first].id} overlaps ${WAR_EAST_SOUTH_PHOTO_PROPS[second].id}`,
      );
    }
  }
});

test('authored bot lanes clear every obstacle and provide four objective approaches', () => {
  for (const route of WAR_EAST_SOUTH_NAV.routes) {
    assert.ok(route.points.length >= 5, `${route.id} needs enough steering detail`);
    for (let index = 1; index < route.points.length; index += 1) {
      for (const obstacle of WAR_EAST_SOUTH_NAV.obstacles) {
        assert.equal(
          segmentIntersectsBounds(
            route.points[index - 1],
            route.points[index],
            obstacle.bounds,
            PLAYER_ROUTE_CLEARANCE,
          ),
          false,
          `${route.id} segment ${index - 1}-${index} clips ${obstacle.id}`,
        );
      }
    }
  }

  assert.equal(new Set(WAR_EAST_SOUTH_NAV.objectiveApproachIds).size, 4);
  for (const id of WAR_EAST_SOUTH_NAV.objectiveApproachIds) {
    const approach = WAR_EAST_SOUTH_NAV.routes.find((item) => item.id === id);
    assert.ok(approach, `missing objective route ${id}`);
    assert.ok(
      Math.hypot(approach.points[0][0], approach.points[0][2])
        <= WAR_MAP.objective.radius + 6,
      `${id} never reaches the objective approach`,
    );
  }
});

test('navigation graph connects both deployment ends to the objective', () => {
  const nodes = new Map(WAR_EAST_SOUTH_NAV_NODES.map((node) => [node.id, node]));
  const adjacency = new Map(WAR_EAST_SOUTH_NAV_NODES.map((node) => [node.id, []]));
  for (const edge of WAR_EAST_SOUTH_NAV_EDGES) {
    assert.ok(nodes.has(edge.from), `missing edge start ${edge.from}`);
    assert.ok(nodes.has(edge.to), `missing edge end ${edge.to}`);
    adjacency.get(edge.from).push(edge.to);
    if (edge.bidirectional) adjacency.get(edge.to).push(edge.from);
  }

  assert.equal(WAR_EAST_SOUTH_NAV.spawnEntryNodeIds.length, 2);
  assert.equal(WAR_EAST_SOUTH_NAV.objectiveEntryNodeIds.length, 2);
  const objectives = new Set(WAR_EAST_SOUTH_NAV.objectiveEntryNodeIds);
  for (const spawn of WAR_EAST_SOUTH_NAV.spawnEntryNodeIds) {
    assert.equal(graphCanReach(adjacency, spawn, objectives), true, `${spawn} is isolated`);
  }
});

test('low revetments expose explicit two-way vault links', () => {
  const obstacles = new Map(WAR_EAST_SOUTH_NAV.obstacles.map((item) => [item.id, item]));
  for (const link of WAR_EAST_SOUTH_NAV.vaultLinks) {
    const obstacle = obstacles.get(link.obstacleId);
    assert.ok(obstacle, `${link.id} names a missing obstacle`);
    assert.ok(obstacle.bounds[4] <= 1.5, `${link.id} must only vault low cover`);
    assert.ok(pointToBoundsGap(link.from, obstacle.bounds) > 0);
    assert.ok(pointToBoundsGap(link.to, obstacle.bounds) > 0);
    assert.equal(
      segmentIntersectsBounds(link.from, link.to, obstacle.bounds),
      true,
      `${link.id} does not cross its declared obstacle`,
    );
  }
});

test('every sector cutout references an existing local transparent-photo asset', async () => {
  const assets = new Set([
    ...WAR_EAST_SOUTH_PHOTO_PROPS.map((item) => item.asset),
    ...WAR_EAST_SOUTH_FOLIAGE.map((item) => item.asset),
  ]);
  await Promise.all([...assets].map((asset) =>
    access(new URL(`../public${asset}`, import.meta.url))));
});
