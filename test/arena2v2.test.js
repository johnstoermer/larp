import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MultiplayerHub } from '../server/multiplayer/Hub.js';
import { Room } from '../server/multiplayer/Room.js';
import { WEAPONS } from '../server/multiplayer/config.js';
import { directionFromAngles } from '../server/multiplayer/geometry.js';
import { arenaResumeCounters } from '../src/game/Game.js';
import {
  ARENA_2V2_COMBATANT_COUNT,
  ARENA_2V2_MODE,
  arena2v2TeamForSlot,
  arena2v2TeamSlot,
} from '../shared/arena2v2Config.js';

const rules = {
  roundIntroMs: 10,
  countdownMs: 10,
  takeMs: 1_000,
  takeEndMs: 10,
  roundEndMs: 10,
  loadTimeoutMs: 50,
  reconnectMs: 40,
};

function session(name, { bot = false } = {}) {
  const messages = [];
  return {
    token: `${name}-token`,
    name,
    bot,
    connected: !bot,
    room: null,
    slot: null,
    team: null,
    queued: false,
    privateCode: null,
    messages,
    send(message) {
      messages.push(message);
    },
    sendEncoded(encoded) {
      messages.push(JSON.parse(encoded));
    },
  };
}

function createRoom(now = 1_000) {
  return new Room({
    sessions: [
      session('Local'),
      session('Bot 2', { bot: true }),
      session('Bot 3', { bot: true }),
      session('Bot 4', { bot: true }),
    ],
    teamMode: true,
    rules,
    now,
  });
}

function setOpenFormation(room) {
  room.players[0].position = [-0.65, 0.02, 6];
  room.players[2].position = [0.65, 0.02, 6];
  room.players[1].position = [-0.65, 0.02, 3];
  room.players[3].position = [0.65, 0.02, 3];
  for (const player of room.players) {
    player.history = [{ at: 2_000, position: [...player.position] }];
    player.health = 100;
    player.dead = false;
  }
}

test('Arena 2v2 has two fixed teams of two and bots fill open slots', () => {
  const room = createRoom();
  assert.equal(room.mode, ARENA_2V2_MODE);
  assert.equal(room.players.length, ARENA_2V2_COMBATANT_COUNT);
  assert.deepEqual(room.players.map(({ team }) => team), [0, 1, 0, 1]);
  assert.deepEqual(room.players.map(({ teamSlot }) => teamSlot), [0, 0, 1, 1]);
  assert.equal(room.connectedHumans().length, 1);
  assert.equal(room.players.filter(({ bot }) => bot).length, 3);
  assert.deepEqual(
    room.players.map(({ slot }) => [arena2v2TeamForSlot(slot), arena2v2TeamSlot(slot)]),
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  );
  const found = room.players[0].session.messages.find(
    (message) => message.type === 'match_found',
  );
  assert.equal(found.mode, ARENA_2V2_MODE);
  assert.equal(found.team, 0);
  assert.equal(found.snapshot.players.length, 4);
});

test('new humans replace bots in balanced team order including slots 2 and 3', () => {
  const room = createRoom();
  const second = session('Second');
  const third = session('Third');
  const fourth = session('Fourth');
  assert.equal(room.addSession(second, 1_010).slot, 1);
  assert.equal(room.addSession(third, 1_020).slot, 2);
  assert.equal(room.addSession(fourth, 1_030).slot, 3);
  assert.deepEqual(room.getSummary().teamHumans, [2, 2]);
  assert.equal(room.canJoin(1_040), false);
});

test('one death does not end a 2v2 take; eliminating both teammates does', () => {
  const room = createRoom();
  room.phase = 'playing';
  room.players[1].dead = true;
  room.players[1].health = 0;
  room.resolveDeaths(2_000);
  assert.equal(room.phase, 'playing');
  room.players[3].dead = true;
  room.players[3].health = 0;
  room.resolveDeaths(2_010);
  assert.equal(room.phase, 'takeEnd');
  assert.deepEqual(room.takes, [1, 0]);
});

test('team hitscan cannot hurt an ally and credits an assisting teammate', () => {
  const room = createRoom();
  room.phase = 'playing';
  setOpenFormation(room);
  const shooter = room.players[0];
  const ally = room.players[2];
  const target = room.players[1];
  shooter.weapon = 'crossbow';
  shooter.ammo = WEAPONS.crossbow.ammo;
  shooter.yaw = 0;
  shooter.pitch = 0;

  room.handleShot(shooter.session, {
    shotId: 1,
    direction: directionFromAngles(0, 0),
    yaw: 0,
    pitch: 0,
  }, 2_100);

  assert.equal(ally.health, 100);
  assert.ok(target.health < 100);
  target.damageContributors.clear();
  room.recordDamageSource(target, 0, 1, 2_200);
  room.recordDamageSource(target, 2, 1, 2_210);
  target.health = 0;
  target.dead = true;
  room.creditDeaths(2_220);
  assert.equal(room.players[2].kills, 1);
  assert.equal(room.players[0].assists, 1);
});

test('greatsword broad arc can hit both enemies but never the ally', () => {
  const room = createRoom();
  room.phase = 'playing';
  setOpenFormation(room);
  const shooter = room.players[0];
  shooter.position = [0, 0.02, 6];
  room.players[2].position = [0, 0.02, 4.6];
  room.players[1].position = [-0.75, 0.02, 3.6];
  room.players[3].position = [0.75, 0.02, 3.6];
  shooter.weapon = 'greatsword';
  shooter.ammo = WEAPONS.greatsword.ammo;
  shooter.yaw = 0;
  shooter.pitch = 0;

  room.handleShot(shooter.session, {
    shotId: 1,
    direction: directionFromAngles(0, 0),
    yaw: 0,
    pitch: 0,
  }, 2_100);

  assert.equal(room.players[2].health, 100);
  assert.ok(room.players[1].health < 100);
  assert.ok(room.players[3].health < 100);
  const shot = shooter.session.messages.filter(
    (message) => message.event === 'shot' && message.shooter === shooter.slot,
  ).at(-1);
  assert.deepEqual(shot.hits.map(({ target }) => target).sort(), [1, 3]);
});

test('splash damage excludes allies and reports each damaged enemy', () => {
  const room = createRoom();
  room.phase = 'playing';
  setOpenFormation(room);
  const owner = room.players[0];
  const ally = room.players[2];
  const enemy = room.players[1];
  owner.position = [-1, 0.02, 5];
  ally.position = [0, 0.02, 5];
  enemy.position = [1, 0.02, 5];
  room.explodeProjectile({ owner: 0, weapon: 'fireball', id: 1 }, [0, 1, 5], 2_000);
  assert.equal(ally.health, 100);
  assert.ok(owner.health < 100, 'the owner keeps normal self-damage');
  assert.ok(enemy.health < 100);
});

test('join-in-progress snapshots carry active projectiles for client reconciliation', () => {
  const room = createRoom();
  room.phase = 'playing';
  setOpenFormation(room);
  const shooter = room.players[0];
  shooter.weapon = 'fireball';
  shooter.ammo = WEAPONS.fireball.ammo;
  shooter.yaw = 0;
  shooter.pitch = 0.8;
  room.handleShot(shooter.session, {
    shotId: 1,
    direction: directionFromAngles(shooter.yaw, shooter.pitch),
    yaw: shooter.yaw,
    pitch: shooter.pitch,
  }, 2_100);
  assert.equal(room.createSnapshot(2_110).projectiles.length, 1);

  const joining = session('Joining');
  room.addSession(joining, 2_120);
  const found = joining.messages.find((message) => message.type === 'match_found');
  assert.equal(found.snapshot.projectiles.length, 1);
  assert.equal(found.snapshot.projectiles[0].weapon, 'fireball');

  const gameSource = readFileSync(
    new URL('../src/game/Game.js', import.meta.url),
    'utf8',
  );
  assert.match(gameSource, /this\.syncOnlineProjectiles\(state\.projectiles \?\? \[\]\)/);
  assert.match(gameSource, /syncOnlineProjectiles\(states = \[\]\)/);
});

test('disconnect becomes a bot and same-token reconnect reclaims the slot', () => {
  const room = createRoom();
  const player = room.players[0];
  const original = player.session;
  room.disconnect(original, 2_000);
  assert.equal(player.bot, true);
  assert.equal(room.phase, 'loading', 'a team disconnect never pauses the room');
  assert.equal(room.destroyAt, 32_000);
  assert.equal(room.reconnect(original, 2_010), true);
  assert.equal(player.bot, false);
  assert.equal(player.connected, true);
  assert.equal(original.slot, 0);
  assert.equal(room.destroyAt, Infinity);
});

test('a new human cancels an old all-bot cleanup deadline', () => {
  const room = createRoom();
  const original = room.players[0].session;
  room.leave(original, 2_000);
  assert.equal(room.destroyAt, 32_000);
  const replacement = session('Replacement');
  assert.ok(room.addSession(replacement, 2_100));
  assert.equal(room.destroyAt, Infinity);
});

test('join and resume counters preserve authoritative slots 2 and 3', () => {
  const snapshot = {
    players: [
      { slot: 2, ack: 41, attackSequence: 9 },
      { slot: 3, ack: 77, attackSequence: 12 },
    ],
  };
  assert.deepEqual(arenaResumeCounters(snapshot, 2), { state: 41, shot: 9 });
  assert.deepEqual(arenaResumeCounters(snapshot, 3), { state: 77, shot: 12 });
  assert.deepEqual(arenaResumeCounters(snapshot, 0), { state: 0, shot: 0 });
});

test('every match_found invalidates stale round identity before initial apply', () => {
  const gameSource = readFileSync(
    new URL('../src/game/Game.js', import.meta.url),
    'utf8',
  );
  const start = gameSource.indexOf('  startOnlineMatch(message) {');
  const end = gameSource.indexOf('\n  startWarMatch(message) {', start);
  const implementation = gameSource.slice(start, end);
  const roundReset = implementation.indexOf('this.onlineRoundLoaded = null;');
  const mapReset = implementation.indexOf('this.onlineMapLoaded = null;');
  const initialApply = implementation.indexOf('this.applyOnlineSnapshot(snapshot, true);');
  assert.ok(roundReset >= 0);
  assert.ok(mapReset > roundReset);
  assert.ok(initialApply > mapReset);
});

test('Hub routes Arena 2v2 separately and immediately starts with bot fill', () => {
  const hub = Object.create(MultiplayerHub.prototype);
  hub.rooms = new Set();
  hub.quickQueue = [];
  hub.privateLobbies = new Map();
  hub.roomRules = rules;
  hub.send = (target, message) => target.messages.push(message);
  const player = session('Hub Player');
  MultiplayerHub.prototype.handleMessage.call(hub, player, {
    type: 'arena_2v2_play',
  });
  assert.equal(hub.quickQueue.length, 0);
  assert.equal(hub.rooms.size, 1);
  assert.equal(player.room.mode, ARENA_2V2_MODE);
  assert.equal(player.room.players.length, 4);
});
