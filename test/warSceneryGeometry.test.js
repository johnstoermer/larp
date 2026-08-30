import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXED_PHOTO_PROP_PLANE_DEPTH,
  FIXED_PHOTO_PROP_QUARTER_TURN,
  fixedPhotoPropCollisionBounds,
  quantizeFixedPhotoPropYaw,
  rotatedFootprintBounds,
  rotatedFootprintExtents,
} from '../shared/warSceneryGeometry.js';

const approximately = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('rotated prop footprints preserve cardinal local dimensions', () => {
  assert.deepEqual(rotatedFootprintExtents(4, 2, 0), [4, 2]);
  const quarterTurn = rotatedFootprintExtents(4, 2, Math.PI / 2);
  approximately(quarterTurn[0], 2);
  approximately(quarterTurn[1], 4);
  const bounds = rotatedFootprintBounds([10, 0, -7], 4, 2, 3, Math.PI / 2);
  for (const [actual, expected] of bounds.map((value, index) => [
    value,
    [9, 0, -9, 11, 3, -5][index],
  ])) approximately(actual, expected);
});

test('angled prop footprints use the enclosing rotated AABB', () => {
  const [extentX, extentZ] = rotatedFootprintExtents(4, 2, Math.PI / 4);
  approximately(extentX, 3 * Math.SQRT2);
  approximately(extentZ, 3 * Math.SQRT2);
  const bounds = rotatedFootprintBounds([2, 1, 3], 4, 2, 2.5, Math.PI / 4);
  approximately(bounds[0], 2 - 1.5 * Math.SQRT2);
  approximately(bounds[1], 1);
  approximately(bounds[2], 3 - 1.5 * Math.SQRT2);
  approximately(bounds[3], 2 + 1.5 * Math.SQRT2);
  approximately(bounds[4], 3.5);
  approximately(bounds[5], 3 + 1.5 * Math.SQRT2);
});

test('fixed photo prop collisions are yawed eight-centimetre planes', () => {
  assert.equal(FIXED_PHOTO_PROP_PLANE_DEPTH, 0.08);
  assert.equal(FIXED_PHOTO_PROP_QUARTER_TURN, Math.PI / 2);
  assert.equal(quantizeFixedPhotoPropYaw(0.74), 0);
  assert.equal(quantizeFixedPhotoPropYaw(0.8), Math.PI / 2);
  assert.equal(quantizeFixedPhotoPropYaw(-0.8), -Math.PI / 2);
  assert.equal(quantizeFixedPhotoPropYaw(Number.NaN), 0);
  assert.deepEqual(
    fixedPhotoPropCollisionBounds([3, 0, -2], 6, 2.5, 0),
    [0, 0, -2.04, 6, 2.5, -1.96],
  );
  const quarterTurn = fixedPhotoPropCollisionBounds(
    [3, 0, -2],
    6,
    2.5,
    Math.PI / 2,
  );
  approximately(quarterTurn[0], 2.96);
  approximately(quarterTurn[2], -5);
  approximately(quarterTurn[3], 3.04);
  approximately(quarterTurn[5], 1);

  const formerlyAngled = fixedPhotoPropCollisionBounds(
    [0, 0, 0],
    5.5,
    2,
    Math.PI / 4,
  );
  approximately(
    Math.min(
      formerlyAngled[3] - formerlyAngled[0],
      formerlyAngled[5] - formerlyAngled[2],
    ),
    FIXED_PHOTO_PROP_PLANE_DEPTH,
  );
});
