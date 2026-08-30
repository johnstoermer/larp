import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import {
  TITLE_ATTRACT_ROSTER,
  TitleAttractBattle,
} from '../src/game/TitleAttractBattle.js';

function createVfxProbe() {
  const calls = [];
  const record = (type) => (...args) => calls.push({ type, args });
  return {
    calls,
    clear: record('clear'),
    spawnPhotoEffect: record('photo'),
    spawnMuzzle: record('muzzle'),
    spawnFlyingProp: record('projectile'),
    spawnTracer: record('tracer'),
    spawnBloodImpact: record('hit'),
    spawnDamageNumber: record('damage-number'),
    spawnDeathBurst: record('death'),
  };
}

function runFor(battle, seconds) {
  const steps = Math.round(seconds * 60);
  for (let step = 0; step < steps; step += 1) battle.update(1 / 60);
}

function normalizedSnapshot(snapshot) {
  return {
    stats: snapshot.stats,
    actors: snapshot.actors.map((actor) => ({
      ...actor,
      position: actor.position.map((value) => Number(value.toFixed(6))),
      velocity: actor.velocity.map((value) => Number(value.toFixed(6))),
    })),
  };
}

test('title attract roster uses several distinct real fighter identities', () => {
  assert.ok(TITLE_ATTRACT_ROSTER.length >= 4);
  assert.equal(
    new Set(TITLE_ATTRACT_ROSTER.map((fighter) => fighter.id)).size,
    TITLE_ATTRACT_ROSTER.length,
  );
  assert.equal(
    new Set(TITLE_ATTRACT_ROSTER.map((fighter) => fighter.weapon)).size,
    TITLE_ATTRACT_ROSTER.length,
  );
  assert.deepEqual(
    TITLE_ATTRACT_ROSTER.map((fighter) => fighter.weapon),
    ['greatsword', 'shortbow', 'lightning', 'ember'],
  );
});

test('title attract battle moves, targets, attacks, dies and respawns deterministically', () => {
  const firstVfx = createVfxProbe();
  const first = new TitleAttractBattle(new THREE.Scene(), {}, firstVfx);
  first.start();
  const initial = first.snapshot();
  runFor(first, 7);
  const after = first.snapshot();

  assert.equal(after.active, true);
  assert.equal(after.actors.length, TITLE_ATTRACT_ROSTER.length);
  assert.ok(after.actors.every((actor) => actor.visible));
  assert.ok(after.stats.targetingSteps > 0, 'living fighters should select targets');
  assert.ok(
    after.actors.some((actor, index) =>
      actor.position.some((value, axis) => Math.abs(value - initial.actors[index].position[axis]) > 0.2)),
    'at least one title fighter should visibly move',
  );
  assert.ok(after.stats.attacks >= 8, `only ${after.stats.attacks} attacks occurred`);
  assert.ok(after.stats.hits >= 8, `only ${after.stats.hits} hits occurred`);
  assert.ok(after.stats.deaths >= 1, 'the battle should reach a death pose');
  assert.ok(after.stats.respawns >= 1, 'dead fighters should loop back into the battle');
  for (const state of ['walk', 'attack', 'hit', 'death']) {
    assert.ok(after.stats.observedStates.includes(state), `${state} was never presented`);
  }
  assert.ok(firstVfx.calls.some((call) => call.type === 'projectile'));
  assert.ok(firstVfx.calls.some((call) => call.type === 'tracer'));
  assert.ok(firstVfx.calls.some((call) => call.type === 'death'));

  const second = new TitleAttractBattle(new THREE.Scene(), {}, createVfxProbe());
  second.start();
  runFor(second, 7);
  assert.deepEqual(
    normalizedSnapshot(second.snapshot()),
    normalizedSnapshot(after),
    'the fixed-step title battle should produce the same combat and positions each run',
  );
});

test('stopping and restarting title combat hides and resets every attract actor', () => {
  const vfx = createVfxProbe();
  const battle = new TitleAttractBattle(new THREE.Scene(), {}, vfx);
  battle.start();
  runFor(battle, 3.5);
  const previousSession = battle.snapshot().session;
  battle.stop();
  const stopped = battle.snapshot();
  assert.equal(stopped.active, false);
  assert.ok(stopped.actors.every((actor) => !actor.visible));
  assert.equal(vfx.calls.at(-1)?.type, 'clear');

  runFor(battle, 1);
  assert.deepEqual(battle.snapshot(), stopped, 'inactive title actors must not mutate match state');

  battle.start();
  const restarted = battle.snapshot();
  assert.equal(restarted.session, previousSession + 1);
  assert.equal(restarted.time, 0);
  assert.deepEqual(restarted.stats, {
    attacks: 0,
    hits: 0,
    deaths: 0,
    respawns: 0,
    targetingSteps: 0,
    observedStates: ['idle'],
  });
  assert.ok(restarted.actors.every((actor) => actor.visible && actor.health === 100 && !actor.dead));
});

test('home screen has no cover treatment or secondary controls window', () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const titleRules = [...styles.matchAll(/#title-screen\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(titleRules.length > 0);
  for (const declarations of titleRules) assert.doesNotMatch(declarations, /cover\.webp/i);
  assert.doesNotMatch(html, /class="title-controls\b/);
  assert.match(html, /class="title-copy window"/);
});
