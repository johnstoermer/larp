import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WAR_MAP, warSpawnForSlot, WAR_TEAM_SIZE } from '../shared/warConfig.js';
import {
  WAR_WEST_COLLIDERS,
  WAR_WEST_FOLIAGE,
  WAR_WEST_LANDMARKS,
  WAR_WEST_NAV_EDGES,
  WAR_WEST_NAV_NODES,
  WAR_WEST_PHOTO_PROPS,
  WAR_WEST_SECTOR,
  WAR_WEST_STRUCTURE_PARTS,
  WAR_WEST_SURFACES,
} from '../shared/warWestSector.js';

const BODY_RADIUS = 0.45;

function horizontalGap(first, second) {
  const gapX = Math.max(first[0] - second[3], second[0] - first[3], 0);
  const gapZ = Math.max(first[2] - second[5], second[2] - first[5], 0);
  return Math.hypot(gapX, gapZ);
}

function pointGap(x, z, bounds) {
  return Math.hypot(
    Math.max(bounds[0] - x, x - bounds[3], 0),
    Math.max(bounds[2] - z, z - bounds[5], 0),
  );
}

function segmentClearsBounds(from, to, bounds, clearance = BODY_RADIUS) {
  const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const steps = Math.max(1, Math.ceil(distance / 0.2));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const x = from[0] + (to[0] - from[0]) * ratio;
    const z = from[2] + (to[2] - from[2]) * ratio;
    if (pointGap(x, z, bounds) < clearance) return false;
  }
  return true;
}

function reachable(adjacency, from, goals) {
  const pending = [from];
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

test('west sector is a dense but data-only LARP battleground module', () => {
  assert.equal(WAR_WEST_SECTOR.id, 'war-west-sector');
  assert.equal(WAR_WEST_SECTOR.northIsNegativeZ, true);
  assert.ok(Object.isFrozen(WAR_WEST_SECTOR));
  assert.ok(Object.isFrozen(WAR_WEST_SECTOR.navigation));
  assert.ok(WAR_WEST_LANDMARKS.length >= 10);
  assert.ok(WAR_WEST_STRUCTURE_PARTS.length >= 60);
  assert.ok(WAR_WEST_STRUCTURE_PARTS.filter((part) => part.solid).length >= 50);
  assert.ok(WAR_WEST_PHOTO_PROPS.length >= 16);
  assert.ok(WAR_WEST_FOLIAGE.length >= 55);
  assert.ok(WAR_WEST_SURFACES.length >= 10);
  assert.ok(WAR_WEST_NAV_NODES.length >= 30);
  assert.ok(WAR_WEST_NAV_EDGES.length >= 40);

  const allIds = [
    ...WAR_WEST_LANDMARKS,
    ...WAR_WEST_STRUCTURE_PARTS,
    ...WAR_WEST_PHOTO_PROPS,
    ...WAR_WEST_FOLIAGE,
    ...WAR_WEST_SURFACES,
    ...WAR_WEST_NAV_NODES,
  ].map((entry) => entry.id);
  assert.equal(new Set(allIds).size, allIds.length, 'sector IDs must be globally unique');
  assert.ok(WAR_WEST_STRUCTURE_PARTS.every((part) => part.position[0] < -24));
});

test('every visible physical piece maps to one valid authority collider', () => {
  const solidParts = WAR_WEST_STRUCTURE_PARTS.filter((part) => part.solid);
  const solidProps = WAR_WEST_PHOTO_PROPS.filter((prop) => prop.solid);
  assert.equal(WAR_WEST_COLLIDERS.length, solidParts.length + solidProps.length);

  for (const bounds of WAR_WEST_COLLIDERS) {
    assert.equal(bounds.length, 6);
    assert.ok(bounds.every(Number.isFinite));
    assert.ok(bounds[0] < bounds[3]);
    assert.ok(bounds[1] < bounds[4]);
    assert.ok(bounds[2] < bounds[5]);
    assert.ok(bounds[0] >= -WAR_MAP.bounds.x);
    assert.ok(bounds[3] <= WAR_MAP.bounds.x);
    assert.ok(bounds[2] >= -WAR_MAP.bounds.z);
    assert.ok(bounds[5] <= WAR_MAP.bounds.z);

    const nearestX = Math.max(bounds[0], Math.min(0, bounds[3]));
    const nearestZ = Math.max(bounds[2], Math.min(0, bounds[5]));
    assert.ok(
      Math.hypot(nearestX, nearestZ) >= WAR_MAP.objective.radius + 3,
      `west cover enters the objective safety ring: ${bounds.join(',')}`,
    );
  }

  for (const part of solidParts) {
    const expected = [
      part.position[0] - part.size[0] / 2,
      part.position[1] - part.size[1] / 2,
      part.position[2] - part.size[2] / 2,
      part.position[0] + part.size[0] / 2,
      part.position[1] + part.size[1] / 2,
      part.position[2] + part.size[2] / 2,
    ];
    assert.deepEqual(part.bounds, expected, part.id);
  }
});

test('west architecture keeps all eighty spawn positions safely clear', () => {
  for (let team = 0; team < 2; team += 1) {
    for (let slot = 0; slot < WAR_TEAM_SIZE; slot += 1) {
      const [x, , z] = warSpawnForSlot(team, slot);
      for (const bounds of WAR_WEST_COLLIDERS) {
        assert.ok(
          pointGap(x, z, bounds) >= 3,
          `team ${team} slot ${slot} spawns ${pointGap(x, z, bounds).toFixed(2)}m from west cover`,
        );
      }
    }
  }
});

test('west prop photographs stand apart from architecture and one another', () => {
  for (const [propIndex, prop] of WAR_WEST_PHOTO_PROPS.entries()) {
    assert.ok(prop.visibleBottomRatio > 0 && prop.visibleBottomRatio < 0.25);
    assert.match(prop.asset, /^\/assets\/larp\/props\/.+\.webp$/);
    const otherBounds = [
      ...WAR_WEST_STRUCTURE_PARTS.filter((part) => part.solid).map((part) => part.bounds),
      ...WAR_WEST_PHOTO_PROPS
        .filter((other, otherIndex) => otherIndex !== propIndex && other.solid)
        .map((other) => other.collisionBounds),
    ];
    for (const bounds of otherBounds) {
      assert.ok(
        horizontalGap(prop.collisionBounds, bounds) >= 0.75,
        `${prop.id} overlaps another solid by architecture clearance rules`,
      );
    }
  }
});

test('all navigation nodes and authored route segments clear combined world cover', () => {
  const nodes = new Map(WAR_WEST_NAV_NODES.map((node) => [node.id, node]));
  const combinedCover = [...WAR_MAP.colliders.slice(5), ...WAR_WEST_COLLIDERS];
  for (const node of nodes.values()) {
    for (const bounds of combinedCover) {
      assert.ok(
        pointGap(node.position[0], node.position[2], bounds) >= node.clearance,
        `${node.id} is inside or too close to ${bounds.join(',')}`,
      );
    }
  }

  for (const edge of WAR_WEST_NAV_EDGES) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    assert.ok(from, `${edge.from} edge endpoint is missing`);
    assert.ok(to, `${edge.to} edge endpoint is missing`);
    for (const bounds of combinedCover) {
      assert.ok(
        segmentClearsBounds(from.position, to.position, bounds),
        `${edge.from} -> ${edge.to} intersects ${bounds.join(',')}`,
      );
    }
  }
});

test('both spawn entries can reach objective entries through a connected three-lane graph', () => {
  const adjacency = new Map();
  for (const edge of WAR_WEST_NAV_EDGES) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    if (edge.bidirectional) adjacency.get(edge.to).push(edge.from);
  }
  const objectives = new Set(WAR_WEST_SECTOR.navigation.objectiveEntryNodeIds);
  for (const spawnId of WAR_WEST_SECTOR.navigation.spawnEntryNodeIds) {
    assert.ok(reachable(adjacency, spawnId, objectives), `${spawnId} cannot reach the point`);
  }

  for (const laneId of WAR_WEST_SECTOR.navigation.laneIds) {
    const laneEdges = WAR_WEST_NAV_EDGES.filter((edge) => edge.tags.includes(laneId));
    assert.ok(laneEdges.length >= 5, `${laneId} is not a continuous long route`);
  }
  assert.ok(
    WAR_WEST_NAV_EDGES.filter((edge) => edge.tags.includes('crossroad')).length >= 12,
    'bots need frequent escape routes instead of one funnel',
  );
});

test('west sector references only existing transparent-style raster families', async () => {
  const assets = new Set([
    ...WAR_WEST_PHOTO_PROPS.map((prop) => prop.asset),
    ...WAR_WEST_FOLIAGE.map((item) => item.asset),
  ]);
  for (const asset of assets) {
    const absolute = fileURLToPath(new URL(`../public${asset}`, import.meta.url));
    await access(absolute);
  }
  assert.ok(WAR_WEST_SECTOR.optionalAssetNeeds.length >= 4);
  assert.ok(WAR_WEST_SECTOR.optionalAssetNeeds.every((need) => need.priority === 'later'));
});
