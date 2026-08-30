import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BotController,
  FIGHTER_ANIMATION_STATES,
  FIGHTER_WALK_SPEED_THRESHOLD,
  fighterTextureUrl,
  selectFighterState,
} from '../src/game/BotController.js';
import { RemotePlayer } from '../src/game/RemotePlayer.js';
import { WEAPONS } from '../src/game/weapons.js';

test('every weapon and fighter state maps to one canonical cutout', () => {
  const urls = Object.keys(WEAPONS).flatMap((weapon) =>
    FIGHTER_ANIMATION_STATES.map((state) => fighterTextureUrl(weapon, state)));

  assert.equal(urls.length, 40);
  assert.equal(new Set(urls).size, 40);
  assert.equal(
    fighterTextureUrl('knives', 'hit'),
    '/assets/larp/fighters/throwing-knives-hit.webp',
  );
  assert.equal(
    fighterTextureUrl('fireball', 'death'),
    '/assets/larp/fighters/fireball-tome-death.webp',
  );
  assert.equal(
    fighterTextureUrl('unknown', 'unknown'),
    '/assets/larp/fighters/throwing-knives-idle.webp',
  );
});

test('fighter presentation signals use deterministic state precedence', () => {
  assert.equal(selectFighterState(), 'idle');
  assert.equal(selectFighterState({ speed: FIGHTER_WALK_SPEED_THRESHOLD }), 'idle');
  assert.equal(selectFighterState({ speed: FIGHTER_WALK_SPEED_THRESHOLD + 0.01 }), 'walk');
  assert.equal(selectFighterState({ speed: 4, attackTime: 0.1 }), 'attack');
  assert.equal(
    selectFighterState({ speed: 4, attackTime: 0.1, flashHit: 0.1 }),
    'hit',
  );
  assert.equal(
    selectFighterState({ dead: true, speed: 4, attackTime: 0.1, flashHit: 0.1 }),
    'death',
  );
});

test('lethal damage keeps a readable death cutout visible until reset', () => {
  const scene = new THREE.Scene();
  const bot = new BotController(scene, {}, {});

  assert.equal(bot.damage(100), 100);
  assert.equal(bot.dead, true);
  assert.equal(bot.root.visible, true);
  assert.equal(bot.healthBar.name, 'character-health-bar');
  assert.equal(bot.healthBar.userData.ratio, 0);
  assert.equal(bot.healthBar.userData.fillPixels, 0);
  assert.equal(bot.healthBar.isSprite, true);
  assert.equal(bot.healthBar.children.length, 0);
  assert.equal(bot.fighterState, 'death');
  assert.equal(bot.sprite.userData.state, 'death');
  assert.ok(bot.spriteMaterial.map.name !== 'missing');

  bot.animate(3, null, false);
  assert.equal(bot.fighterState, 'death');
  assert.equal(bot.root.visible, true);

  bot.reset(new THREE.Vector3(1, 0, 2), 0.4);
  assert.equal(bot.dead, false);
  assert.equal(bot.fighterState, 'idle');
  assert.equal(bot.root.visible, true);
  assert.equal(bot.healthBar.userData.ratio, 1);
  assert.equal(
    bot.healthBar.userData.fillPixels,
    bot.healthBar.userData.fillCapacity,
  );
});

test('remote authoritative hit and death snapshots select poses without hiding', () => {
  const bot = new BotController(new THREE.Scene(), {}, {});
  const remote = new RemotePlayer(bot);
  remote.reset([0, 0, 0], 0, 'crossbow');

  remote.applyImmediate({
    position: [0, 0, 0],
    health: 72,
    dead: false,
    weapon: 'crossbow',
    ammo: 1,
    reserve: 8,
    reloading: false,
  });
  assert.equal(bot.fighterState, 'hit');
  assert.equal(bot.root.visible, true);

  remote.applyImmediate({
    position: [0, 0, 0],
    health: 0,
    dead: true,
    weapon: 'crossbow',
    ammo: 0,
    reserve: 8,
    reloading: false,
  });
  assert.equal(bot.fighterState, 'death');
  assert.equal(bot.root.visible, true);
});
