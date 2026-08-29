import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { WEAPONS } from '../src/game/weapons.js';

function emptyWeaponGame({ weapon = 'crossbow', reserve = 3 } = {}) {
  const calls = {
    reload: [],
    dryFire: 0,
    network: [],
    notices: [],
  };
  const definition = WEAPONS[weapon];
  const game = Object.create(Game.prototype);
  game.elapsed = 12;
  game.player = {
    definition,
    ammo: 0,
    reserve,
    reloading: false,
    canFire: () => false,
    startReload(serverControlled) {
      calls.reload.push(serverControlled);
      if (
        this.reloading ||
        definition.usesAmmo === false ||
        this.ammo >= definition.ammo ||
        this.reserve <= 0
      ) {
        return false;
      }
      this.reloading = true;
      return true;
    },
    dryFire() {
      calls.dryFire += 1;
      return true;
    },
  };
  game.network = {
    send(message) {
      calls.network.push(message);
    },
  };
  game.ui = {
    showPickup(message) {
      calls.notices.push(message);
    },
  };
  return { game, calls };
}

test('firing an empty weapon starts a local practice reload', () => {
  const { game, calls } = emptyWeaponGame();

  game.firePlayerWeapon();

  assert.deepEqual(calls.reload, [false]);
  assert.equal(game.player.reloading, true);
  assert.equal(calls.dryFire, 0);
  assert.deepEqual(calls.notices, ['RELOADING']);
  assert.deepEqual(calls.network, []);
});

test('firing an empty weapon online requests an authoritative reload', () => {
  const { game, calls } = emptyWeaponGame();

  game.fireOnlineWeapon();

  assert.deepEqual(calls.reload, [true]);
  assert.equal(game.player.reloading, true);
  assert.equal(calls.dryFire, 0);
  assert.deepEqual(calls.notices, ['RELOADING']);
  assert.deepEqual(calls.network, [{ type: 'reload' }]);
});

test('ammo-free bows and greatsword never auto-reload', () => {
  for (const weapon of ['shortbow', 'longbow', 'greatsword']) {
    const { game, calls } = emptyWeaponGame({ weapon, reserve: 8 });

    game.firePlayerWeapon();
    game.fireOnlineWeapon();

    assert.deepEqual(calls.reload, [], weapon);
    assert.deepEqual(calls.network, [], weapon);
    assert.equal(game.player.reloading, false, weapon);
  }
});

test('an exhausted reserve keeps the dry-fire fallback', () => {
  const { game, calls } = emptyWeaponGame({ reserve: 0 });

  game.firePlayerWeapon();

  assert.deepEqual(calls.reload, [false]);
  assert.equal(game.player.reloading, false);
  assert.equal(calls.dryFire, 1);
  assert.deepEqual(calls.notices, []);
});
