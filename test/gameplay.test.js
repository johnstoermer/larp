import test from 'node:test';
import assert from 'node:assert/strict';
import {
  circleLineIntersection,
  formatTime,
  moveToward,
  seededRandom,
  shuffle,
} from '../src/game/math.js';

test('formatTime rounds up active take time and clamps below zero', () => {
  assert.equal(formatTime(44.1), '00:45');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(-2), '00:00');
  assert.equal(formatTime(61), '01:01');
});

test('moveToward never overshoots its target', () => {
  assert.equal(moveToward(0, 10, 3), 3);
  assert.equal(moveToward(10, 0, 3), 7);
  assert.equal(moveToward(9, 10, 3), 10);
});

test('seededRandom and shuffle are deterministic', () => {
  const first = shuffle([1, 2, 3, 4, 5], seededRandom(41));
  const second = shuffle([1, 2, 3, 4, 5], seededRandom(41));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, [1, 2, 3, 4, 5]);
});

test('circleLineIntersection returns the nearest forward contact', () => {
  const distance = circleLineIntersection(
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 5, z: 0 },
    1,
  );
  assert.equal(distance, 4);
  assert.equal(
    circleLineIntersection(
      { x: 0, z: 0 },
      { x: -1, z: 0 },
      { x: 5, z: 0 },
      1,
    ),
    null,
  );
});
