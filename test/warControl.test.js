import test from 'node:test';
import assert from 'node:assert/strict';
import { WarControl } from '../server/multiplayer/WarControl.js';

const rules = Object.freeze({
  unlockMs: 1_000,
  captureMs: 1_000,
  scorePerSecond: 10,
  scoreToWin: 100,
  overtimeThreshold: 99,
  overtimeGraceMs: 500,
});

function advance(control, from, to, occupancy, step = 100) {
  let state;
  for (let now = from + step; now <= to; now += step) {
    state = control.update(now, occupancy);
  }
  return state;
}

test('the point starts locked and neutral capture pauses while contested', () => {
  const control = new WarControl({ now: 0, rules });
  let state = control.update(900, [4, 0]);
  assert.equal(state.phase, 'locked');
  assert.equal(state.owner, null);
  assert.equal(state.captureProgress, 0);

  state = control.update(1_000, [4, 4]);
  assert.equal(state.phase, 'control');
  assert.equal(state.contested, true);
  assert.equal(state.captureProgress, 0);

  state = advance(control, 1_000, 1_500, [4, 0]);
  assert.equal(state.captureTeam, 0);
  assert.equal(state.captureProgress, 50);
  state = advance(control, 1_500, 2_000, [4, 2]);
  assert.equal(state.contested, true);
  assert.equal(state.captureProgress, 50);
  state = advance(control, 2_000, 2_500, [4, 0]);
  assert.equal(state.owner, 0);
  assert.equal(state.captureProgress, 0);
});

test('an owner scores while holding and the enemy must clear and capture to take over', () => {
  const control = new WarControl({ now: 0, rules });
  control.update(1_000, [1, 0]);
  advance(control, 1_000, 2_000, [1, 0]);
  assert.equal(control.owner, 0);

  let state = advance(control, 2_000, 3_000, [2, 0]);
  assert.equal(state.scores[0], 10);
  state = advance(control, 3_000, 3_500, [2, 3]);
  assert.equal(state.owner, 0);
  assert.equal(state.captureProgress, 0);
  assert.equal(state.scores[0], 15);

  state = advance(control, 3_500, 4_000, [0, 3]);
  assert.equal(state.captureTeam, 1);
  assert.equal(state.captureProgress, 50);
  state = advance(control, 4_000, 4_500, [2, 0]);
  assert.equal(state.owner, 0);
  assert.equal(state.captureProgress, 0, 'defenders clear the takeover progress');
  state = advance(control, 4_500, 5_500, [0, 3]);
  assert.equal(state.owner, 1);
  assert.equal(state.captureProgress, 0);
  assert.equal(state.scores[0], 35);
});

test('99 percent plus a contest starts overtime and re-entry resets its grace', () => {
  const control = new WarControl({ now: 0, rules });
  control.update(1_000, [1, 0]);
  advance(control, 1_000, 2_000, [1, 0]);
  advance(control, 2_000, 11_900, [1, 0]);
  assert.equal(control.scores[0], 99);

  let state = control.update(12_000, [1, 1]);
  assert.equal(state.scores[0], 100);
  assert.equal(state.overtime, true);
  assert.equal(state.winner, null);

  state = control.update(12_100, [1, 0]);
  assert.equal(state.overtime, true);
  assert.equal(state.overtimeGraceRemaining, 500);
  state = control.update(12_400, [1, 1]);
  assert.equal(state.overtime, true);
  assert.equal(state.overtimeGraceRemaining, 0);
  state = control.update(12_500, [1, 0]);
  assert.equal(state.overtimeGraceRemaining, 500);
  state = control.update(12_999, [1, 0]);
  assert.equal(state.overtime, true);
  assert.equal(state.winner, null);
  state = control.update(13_000, [1, 0]);
  assert.equal(state.overtime, false);
  assert.equal(state.phase, 'result');
  assert.equal(state.winner, 0);
});

test('a valid overtime takeover clears overtime without awarding the former owner', () => {
  const control = new WarControl({ now: 0, rules });
  control.update(1_000, [1, 0]);
  advance(control, 1_000, 2_000, [1, 0]);
  advance(control, 2_000, 12_000, [1, 1]);
  assert.equal(control.scores[0], 100);
  assert.equal(control.overtime, true);

  const state = advance(control, 12_000, 13_000, [0, 2]);
  assert.equal(state.owner, 1);
  assert.equal(state.overtime, false);
  assert.equal(state.phase, 'control');
  assert.equal(state.winner, null);
  assert.equal(state.scores[0], 100);
});

test('control snapshots expose only plain round state', () => {
  const control = new WarControl({ now: 50, rules });
  const snapshot = control.snapshot(100, [2, 1]);
  assert.deepEqual(Object.keys(snapshot), [
    'phase',
    'unlockRemaining',
    'owner',
    'captureTeam',
    'captureProgress',
    'scores',
    'occupancy',
    'contested',
    'overtime',
    'overtimeGraceRemaining',
    'winner',
  ]);
  assert.deepEqual(snapshot.occupancy, [2, 1]);
});
