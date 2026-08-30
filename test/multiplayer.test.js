import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/multiplayer/Room.js';
import { WEAPONS as SERVER_WEAPONS } from '../server/multiplayer/config.js';
import { WEAPONS as CLIENT_WEAPONS } from '../src/game/weapons.js';
import {
  bodyIntersectsWorld,
  directionFromAngles,
  firstWorldHit,
  raySphereDistance,
} from '../server/multiplayer/geometry.js';

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

const fastRules = {
  roundIntroMs: 10,
  countdownMs: 10,
  takeMs: 100,
  takeEndMs: 10,
  roundEndMs: 10,
  loadTimeoutMs: 50,
  reconnectMs: 40,
};
const DETERMINISTIC_SPREAD_SEED = 0;

test('authoritative weapon values stay aligned with client presentation', () => {
  const fields = [
    'ammo',
    'reserve',
    'reloadMs',
    'usesAmmo',
    'damage',
    'headMultiplier',
    'interval',
    'spread',
    'focusSpread',
    'pellets',
    'range',
    'projectile',
    'projectileSpeed',
    'splashRadius',
  ];
  assert.deepEqual(Object.keys(SERVER_WEAPONS), Object.keys(CLIENT_WEAPONS));
  for (const weapon of Object.keys(SERVER_WEAPONS)) {
    for (const field of fields) {
      assert.equal(
        SERVER_WEAPONS[weapon][field],
        CLIENT_WEAPONS[weapon][field],
        `${weapon}.${field}`,
      );
    }
  }
});

test('knives, greatsword, and bows never consume ammo and cannot reload', () => {
  for (const weapon of ['knives', 'greatsword', 'shortbow', 'longbow']) {
    const first = createSession(`FIRST-${weapon}`);
    const second = createSession(`SECOND-${weapon}`);
    const room = new Room({ sessions: [first, second], rules: fastRules, now: 2000 });
    room.phase = 'playing';
    const player = room.players[0];
    player.weapon = weapon;
    player.ammo = SERVER_WEAPONS[weapon].ammo;
    player.reserve = SERVER_WEAPONS[weapon].reserve;

    const shot = (shotId, now) => room.handleShot(first, {
      shotId,
      yaw: player.yaw,
      pitch: player.pitch,
      direction: directionFromAngles(player.yaw, player.pitch),
    }, now);

    shot(1, 2100);
    shot(2, 3000);
    room.handleReload(first, 3100);

    assert.equal(player.lastShotId, 2, weapon);
    assert.equal(player.ammo, 1, weapon);
    assert.equal(player.reserve, 0, weapon);
    assert.equal(player.reloadEndsAt, Infinity, weapon);
    assert.equal(
      first.messages.filter((message) => message.event === 'shot').length,
      2,
      weapon,
    );
    assert.equal(
      first.messages.some((message) => message.event === 'reload_start'),
      false,
      weapon,
    );
  }
});

test('reload timing and ammunition transfer stay server authoritative', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 1500,
  });
  room.phase = 'playing';
  const player = room.players[0];
  const definition = SERVER_WEAPONS.crossbow;
  player.weapon = 'crossbow';
  player.ammo = 0;
  player.reserve = 6;

  room.handleReload(first, 1600);
  assert.equal(player.reloadEndsAt, 1600 + definition.reloadMs);
  assert.equal(room.finishReload(player, player.reloadEndsAt - 1), false);

  room.handleShot(
    first,
    { shotId: 1, yaw: player.yaw, pitch: player.pitch },
    1700,
  );
  assert.equal(player.ammo, 0);
  assert.equal(player.lastShotId, 0);

  assert.equal(room.finishReload(player, 1600 + definition.reloadMs), true);
  assert.equal(player.ammo, definition.ammo);
  assert.equal(player.reserve, 5);
  assert.equal(player.reloadEndsAt, Infinity);
  assert.ok(first.messages.some(
    (message) => message.type === 'event' && message.event === 'reload_start',
  ));
  assert.ok(first.messages.some(
    (message) => message.type === 'event' && message.event === 'reload_complete',
  ));
});

test('an authoritative shot request with an empty weapon starts reload', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({ sessions: [first, second], rules: fastRules, now: 1500 });
  room.phase = 'playing';
  const player = room.players[0];
  const definition = SERVER_WEAPONS.crossbow;
  player.weapon = 'crossbow';
  player.ammo = 0;
  player.reserve = 3;

  room.handleShot(first, {
    shotId: 1,
    yaw: player.yaw,
    pitch: player.pitch,
    direction: directionFromAngles(player.yaw, player.pitch),
  }, 1600);

  assert.equal(player.lastShotId, 0);
  assert.equal(player.ammo, 0);
  assert.equal(player.reserve, 3);
  assert.equal(player.reloadEndsAt, 1600 + definition.reloadMs);
  assert.equal(
    first.messages.filter((message) => message.event === 'reload_start').length,
    1,
  );

  room.handleShot(first, {
    shotId: 1,
    yaw: player.yaw,
    pitch: player.pitch,
    direction: directionFromAngles(player.yaw, player.pitch),
  }, 1700);
  assert.equal(
    first.messages.filter((message) => message.event === 'reload_start').length,
    1,
  );
});

test('room advances only after both clients load and owns match timing', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 1000,
  });

  room.handleReady(first, { roundNumber: 1 }, 1001);
  assert.equal(room.phase, 'loading');
  room.handleReady(second, { roundNumber: 1 }, 1002);
  assert.equal(room.phase, 'roundIntro');
  room.update(1013);
  assert.equal(room.phase, 'countdown');
  room.update(1024);
  assert.equal(room.phase, 'playing');
  assert.equal(room.players[0].health, 100);
  assert.equal(room.players[1].health, 100);
});

test('server validates movement and acknowledges accepted input sequences', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 2000,
  });
  const player = room.players[0];
  const spawn = [...player.position];
  first.measuredRtt = 42;

  room.handleState(
    first,
    {
      sequence: 1,
      position: [spawn[0] + 0.25, spawn[1], spawn[2]],
      velocity: [3, 0, 0],
      yaw: player.yaw,
      pitch: 0,
      grounded: true,
      sliding: false,
      wallRunning: false,
      focused: false,
      rtt: 800,
    },
    2050,
  );
  assert.equal(player.lastSequence, 1);
  assert.equal(player.position[0], spawn[0] + 0.25);
  assert.equal(player.rtt, 42, 'Arena rewind must use the server probe, not client RTT');

  room.handleState(
    first,
    {
      sequence: 2,
      position: [19, 7, 15],
      velocity: [999, 999, 999],
      yaw: player.yaw,
      pitch: 0,
    },
    2060,
  );
  assert.equal(player.lastSequence, 2);
  assert.notDeepEqual(player.position, [19, 7, 15]);
  assert.ok(player.velocity.every((component) => Math.abs(component) <= 24.3));
});

test('rapid state packets cannot accumulate fixed movement tolerance', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 2500,
  });
  const player = room.players[0];
  const spawn = [...player.position];

  for (let sequence = 1; sequence <= 80; sequence += 1) {
    room.handleState(
      first,
      {
        sequence,
        position: [spawn[0] + sequence * 0.2, spawn[1], spawn[2]],
        velocity: [18, 0, 0],
        yaw: player.yaw,
        pitch: 0,
      },
      2500 + sequence,
    );
  }

  assert.ok(
    player.position[0] - spawn[0] < 3,
    `rapid packets moved ${player.position[0] - spawn[0]} units`,
  );
  assert.equal(player.lastSequence, 80);
});

test('server-owned hit registration applies damage and ends a take', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 3000,
  });
  room.seed = DETERMINISTIC_SPREAD_SEED;
  room.phase = 'playing';
  room.phaseEndsAt = 9000;
  const shooter = room.players[0];
  const target = room.players[1];
  shooter.position = [-5, 0.02, 14];
  target.position = [5, 0.02, 14];
  shooter.yaw = -Math.PI / 2;
  shooter.pitch = 0;
  shooter.weapon = 'crossbow';
  shooter.ammo = 3;
  target.health = SERVER_WEAPONS.crossbow.damage;
  shooter.history = [{ at: 3000, position: [...shooter.position] }];
  target.history = [{ at: 3000, position: [...target.position] }];

  room.handleShot(
    first,
    {
      shotId: 1,
      yaw: -Math.PI / 2,
      pitch: 0,
      direction: [1, 0, 0],
    },
    3100,
  );

  const shot = first.messages.find(
    (message) => message.type === 'event' && message.event === 'shot',
  );
  assert.equal(shot.hit, true);
  assert.equal(shot.target, 1);
  assert.equal(target.dead, true);
  assert.equal(room.phase, 'playing');
  room.update(3160);
  assert.equal(room.phase, 'takeEnd');
  assert.deepEqual(room.takes, [1, 0]);
  assert.equal(shooter.kills, 1);
  assert.equal(shooter.deaths, 0);
  assert.equal(shooter.assists, 0);
  assert.equal(target.kills, 0);
  assert.equal(target.deaths, 1);
  assert.equal(target.assists, 0);
  assert.deepEqual(
    room.createSnapshot(3160).players.map(({ kills, deaths, assists }) => ({
      kills,
      deaths,
      assists,
    })),
    [
      { kills: 1, deaths: 0, assists: 0 },
      { kills: 0, deaths: 1, assists: 0 },
    ],
  );
});

test('server rejects shot directions that diverge from reported aim', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 3500,
  });
  room.phase = 'playing';
  const shooter = room.players[0];
  shooter.yaw = 0;
  shooter.pitch = 0;

  room.handleShot(
    first,
    {
      shotId: 1,
      yaw: 0,
      pitch: 0,
      direction: [1, 0, 0],
    },
    3600,
  );

  assert.equal(shooter.ammo, SERVER_WEAPONS.knives.ammo);
  assert.equal(shooter.lastShotId, 0);
});

test('malformed Arena shot directions are rejected without throwing', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({ sessions: [first, second], rules: fastRules, now: 3_700 });
  room.phase = 'playing';
  const shooter = room.players[0];
  const startingAmmo = shooter.ammo;

  for (const direction of [undefined, null, 1, [], [0, 0], [0, 0, Infinity]]) {
    assert.doesNotThrow(() => room.handleShot(first, {
      shotId: 1,
      yaw: 0,
      pitch: 0,
      direction,
    }, 3_800));
  }
  assert.equal(shooter.lastShotId, 0);
  assert.equal(shooter.ammo, startingAmmo);
});

test('the trade window preserves legitimate simultaneous eliminations', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 4000,
  });
  room.seed = DETERMINISTIC_SPREAD_SEED;
  room.phase = 'playing';
  room.phaseEndsAt = 9000;
  const firstPlayer = room.players[0];
  const secondPlayer = room.players[1];
  firstPlayer.position = [-5, 0.02, 14];
  secondPlayer.position = [5, 0.02, 14];
  firstPlayer.yaw = -Math.PI / 2;
  secondPlayer.yaw = Math.PI / 2;
  for (const player of room.players) {
    player.pitch = 0;
    player.weapon = 'crossbow';
    player.health = SERVER_WEAPONS.crossbow.damage;
    player.ammo = 3;
    player.history = [{ at: 4000, position: [...player.position] }];
  }

  room.handleShot(
    first,
    { shotId: 1, yaw: -Math.PI / 2, pitch: 0, direction: [1, 0, 0] },
    4100,
  );
  room.handleShot(
    second,
    { shotId: 1, yaw: Math.PI / 2, pitch: 0, direction: [-1, 0, 0] },
    4120,
  );
  room.update(4160);

  assert.equal(firstPlayer.dead, true);
  assert.equal(secondPlayer.dead, true);
  assert.deepEqual(
    room.players.map(({ kills, deaths, assists }) => ({ kills, deaths, assists })),
    [
      { kills: 1, deaths: 1, assists: 0 },
      { kills: 1, deaths: 1, assists: 0 },
    ],
  );
  assert.equal(room.phase, 'takeEnd');
  assert.deepEqual(room.takes, [0, 0]);
  const takeEnd = first.messages.find(
    (message) => message.type === 'event' && message.event === 'take_end',
  );
  assert.equal(takeEnd.reason, 'mutual');
});

test('Arena K/D/A persists across takes and resets for an accepted rematch', () => {
  const first = createSession('FIRST');
  const second = createSession('SECOND');
  const room = new Room({
    sessions: [first, second],
    rules: fastRules,
    now: 4_500,
  });
  room.players[0].kills = 4;
  room.players[0].deaths = 2;
  room.players[1].kills = 2;
  room.players[1].deaths = 4;

  room.resetTake(4_600);
  assert.deepEqual(
    room.players.map(({ kills, deaths, assists }) => [kills, deaths, assists]),
    [[4, 2, 0], [2, 4, 0]],
  );

  room.phase = 'result';
  room.requestRematch(first, 4_700);
  room.requestRematch(second, 4_701);
  assert.equal(room.phase, 'loading');
  assert.deepEqual(
    room.players.map(({ kills, deaths, assists }) => [kills, deaths, assists]),
    [[0, 0, 0], [0, 0, 0]],
  );
});

test('server collision and ray helpers match arena boundaries', () => {
  assert.equal(bodyIntersectsWorld(0, [-14, 0.02, 14.5], false), false);
  assert.equal(bodyIntersectsWorld(0, [0, 0.02, 0], false), true);
  const direction = directionFromAngles(-Math.PI / 2, 0);
  assert.ok(Math.abs(direction[0] - 1) < 1e-8);
  const world = firstWorldHit(0, [-10, 1.5, 0], [1, 0, 0], 30);
  assert.equal(world.hit, true);
  assert.ok(world.distance > 7.9 && world.distance < 8.1);
  assert.equal(raySphereDistance([0, 0, 0], [1, 0, 0], [5, 0, 0], 1), 4);
});
