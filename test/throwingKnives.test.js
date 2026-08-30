import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from '../src/game/Interface.js';
import { PlayerController } from '../src/game/PlayerController.js';
import { WEAPONS as CLIENT_WEAPONS } from '../src/game/weapons.js';
import { Room } from '../server/multiplayer/Room.js';
import { WEAPONS as SERVER_WEAPONS } from '../server/multiplayer/config.js';
import { directionFromAngles } from '../server/multiplayer/geometry.js';
import { WarRoom } from '../server/multiplayer/WarRoom.js';
import { WAR_CLASSES } from '../shared/warConfig.js';

function createSession(name) {
  const messages = [];
  return {
    token: `${name}-token`,
    name,
    room: null,
    slot: null,
    messages,
    send(message) {
      messages.push(message);
    },
  };
}

function classListProbe() {
  const values = new Set();
  return {
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function element() {
  return {
    textContent: '',
    dataset: {},
    style: { width: '' },
    classList: classListProbe(),
    setAttribute() {},
  };
}

test('held primary repeatedly requests knife throws at the one-second cadence', () => {
  const controller = Object.assign(Object.create(PlayerController.prototype), {
    inputEnabled: true,
    dead: false,
    weaponType: 'knives',
    buttons: new Set([0]),
    buttonPressed: new Set(),
    reloading: false,
    ammo: 0,
    lastShotAt: 10,
  });

  assert.equal(controller.wantsToFire(), true);
  assert.equal(controller.wantsToFire(), true, 'held input survives the pressed-edge clear');
  assert.equal(controller.canFire(10.999), false);
  assert.equal(controller.canFire(11), true);

  controller.weaponType = 'crossbow';
  assert.equal(controller.wantsToFire(), false, 'semi-automatic weapons still require a new press');
});

test('knife balance and ammo-free behavior match Arena client, Arena server, and War', () => {
  const client = CLIENT_WEAPONS.knives;
  const server = SERVER_WEAPONS.knives;
  const war = WAR_CLASSES.knives;

  assert.equal(client.damage, 16);
  assert.ok(client.damage < 28);
  assert.equal(client.interval, 1);
  assert.equal(client.automatic, true);
  assert.equal(client.usesAmmo, false);
  assert.equal(client.ammo, 1);
  assert.equal(client.reserve, 0);
  assert.equal(client.reloadMs, 0);

  for (const definition of [server, war]) {
    assert.equal(definition.damage, client.damage);
    assert.equal(definition.usesAmmo, false);
    assert.equal(definition.ammo, client.ammo);
    assert.equal(definition.reserve, client.reserve);
    assert.equal(definition.reloadMs, client.reloadMs);
  }
  assert.equal(server.interval, client.interval);
  assert.equal(war.attackMs, client.interval * 1_000);
});

test('Arena authority accepts repeated knife throws without ammo or reload state', () => {
  const first = createSession('Arena knife');
  const second = createSession('Arena target');
  const room = new Room({ sessions: [first, second], now: 20_000 });
  room.phase = 'playing';
  const player = room.players[0];
  player.weapon = 'knives';
  player.ammo = 0;
  player.reserve = 7;
  player.lastShotAt = -Infinity;
  const shot = (shotId, now) => room.handleShot(first, {
    shotId,
    yaw: player.yaw,
    pitch: player.pitch,
    direction: directionFromAngles(player.yaw, player.pitch),
  }, now);

  shot(1, 20_000);
  shot(2, 20_879);
  assert.equal(player.lastShotId, 1, 'server rejects input faster than knife cadence');
  shot(2, 21_000);
  room.handleReload(first, 21_100);

  assert.equal(player.lastShotId, 2);
  assert.equal(player.ammo, 0);
  assert.equal(player.reserve, 7);
  assert.equal(player.reloadEndsAt, Infinity);
  assert.equal(first.messages.filter((message) => message.event === 'shot').length, 2);
  assert.equal(first.messages.some((message) => message.event === 'reload_start'), false);
});

test('War authority applies the same held, ammo-free knife cadence', () => {
  const session = createSession('War knife');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['knives'],
    now: 30_000,
    seed: 91,
  });
  const player = room.playerForSession(session);
  player.position = [0, 0.02, 10];
  player.yaw = 0;
  player.pitch = 0;
  player.ammo = 0;
  player.reserve = 7;
  player.lastAttackAt = -Infinity;
  const shot = (shotId, now) => room.handleShot(session, {
    shotId,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, now);

  assert.equal(shot(1, 30_000), true);
  assert.equal(shot(2, 30_999), false);
  assert.equal(shot(2, 31_000), true);
  assert.equal(room.handleReload(session, 31_100), false);
  assert.equal(player.lastShotId, 2);
  assert.equal(player.ammo, 0);
  assert.equal(player.reserve, 7);
  assert.equal(player.reloadEndsAt, Infinity);
});

test('Arena and War HUDs hide knife ammunition and never show an empty crosshair', () => {
  const arenaUi = {
    playerRounds: element(),
    botRounds: element(),
    playerTakes: element(),
    botTakes: element(),
    roundLabel: element(),
    timer: element(),
    healthValue: element(),
    healthFill: element(),
    healthPanel: element(),
    ammoValue: element(),
    ammoReserve: element(),
    crosshair: element(),
    setTakes: Interface.prototype.setTakes,
  };
  Interface.prototype.updateHUD.call(arenaUi, {
    playerRounds: 0,
    botRounds: 0,
    playerTakes: 0,
    botTakes: 0,
    roundNumber: 1,
    overtime: false,
    takeTime: 30,
  }, {
    definition: CLIENT_WEAPONS.knives,
    health: 100,
    ammo: 0,
    reserve: 0,
    focused: false,
  }, null, null, {});

  assert.equal(arenaUi.healthPanel.classList.contains('ammo-free'), true);
  assert.equal(arenaUi.ammoValue.textContent, '');
  assert.equal(arenaUi.ammoReserve.textContent, '');
  assert.equal(arenaUi.crosshair.classList.contains('empty'), false);

  const warUi = {
    warRedScore: element(),
    warBlueScore: element(),
    roundLabel: element(),
    timer: element(),
    warCapture: element(),
    warCaptureFill: element(),
    healthValue: element(),
    healthFill: element(),
    healthPanel: element(),
    ammoValue: element(),
    ammoReserve: element(),
    crosshair: element(),
    setWarMatch() {},
  };
  Interface.prototype.updateWarHUD.call(warUi, {
    scores: [0, 0],
    phase: 'locked',
    unlockRemaining: 15_000,
  }, {
    maxHealth: WAR_CLASSES.knives.health,
    health: WAR_CLASSES.knives.health,
    usesAmmo: false,
    ammo: 0,
    reserve: 0,
    focused: false,
  }, 0);

  assert.equal(warUi.healthPanel.classList.contains('ammo-free'), true);
  assert.equal(warUi.ammoValue.textContent, '');
  assert.equal(warUi.ammoReserve.textContent, '');
  assert.equal(warUi.crosshair.classList.contains('empty'), false);
});
