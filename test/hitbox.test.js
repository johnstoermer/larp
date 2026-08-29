import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHARACTER_HITBOX } from '../shared/characterHitbox.js';
import { tracePlayer } from '../server/multiplayer/geometry.js';
import { BotController } from '../src/game/BotController.js';
import { Game } from '../src/game/Game.js';

function tracePracticeOpponent(bot, origin, direction, range = 10) {
  return Game.prototype.traceAgainstBot.call(
    {
      arena: { raycast: () => null },
      bot,
    },
    new THREE.Vector3().fromArray(origin),
    new THREE.Vector3().fromArray(direction),
    range,
  );
}

test('practice opponent anchors use the shared authoritative hitbox profile', () => {
  const bot = new BotController(new THREE.Scene(), {}, {});
  bot.position.set(1, 2, 3);

  assert.deepEqual(
    bot.getBodyCenter(new THREE.Vector3()).toArray(),
    [1, 2 + CHARACTER_HITBOX.body.offsetY, 3],
  );
  assert.deepEqual(
    bot.getHeadCenter(new THREE.Vector3()).toArray(),
    [1, 2 + CHARACTER_HITBOX.head.offsetY, 3],
  );
});

test('practice and multiplayer traces agree on forgiving body and head edges', () => {
  const bot = new BotController(new THREE.Scene(), {}, {});
  bot.position.set(0, 0, 5);
  const target = { position: [0, 0, 5], dead: false };
  const cases = [
    {
      name: 'lower body remains hittable',
      origin: [0, 0.3, 10],
      hit: true,
      headshot: false,
    },
    {
      name: 'outer torso is forgiving',
      origin: [0.66, CHARACTER_HITBOX.body.offsetY, 10],
      hit: true,
      headshot: false,
    },
    {
      name: 'outer head is forgiving',
      origin: [0.36, CHARACTER_HITBOX.head.offsetY, 10],
      hit: true,
      headshot: true,
    },
    {
      name: 'shot outside the photographed body still misses',
      origin: [0.7, CHARACTER_HITBOX.body.offsetY, 10],
      hit: false,
      headshot: false,
    },
  ];

  for (const hitCase of cases) {
    const direction = [0, 0, -1];
    const practice = tracePracticeOpponent(bot, hitCase.origin, direction);
    const authority = tracePlayer(0, hitCase.origin, direction, target, 10);
    const practiceHit = practice.kind === 'bot';

    assert.equal(practiceHit, hitCase.hit, `${hitCase.name}: practice`);
    assert.equal(authority.target, hitCase.hit, `${hitCase.name}: authority`);
    assert.equal(Boolean(practice.headshot), hitCase.headshot, hitCase.name);
    assert.equal(authority.headshot, hitCase.headshot, hitCase.name);
    if (hitCase.hit) {
      assert.ok(
        Math.abs(practice.distance - authority.distance) < 1e-8,
        `${hitCase.name}: distance`,
      );
    }
  }
});

test('world cover remains authoritative ahead of the larger character target', () => {
  const result = tracePlayer(
    0,
    [0, CHARACTER_HITBOX.head.offsetY, 5],
    [0, 0, -1],
    { position: [0, 0, -5], dead: false },
    20,
  );

  assert.equal(result.hit, true);
  assert.equal(result.target, false);
  assert.equal(result.headshot, false);
  assert.ok(Math.abs(result.distance - 3.8) < 1e-8);
});
