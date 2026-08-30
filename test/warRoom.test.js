import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CHARACTER_HITBOX } from '../shared/characterHitbox.js';
import {
  WAR_CLASSES,
  WAR_CLASS_IDS,
  WAR_COMBATANT_COUNT,
  WAR_MAP,
  WAR_TEAM_SIZE,
  warSpawnForSlot,
} from '../shared/warConfig.js';
import { WarRoom, WAR_ROOM_LIMITS } from '../server/multiplayer/WarRoom.js';
import { createWarBotNavigator } from '../server/multiplayer/warBotNavigation.js';
import { WEAPONS as ARENA_WEAPONS } from '../server/multiplayer/config.js';
import { warResumeCounters } from '../src/game/Game.js';
import {
  clampWarPosition,
  distanceSquared,
  moveWarBody,
  warBodyIntersectsWorld,
  warBodySweepIntersectsWorld,
} from '../server/multiplayer/warGeometry.js';

function createSession(name) {
  const messages = [];
  const encoded = [];
  return {
    token: `${name.toLowerCase()}-token`,
    name,
    room: null,
    slot: null,
    team: null,
    measuredRtt: 0,
    messages,
    encoded,
    send(message) {
      messages.push(message);
      return true;
    },
    sendEncoded(message, options) {
      encoded.push({ message, options });
      return true;
    },
  };
}

function disableAllExcept(room, slots) {
  const enabled = new Set(slots);
  for (const player of room.players) {
    if (enabled.has(player.slot)) continue;
    player.dead = true;
    player.health = 0;
    player.respawnAt = Infinity;
  }
}

test('War always contains two balanced teams of 40 and humans replace bot slots', () => {
  const room = new WarRoom({ now: 1_000, seed: 71 });
  assert.equal(room.players.length, WAR_COMBATANT_COUNT);
  assert.equal(room.players.filter((player) => player.team === 0).length, WAR_TEAM_SIZE);
  assert.equal(room.players.filter((player) => player.team === 1).length, WAR_TEAM_SIZE);
  assert.equal(room.players.filter((player) => player.bot).length, 80);
  assert.deepEqual(
    room.players.slice(0, WAR_CLASS_IDS.length).map((player) => player.classId),
    WAR_CLASS_IDS,
  );

  const sessions = Array.from({ length: 7 }, (_, index) => createSession(`Player ${index}`));
  sessions.forEach((session, index) => {
    const player = room.addSession(session, index % 2 ? 'greatsword' : 'lightning', 1_001 + index);
    assert.ok(player);
    assert.equal(session.room, room);
    assert.equal(session.slot, player.slot);
    assert.equal(session.team, player.team);
  });

  assert.deepEqual(room.getSummary().teamHumans, [4, 3]);
  assert.equal(room.players.filter((player) => player.bot).length, 73);
  assert.equal(room.players.filter((player) => player.human).length, 7);
  assert.ok(sessions.every((session) =>
    session.messages.some((message) => message.type === 'war_found')
  ));
});

test('a joining human takes over a live skirmish instead of an empty spawn line', () => {
  const room = new WarRoom({ now: 1_250, seed: 0x10ad });
  const expected = [...room.eligibleBotForTeam(0, 1_250).position];
  const session = createSession('Drop In');
  const player = room.addSession(session, 'knives', 1_251);

  assert.ok(player);
  assert.equal(player.team, 0);
  assert.deepEqual(player.position, [expected[0], 0.02, expected[2]]);
  assert.notDeepEqual(player.position, warSpawnForSlot(player.team, player.teamSlot));
  assert.equal(player.health, WAR_CLASSES.knives.health);
  assert.equal(player.grounded, true);
  const found = session.messages.find((message) => message.type === 'war_found');
  const local = found.snapshot.combatants.find(({ id }) => id === player.slot);
  assert.deepEqual(
    local.position,
    player.position.map((value) => Math.round(value * 100) / 100),
  );
  const attacker = room.players[WAR_TEAM_SIZE];
  const protectedHealth = player.health;
  assert.equal(room.applyDamage(player, 40, attacker, 1_351), 10);
  assert.equal(player.health, protectedHealth - 10);
  assert.equal(room.applyDamage(player, 40, attacker, 3_052), 40);
  assert.equal(player.health, protectedHealth - 50);
});

test('all 80 human slots fill without unbalancing either team', () => {
  const room = new WarRoom({ now: 1_500, seed: 72 });
  const sessions = Array.from(
    { length: WAR_COMBATANT_COUNT },
    (_, index) => createSession(`Full ${index}`),
  );
  for (const [index, session] of sessions.entries()) {
    const player = room.addSession(
      session,
      WAR_CLASS_IDS[index % WAR_CLASS_IDS.length],
      1_501 + index,
    );
    assert.ok(player, `slot ${index}`);
  }

  assert.equal(room.connectedHumans().length, WAR_COMBATANT_COUNT);
  assert.equal(room.players.filter((player) => player.bot).length, 0);
  assert.deepEqual(room.getSummary().teamHumans, [WAR_TEAM_SIZE, WAR_TEAM_SIZE]);
  assert.equal(room.canJoin(2_000), false);
  assert.equal(room.addSession(createSession('Overflow'), 'shortbow', 2_000), null);
});

test('disconnect hands a stable slot to a bot and reconnect reclaims it', () => {
  const session = createSession('Reconnect');
  const room = new WarRoom({
    sessions: [{ session, classId: 'crossbow' }],
    now: 2_000,
    seed: 91,
    rules: { reconnectMs: 500, destroyAfterMs: 1_000 },
  });
  const player = room.playerForSession(session);
  const originalSlot = player.slot;
  player.lastSequence = 47;
  player.lastShotId = 9;
  assert.equal(room.disconnect(session, 2_100), true);
  assert.equal(player.bot, true);
  assert.equal(player.human, false);
  assert.equal(player.token, session.token);
  assert.equal(room.shouldDestroy(3_099), false);

  session.name = 'Returned';
  assert.equal(room.reconnect(session, 2_400), true);
  assert.equal(player.slot, originalSlot);
  assert.equal(player.bot, false);
  assert.equal(player.human, true);
  assert.equal(player.name, 'Returned');
  assert.equal(session.messages.at(-1).type, 'war_found');
  assert.equal(session.messages.at(-1).resumed, true);
  const resumeSnapshot = session.messages.at(-1).snapshot;
  assert.deepEqual(warResumeCounters(resumeSnapshot, originalSlot), {
    state: 47,
    shot: 9,
  });

  room.disconnect(session, 2_500);
  room.update(3_001);
  assert.equal(player.token, null);
  assert.equal(player.session, null);
  assert.equal(session.room, null);
  assert.equal(room.reconnect(session, 3_002), false);
});

test('a live socket migration resumes War without a fake disconnect event', () => {
  const session = createSession('Live Move');
  const observer = createSession('Observer');
  const room = new WarRoom({
    sessions: [session, observer],
    classIds: ['shortbow', 'greatsword'],
    now: 3_500,
    seed: 92,
  });
  const player = room.playerForSession(session);
  player.lastSequence = 18;
  player.lastShotId = 6;
  session.messages.length = 0;
  observer.encoded.length = 0;

  assert.equal(room.reconnect(session, 3_600), true);
  assert.equal(player.connected, true);
  assert.equal(player.human, true);
  assert.equal(player.bot, false);
  assert.equal(session.messages.at(-1).type, 'war_found');
  assert.equal(session.messages.at(-1).resumed, true);
  assert.deepEqual(warResumeCounters(session.messages.at(-1).snapshot, player.slot), {
    state: 18,
    shot: 6,
  });
  assert.equal(observer.encoded.some(({ message }) =>
    JSON.parse(message).event === 'player_reconnected'), false);
});

test('fixed 10 Hz bots produce the same state for the same seed', () => {
  const first = new WarRoom({ now: 5_000, seed: 0x12345678, rules: { unlockMs: 0 } });
  const second = new WarRoom({ now: 5_000, seed: 0x12345678, rules: { unlockMs: 0 } });
  for (let tick = 1; tick <= 220; tick += 1) {
    first.update(5_000 + tick * 100);
    second.update(5_000 + tick * 100);
  }

  const state = (room) => ({
    tick: room.botTick,
    phase: room.phase,
    winner: room.winner,
    control: room.control.snapshot(27_000, room.objectiveOccupancy()),
    players: room.players.map((player) => ({
      slot: player.slot,
      position: player.position,
      health: player.health,
      dead: player.dead,
      respawnAt: player.respawnAt,
      attackSequence: player.attackSequence,
      ammo: player.ammo,
      reserve: player.reserve,
      reloadEndsAt: player.reloadEndsAt,
      kills: player.kills,
      deaths: player.deaths,
    })),
    projectiles: room.projectiles,
  });
  assert.deepEqual(state(first), state(second));
  assert.equal(first.botTick, 220);
  assert.equal(WAR_ROOM_LIMITS.botTickRate, 10);
});

test('multi-seed bot simulation is exactly reciprocal when physical sides swap', () => {
  const start = 6_500;
  for (const seed of [0x101, 0x202, 0x303]) {
    const southRed = new WarRoom({
      now: start,
      seed,
      teamSideSwap: 0,
      rules: { unlockMs: 0, scoreToWin: 999_999, respawnMs: 3_500 },
    });
    const northRed = new WarRoom({
      now: start,
      seed,
      teamSideSwap: 1,
      rules: { unlockMs: 0, scoreToWin: 999_999, respawnMs: 3_500 },
    });
    for (let tick = 1; tick <= 300; tick += 1) {
      southRed.update(start + tick * 100);
      northRed.update(start + tick * 100);
    }

    assert.deepEqual(
      southRed.control.scores,
      [northRed.control.scores[1], northRed.control.scores[0]],
      `reciprocal scores for seed ${seed}`,
    );
    for (let teamSlot = 0; teamSlot < WAR_TEAM_SIZE; teamSlot += 1) {
      for (const team of [0, 1]) {
        const first = southRed.players[team * WAR_TEAM_SIZE + teamSlot];
        const reciprocal = northRed.players[(1 - team) * WAR_TEAM_SIZE + teamSlot];
        assert.deepEqual(first.position, reciprocal.position);
        assert.deepEqual(first.velocity, reciprocal.velocity);
        assert.equal(first.health, reciprocal.health);
        assert.equal(first.dead, reciprocal.dead);
        assert.equal(first.deaths, reciprocal.deaths);
        assert.equal(first.kills, reciprocal.kills);
        assert.equal(first.attackSequence, reciprocal.attackSequence);
      }
    }
  }

  assert.equal(new WarRoom({ now: start, seed: 2 }).teamSideSwap, 0);
  assert.equal(new WarRoom({ now: start, seed: 3 }).teamSideSwap, 1);
});

test('War loads into scattered mirrored skirmishes already moving, wounded, and evading', () => {
  const now = 7_000;
  const room = new WarRoom({ now, seed: 0xabc123 });
  const moving = room.players.filter((player) =>
    Math.hypot(player.velocity[0], player.velocity[2]) > 0.35
  );
  const airborne = room.players.filter((player) => !player.grounded);
  const wounded = room.players.filter((player) => player.health < player.maxHealth);
  const currentlyDodging = room.players.filter((player) => player.botDodgeUntil > now);
  const xCoordinates = room.players.map((player) => player.position[0]);
  const zCoordinates = room.players.map((player) => player.position[2]);

  assert.ok(moving.length >= 72, `${moving.length} bots moving at load`);
  assert.ok(airborne.length >= 16, `${airborne.length} bots airborne at load`);
  assert.ok(wounded.length >= 32, `${wounded.length} bots carry battle damage`);
  assert.ok(currentlyDodging.length >= 20, `${currentlyDodging.length} bots mid-dodge`);
  assert.ok(Math.max(...xCoordinates) - Math.min(...xCoordinates) > 130);
  assert.ok(Math.max(...zCoordinates) - Math.min(...zCoordinates) > 110);
  assert.ok(room.players.every((player) => player.attackSequence > 0));
  assert.ok(room.players.every((player) => {
    const opponent = room.players[player.botTargetSlot];
    return opponent && opponent.team !== player.team &&
      Math.sqrt(distanceSquared(player.position, opponent.position)) < 3.3;
  }));

  for (let teamSlot = 0; teamSlot < WAR_TEAM_SIZE; teamSlot += 1) {
    const red = room.players[teamSlot];
    const blue = room.players[WAR_TEAM_SIZE + teamSlot];
    assert.equal(red.position[0], blue.position[0], `paired x ${teamSlot}`);
    assert.equal(red.position[1], blue.position[1], `paired y ${teamSlot}`);
    assert.equal(red.position[2], -blue.position[2], `paired z ${teamSlot}`);
    assert.ok(
      Math.abs(red.velocity[0] - blue.velocity[0]) < 1e-9,
      `paired vx ${teamSlot}`,
    );
    assert.ok(
      Math.abs(red.velocity[2] + blue.velocity[2]) < 1e-9,
      `paired vz ${teamSlot}`,
    );
    assert.equal(red.health, blue.health, `paired health ${teamSlot}`);
    assert.equal(red.botAccuracy, blue.botAccuracy, `paired accuracy ${teamSlot}`);
    assert.equal(red.botMeleeAccuracy, blue.botMeleeAccuracy, `paired melee ${teamSlot}`);
    assert.equal(red.botDamageScale, blue.botDamageScale, `paired damage ${teamSlot}`);
    assert.equal(red.botCadenceScale, blue.botCadenceScale, `paired cadence ${teamSlot}`);
  }
});

test('bot exchanges include visible misses and remain alive through the opening fight', () => {
  const now = 7_500;
  const room = new WarRoom({
    now,
    seed: 0x51eed,
    rules: { unlockMs: 999_999 },
  });
  const red = room.players[1];
  const blue = room.players[WAR_TEAM_SIZE + 1];
  disableAllExcept(room, [red.slot, blue.slot]);
  room.setClass(red, 'shortbow', false);
  room.setClass(blue, 'shortbow', false);
  red.position = [0, 0.02, 10];
  blue.position = [0, 0.02, -10];
  red.health = red.maxHealth;
  blue.health = blue.maxHealth;
  red.botTargetSlot = blue.slot;
  blue.botTargetSlot = red.slot;
  red.botTargetRefreshAt = Infinity;
  blue.botTargetRefreshAt = Infinity;
  red.lastAttackAt = -Infinity;
  blue.lastAttackAt = -Infinity;
  const startingSequences = red.attackSequence + blue.attackSequence;

  for (let tick = 1; tick <= 40; tick += 1) room.update(now + tick * 100);

  const attempts = (red.botShotAttempts ?? 0) + (blue.botShotAttempts ?? 0);
  const misses = (red.botDeliberateMisses ?? 0) + (blue.botDeliberateMisses ?? 0);
  assert.ok(attempts >= 6, `${attempts} opening attacks`);
  assert.ok(red.attackSequence + blue.attackSequence > startingSequences);
  assert.ok(misses >= 2 && misses < attempts, `${misses}/${attempts} deliberate misses`);
  assert.equal(red.dead, false, 'red survives the four-second opening exchange');
  assert.equal(blue.dead, false, 'blue survives the four-second opening exchange');
  assert.ok(red.health < red.maxHealth || blue.health < blue.maxHealth);
  assert.ok(red.botCadenceScale >= 1, 'bots never exceed human weapon cadence');
  assert.ok(blue.botCadenceScale >= 1, 'bots never exceed human weapon cadence');
});

test('bots repeatedly jump and dodge during a live battle', () => {
  const now = 7_800;
  const room = new WarRoom({
    now,
    seed: 0xd0d6e,
    rules: { unlockMs: 999_999 },
  });
  const startingJumps = room.players.reduce((total, player) =>
    total + player.botJumpCount, 0);
  const startingDodges = room.players.reduce((total, player) =>
    total + player.botDodgeCount, 0);
  let maximumAirborne = 0;
  for (let tick = 1; tick <= 35; tick += 1) {
    room.update(now + tick * 100);
    maximumAirborne = Math.max(
      maximumAirborne,
      room.players.filter((player) => !player.dead && !player.grounded).length,
    );
  }
  const jumps = room.players.reduce((total, player) =>
    total + player.botJumpCount, 0);
  const dodges = room.players.reduce((total, player) =>
    total + player.botDodgeCount, 0);
  assert.ok(jumps - startingJumps >= 30, `${jumps - startingJumps} new jumps`);
  assert.ok(dodges - startingDodges >= 50, `${dodges - startingDodges} new dodges`);
  assert.ok(maximumAirborne >= 20, `${maximumAirborne} simultaneously airborne`);
});

test('AABB navigation routes around cover and bots do not stall against its face', () => {
  const customMap = {
    bounds: { x: 20, z: 20 },
    colliders: [
      [-20, -1, -20, 20, 0, 20],
      [-2.5, 0, -12, 2.5, 4, 7],
    ],
  };
  const navigator = createWarBotNavigator(customMap, { cellSize: 2 });
  const start = [-12, 0.02, 0];
  const goal = [12, 0.02, 0];
  const path = navigator.findPath(start, goal);
  assert.ok(path.length >= 2, `${path.length} path points around cover`);
  assert.ok(path.some((point) => point[2] > 7.5 || point[2] < -12.5));
  let anchor = start;
  for (const waypoint of path) {
    assert.equal(navigator.segmentIsWalkable(anchor, waypoint), true);
    anchor = waypoint;
  }

  const room = new WarRoom({
    now: 7_900,
    seed: 0xaabb,
    rules: { unlockMs: 999_999 },
  });
  const bot = room.players[0];
  disableAllExcept(room, [bot.slot]);
  const cover = WAR_MAP.colliders.find((collider) =>
    collider[1] >= 0 && collider[4] > 1 &&
    collider[3] - collider[0] >= 5 && collider[5] - collider[2] >= 5 &&
    Math.abs((collider[0] + collider[3]) * 0.5) < WAR_MAP.bounds.x - 15 &&
    Math.abs((collider[2] + collider[5]) * 0.5) < WAR_MAP.bounds.z - 15
  );
  assert.ok(cover, 'the War map includes solid cover to navigate');
  const centerZ = (cover[2] + cover[5]) * 0.5;
  const startPosition = room.botNavigator.nearestWalkablePoint([
    cover[0] - 6,
    0.02,
    centerZ,
  ]);
  const destination = room.botNavigator.nearestWalkablePoint([
    cover[3] + 6,
    0.02,
    centerZ,
  ]);
  bot.position = startPosition;
  bot.grounded = true;
  bot.verticalVelocity = 0;
  bot.botPath = [];
  bot.botPathGoal = null;
  bot.botStuckTicks = 0;
  room.botDestination = () => destination;
  let maximumBlockedTicks = 0;
  let blockedTicks = 0;
  for (let tick = 1; tick <= 180; tick += 1) {
    const before = [...bot.position];
    room.botTick = tick;
    room.updateBotMovement(bot, 0.1, 7_900 + tick * 100);
    assert.equal(warBodyIntersectsWorld(bot.position), false);
    const remaining = Math.sqrt(distanceSquared(bot.position, destination));
    const travelled = Math.sqrt(distanceSquared(before, bot.position));
    blockedTicks = remaining > 1.2 && travelled < 0.01 ? blockedTicks + 1 : 0;
    maximumBlockedTicks = Math.max(maximumBlockedTicks, blockedTicks);
  }
  assert.ok(
    Math.sqrt(distanceSquared(bot.position, destination)) < 1.2,
    `bot stopped at ${bot.position.join(', ')}`,
  );
  assert.ok(maximumBlockedTicks < 5, `${maximumBlockedTicks} blocked ticks`);
});

test('navigation edges cannot tunnel across a thin prop between grid centers', () => {
  const navigator = createWarBotNavigator({
    bounds: { x: 6, z: 6 },
    colliders: [
      [-6, -1, -6, 6, 0, 6],
      [-1, 0, 2.05, 1, 3, 2.15],
    ],
  }, { cellSize: 3 });
  const start = [0.62, 0.02, 3.62];
  const goal = [0.62, 0.02, 0.62];
  const path = navigator.findPath(start, goal);
  assert.ok(path.length >= 2, `${path.length} waypoints around the thin prop`);
  let anchor = start;
  for (const waypoint of path) {
    assert.equal(navigator.segmentIsWalkable(anchor, waypoint), true);
    anchor = waypoint;
  }
});

test('all 80 bots recover without a one-second wall scrape in the long busy-map seed', () => {
  const start = 100_000;
  const room = new WarRoom({
    now: start,
    seed: 0x57a22,
    rules: {
      unlockMs: 0,
      scoreToWin: 999_999,
      respawnMs: 3_500,
    },
  });
  const activeScrapeTicks = new Uint16Array(WAR_COMBATANT_COUNT);
  let longestScrapeTicks = 0;
  let longestSlot = null;
  let maximumRawStuckTicks = 0;

  for (let tick = 1; tick <= 1_800; tick += 1) {
    room.update(start + tick * 100);
    for (const player of room.players) {
      assert.equal(
        warBodyIntersectsWorld(player.position),
        false,
        `slot ${player.slot} entered scenery at tick ${tick}`,
      );
      if (!player.dead && player.botStuckTicks >= 3) {
        activeScrapeTicks[player.slot] += 1;
      } else {
        activeScrapeTicks[player.slot] = 0;
      }
      maximumRawStuckTicks = Math.max(
        maximumRawStuckTicks,
        player.botStuckTicks,
      );
      if (activeScrapeTicks[player.slot] > longestScrapeTicks) {
        longestScrapeTicks = activeScrapeTicks[player.slot];
        longestSlot = player.slot;
      }
    }
  }

  assert.ok(
    longestScrapeTicks < 10,
    `slot ${longestSlot} scraped for ${longestScrapeTicks} consecutive ticks`,
  );
  assert.ok(
    maximumRawStuckTicks < 10,
    `stuck counter reached ${maximumRawStuckTicks}`,
  );
});

test('same-tick bot damage resolves simultaneously instead of favoring red slots', () => {
  const room = new WarRoom({ now: 8_000, seed: 0xdecafbad, rules: { unlockMs: 0 } });
  const red = room.players[4];
  const blue = room.players[WAR_TEAM_SIZE + 4];
  disableAllExcept(room, [red.slot, blue.slot]);
  room.setClass(red, 'greatsword', false);
  room.setClass(blue, 'greatsword', false);
  red.position = [-1, 0.02, 0];
  blue.position = [1, 0.02, 0];
  red.health = WAR_CLASSES.greatsword.damage * red.botDamageScale;
  blue.health = WAR_CLASSES.greatsword.damage * blue.botDamageScale;
  red.botMeleeAccuracy = 1;
  blue.botMeleeAccuracy = 1;
  red.lastAttackAt = -Infinity;
  blue.lastAttackAt = -Infinity;

  room.runBotTick(8_100);

  assert.equal(red.dead, true, 'blue attack still resolves after blue takes lethal damage');
  assert.equal(blue.dead, true, 'red attack resolves in the same tick');
  assert.equal(red.deaths, 1);
  assert.equal(blue.deaths, 1);
});

test('queued same-tick bot hit events report only damage that survives the flush', () => {
  const now = 8_300;
  const room = new WarRoom({
    now,
    seed: 0xdecafbad,
    rules: { unlockMs: 999_999 },
  });
  const redFirst = room.players[0];
  const redSecond = room.players[1];
  const blue = room.players[WAR_TEAM_SIZE];
  disableAllExcept(room, [redFirst.slot, redSecond.slot, blue.slot]);
  room.updateBotMovement = () => {};
  const attackEvents = [];
  room.broadcast = (payload) => {
    if (payload.event === 'attack') attackEvents.push(payload);
    return true;
  };
  for (const player of [redFirst, redSecond, blue]) {
    room.setClass(player, 'greatsword', false);
    player.health = WAR_CLASSES.greatsword.damage;
    player.lastAttackAt = -Infinity;
    player.botDamageScale = 1;
    player.botMeleeAccuracy = 1;
    player.botTargetRefreshAt = Infinity;
  }
  redFirst.position = [2, 0.02, 0];
  redSecond.position = [-2, 0.02, 0];
  blue.position = [0, 0.02, 0];
  redFirst.botTargetSlot = blue.slot;
  redSecond.botTargetSlot = blue.slot;
  blue.botTargetSlot = redSecond.slot;

  room.runBotTick(now + 100);

  const first = attackEvents.find((event) => event.shooter === redFirst.slot);
  const redundant = attackEvents.find((event) => event.shooter === redSecond.slot);
  const reciprocal = attackEvents.find((event) => event.shooter === blue.slot);
  assert.equal(first.hit, true);
  assert.equal(first.damage, WAR_CLASSES.greatsword.damage);
  assert.equal(first.hits[0].health, 0);
  assert.equal(redundant.hit, false);
  assert.equal(redundant.damage, 0);
  assert.deepEqual(redundant.hits, []);
  assert.equal(reciprocal.hit, true, 'blue still resolves its reciprocal trade');
  assert.equal(reciprocal.damage, WAR_CLASSES.greatsword.damage);
  assert.ok(reciprocal.hits.some((hit) =>
    hit.target === redSecond.slot && hit.health === 0
  ));
  assert.equal(blue.dead, true);
  assert.equal(redSecond.dead, true);
});

test('paired bot routes are exact team mirrors', () => {
  const room = new WarRoom({ now: 8_500, seed: 0x5a17 });
  for (let teamSlot = 0; teamSlot < WAR_TEAM_SIZE; teamSlot += 1) {
    const red = room.players[teamSlot];
    const blue = room.players[WAR_TEAM_SIZE + teamSlot];
    const redDestination = room.botDestination(red);
    const blueDestination = room.botDestination(blue);
    assert.equal(red.position[0], blue.position[0], `spawn x ${teamSlot}`);
    assert.equal(red.position[2], -blue.position[2], `spawn z ${teamSlot}`);
    assert.equal(redDestination[0], blueDestination[0], `destination x ${teamSlot}`);
    assert.equal(redDestination[2], -blueDestination[2], `destination z ${teamSlot}`);
  }
});

test('human movement is speed bounded and cannot enter War cover or leave the map', () => {
  const session = createSession('Mover');
  const room = new WarRoom({ sessions: [session], now: 10_000, seed: 2 });
  const player = room.playerForSession(session);
  player.position = [-23, 0.02, 0];
  player.movementCredit = 10;

  assert.equal(room.handleState(session, {
    sequence: 1,
    position: [-20, 0.02, 0],
    velocity: [999, 999, 999],
    yaw: 0,
    pitch: 0,
  }, 10_100), true);
  assert.equal(warBodyIntersectsWorld(player.position), false);
  assert.notDeepEqual(player.position, [-20, 0.02, 0]);
  assert.ok(Math.abs(player.velocity[0]) <= WAR_CLASSES.shortbow.speed * 1.35);
  assert.ok(Math.abs(player.velocity[1]) <= 12);

  assert.deepEqual(clampWarPosition([999, -100, -999]), [119.55, 0.02, -99.55]);
});

test('War boundary contact permits movement away or tangent on every side', () => {
  const safeSweeps = [
    {
      label: 'south boundary regression',
      start: [-14.75, 0.02, 99.55],
      end: [-14.75, 0.02, 99],
    },
    {
      label: 'north boundary',
      start: [-14.75, 0.02, -99.55],
      end: [-14.75, 0.02, -99],
    },
    {
      label: 'east boundary',
      start: [119.55, 0.02, 7.25],
      end: [119, 0.02, 7.25],
    },
    {
      label: 'west boundary',
      start: [-119.55, 0.02, 7.25],
      end: [-119, 0.02, 7.25],
    },
    {
      label: 'south-east corner',
      start: [119.55, 0.02, 99.55],
      end: [119, 0.02, 99],
    },
    {
      label: 'north-west corner',
      start: [-119.55, 0.02, -99.55],
      end: [-119, 0.02, -99],
    },
    {
      label: 'tangent to east boundary',
      start: [119.55, 0.02, 7.25],
      end: [119.55, 0.02, 6.75],
    },
  ];

  for (const { label, start, end } of safeSweeps) {
    assert.equal(warBodySweepIntersectsWorld(start, end), false, label);
    assert.deepEqual(moveWarBody(start, end), end, label);
  }
});

test('War boundary contact still rejects movement into a side at edges and corners', () => {
  const blockedSweeps = [
    [[-14.75, 0.02, 99.55], [-14.75, 0.02, 100]],
    [[-14.75, 0.02, -99.55], [-14.75, 0.02, -100]],
    [[119.55, 0.02, 7.25], [120, 0.02, 7.25]],
    [[-119.55, 0.02, 7.25], [-120, 0.02, 7.25]],
    [[119.55, 0.02, 99.55], [119, 0.02, 100]],
    [[119.55, 0.02, 99.55], [120, 0.02, 99]],
  ];
  for (const [start, end] of blockedSweeps) {
    assert.equal(warBodySweepIntersectsWorld(start, end), true);
  }
});

test('War bounds vertical state and accepts the legitimate greatsword slide speed', () => {
  const session = createSession('Movement States');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 10_500,
    seed: 22,
  });
  const player = room.playerForSession(session);
  session.measuredRtt = 42;
  player.position = [-30, 0.02, 10];
  player.lastStateAt = 10_500;
  player.movementCredit = 0;

  assert.equal(room.handleState(session, {
    sequence: 1,
    position: [-29.66, 0.02, 10],
    velocity: [6.8, 0, 0],
    yaw: 0,
    pitch: 0,
    grounded: true,
    sliding: false,
  }, 10_550), true);
  assert.ok(player.acceptedHorizontalSpeed > 6.7);

  assert.equal(room.handleState(session, {
    sequence: 2,
    position: [-29.18, 0.02, 10],
    velocity: [9.6, 0, 0],
    yaw: 0,
    pitch: 0,
    grounded: true,
    sliding: true,
    rtt: 800,
  }, 10_600), true);
  assert.ok(player.position[0] > -29.2, `slide stopped at ${player.position[0]}`);
  assert.equal(player.sliding, true);
  assert.equal(player.grounded, true);
  assert.equal(player.rtt, 42, 'lag compensation must use the server probe, not client RTT');

  let maximumY = player.position[1];
  let descended = false;
  for (let step = 3; step <= 91; step += 1) {
    const previousY = player.position[1];
    room.handleState(session, {
      sequence: step,
      position: [player.position[0], 99, player.position[2]],
      velocity: [0, 12, 0],
      yaw: 0,
      pitch: 0,
      grounded: false,
      sliding: false,
    }, 10_500 + step * 50);
    maximumY = Math.max(maximumY, player.position[1]);
    descended ||= player.position[1] < previousY - 0.05;
    assert.equal(warBodyIntersectsWorld(player.position), false);
  }
  assert.ok(maximumY <= 2.25, `server accepted foot height ${maximumY}`);
  assert.equal(descended, true, 'forced descent must defeat sustained hover input');
});

test('a forged grounded flag cannot freeze a War player above the floor', () => {
  const session = createSession('False Ground');
  const room = new WarRoom({ sessions: [session], now: 15_000, seed: 24 });
  const player = room.playerForSession(session);
  player.position = [0, 2.25, 50];
  player.airborneSince = 15_000;
  player.lastStateAt = 15_000;
  player.movementCredit = 0;

  for (let step = 1; step <= 200; step += 1) {
    room.handleState(session, {
      sequence: step,
      position: [0, 2.25, 50],
      velocity: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      grounded: true,
    }, 15_000 + step * 50);
  }
  assert.equal(player.position[1], 0.02);
  assert.equal(player.grounded, true);
  assert.equal(player.airborneSince, 0);
});

test('repeated forged vertical states stay inside the server jump envelope', () => {
  const session = createSession('Jump Envelope');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 15_500,
    seed: 26,
  });
  const player = room.playerForSession(session);
  player.position = [0, 0.02, 50];
  player.lastStateAt = 15_500;
  player.movementCredit = 0;
  let maximumY = player.position[1];
  let groundedPackets = 0;

  for (let step = 1; step <= 200; step += 1) {
    room.handleState(session, {
      sequence: step,
      position: [0, 2.25, 50],
      velocity: [0, 12, 0],
      yaw: 0,
      pitch: 0,
      grounded: false,
    }, 15_500 + step * 50);
    maximumY = Math.max(maximumY, player.position[1]);
    if (player.grounded) groundedPackets += 1;
  }

  assert.ok(maximumY < 1.5, `forged jump reached ${maximumY}m`);
  assert.ok(groundedPackets > 0, 'server gravity must complete each forged jump arc');
});

test('server ticks complete a human jump after state packets stop', () => {
  const session = createSession('Paused Jump');
  const room = new WarRoom({ sessions: [session], now: 15_800, seed: 30 });
  const player = room.playerForSession(session);
  disableAllExcept(room, [player.slot]);
  player.position = [0, 0.02, 50];
  player.history = [{ at: 15_800, position: [...player.position] }];
  player.movementCredit = 0;

  assert.equal(room.handleState(session, {
    sequence: 1,
    position: [0, 0.8, 50],
    velocity: [0, 7.5, 0],
    yaw: 0,
    pitch: 0,
    grounded: false,
  }, 15_850), true);
  assert.equal(player.grounded, false);
  assert.ok(player.position[1] > 0.02);

  for (let tick = 1; tick <= 20; tick += 1) {
    room.update(15_800 + tick * 100);
  }

  assert.equal(player.lastSequence, 1, 'no further state packet advanced the jump');
  assert.equal(player.position[1], 0.02);
  assert.equal(player.verticalVelocity, 0);
  assert.equal(player.grounded, true);
  assert.ok(
    player.history.some((sample) => sample.at > 15_850),
    'passive server displacement must be available to rewind traces',
  );
  assert.equal(
    new Set(player.history.map((sample) => sample.at)).size,
    player.history.length,
    'physics and state samples at the same time must coalesce',
  );
});

test('holding a forged slide flag cannot grant permanent slide speed', () => {
  const session = createSession('Slide Limit');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 16_000,
    seed: 23,
  });
  const player = room.playerForSession(session);
  player.position = [-40, 0.02, 10];
  player.lastStateAt = 16_000;
  player.movementCredit = 0;
  const startX = player.position[0];

  for (let step = 1; step <= 100; step += 1) {
    room.handleState(session, {
      sequence: step,
      position: [player.position[0] + 0.5, 0.02, 10],
      velocity: [10, 0, 0],
      yaw: -Math.PI / 2,
      pitch: 0,
      grounded: true,
      sliding: true,
    }, 16_000 + step * 50);
  }

  const travelled = player.position[0] - startX;
  assert.ok(travelled < 41, `forged slide travelled ${travelled}m in five seconds`);
  assert.equal(player.sliding, false);
});

test('a claimed velocity cannot start a slide without prior accepted speed', () => {
  const session = createSession('Slide Rising Edge');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 16_500,
    seed: 27,
  });
  const player = room.playerForSession(session);
  player.position = [-40, 0.02, 10];
  player.lastStateAt = 16_500;
  player.movementCredit = 0;

  room.handleState(session, {
    sequence: 1,
    position: [...player.position],
    velocity: [10.1, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    sliding: false,
  }, 16_550);
  const before = [...player.position];
  room.handleState(session, {
    sequence: 2,
    position: [before[0] + 0.505, before[1], before[2]],
    velocity: [10.1, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    sliding: true,
  }, 16_600);

  assert.equal(player.sliding, false);
  assert.ok(
    player.position[0] - before[0] <= WAR_CLASSES.greatsword.speed * 1.35 * 0.1,
    `claimed velocity moved ${player.position[0] - before[0]}m`,
  );
});

test('server ticks expire a human slide after state packets stop', () => {
  const session = createSession('Paused Slide');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 16_700,
    seed: 31,
  });
  const player = room.playerForSession(session);
  disableAllExcept(room, [player.slot]);
  player.position = [-40, 0.02, 10];
  player.movementCredit = 0;

  room.handleState(session, {
    sequence: 1,
    position: [-39.66, 0.02, 10],
    velocity: [6.8, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    sliding: false,
  }, 16_750);
  room.handleState(session, {
    sequence: 2,
    position: [-39.18, 0.02, 10],
    velocity: [9.6, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    sliding: true,
  }, 16_800);
  assert.equal(player.sliding, true);

  room.update(17_700);

  assert.equal(player.lastSequence, 2);
  assert.equal(player.sliding, false);
});

test('validated War wall running receives its bounded movement allowance', () => {
  const session = createSession('Wall Runner');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 17_000,
    seed: 25,
  });
  const player = room.playerForSession(session);
  player.position = [-119.5, 0.7, 0];
  player.airborneSince = 17_000;
  player.lastStateAt = 17_000;
  player.movementCredit = 0;
  player.acceptedHorizontalSpeed = 9.4;
  player.verticalVelocity = 5;
  const startZ = player.position[2];

  for (let step = 1; step <= 20; step += 1) {
    room.handleState(session, {
      sequence: step,
      position: [-119.5, player.position[1], player.position[2] + 0.47],
      velocity: [0, 0, 9.4],
      yaw: Math.PI,
      pitch: 0,
      grounded: false,
      wallRunning: true,
    }, 17_000 + step * 50);
  }

  assert.ok(player.position[2] - startZ > 9, `wall run reached ${player.position[2] - startZ}m`);
  assert.equal(player.wallRunning, true);
});

test('requested height cannot grant grounded players wall-run movement credit', () => {
  const session = createSession('Grounded Wall Claim');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 18_500,
    seed: 28,
  });
  const player = room.playerForSession(session);
  player.position = [-119.5, 0.02, 0];
  player.lastStateAt = 18_500;
  player.movementCredit = 0;
  player.acceptedHorizontalSpeed = 9.4;
  const startZ = player.position[2];

  for (let step = 1; step <= 100; step += 1) {
    room.handleState(session, {
      sequence: step,
      position: [-119.5, 0.7, player.position[2] + 0.48],
      velocity: [0, 0, 9.6],
      yaw: Math.PI,
      pitch: 0,
      grounded: false,
      wallRunning: true,
    }, 18_500 + step * 50);
  }

  assert.ok(player.position[2] - startZ < 37, `grounded claim reached ${player.position[2] - startZ}m`);
  assert.equal(player.position[1], 0.02);
  assert.equal(player.wallRunning, false);
});

test('focus accuracy requires authoritative focused movement speed', () => {
  const session = createSession('Focus Speed');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['longbow'],
    now: 19_000,
    seed: 29,
  });
  const player = room.playerForSession(session);
  player.position = [0, 0.02, 50];
  player.lastStateAt = 19_000;
  player.movementCredit = 0;

  room.handleState(session, {
    sequence: 1,
    position: [0.4, 0.02, 50],
    velocity: [8, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    focused: true,
  }, 19_050);
  assert.equal(player.focused, false, 'full-speed movement cannot receive focus spread');

  room.handleState(session, {
    sequence: 2,
    position: [...player.position],
    velocity: [99, 0, 0],
    yaw: -Math.PI / 2,
    pitch: 0,
    grounded: true,
    focused: true,
  }, 19_100);
  assert.equal(player.focused, true, 'claimed velocity cannot hide an accepted stop');
});

test('malformed War shot directions are rejected without throwing', () => {
  const session = createSession('Malformed');
  const room = new WarRoom({ sessions: [session], now: 12_000, seed: 3 });
  const shooter = room.playerForSession(session);
  const startingAmmo = shooter.ammo;

  for (const direction of [undefined, null, 1, [], [0, 0], [0, 0, Infinity]]) {
    assert.doesNotThrow(() => room.handleShot(session, {
      shotId: 1,
      yaw: 0,
      pitch: 0,
      direction,
    }, 12_100));
  }
  assert.equal(shooter.lastShotId, 0);
  assert.equal(shooter.ammo, startingAmmo);
});

test('server-authoritative attacks damage, kill, change class, and respawn after 8 seconds', () => {
  const attackerSession = createSession('Attacker');
  const targetSession = createSession('Target');
  const room = new WarRoom({
    sessions: [attackerSession, targetSession],
    classIds: ['crossbow', 'shortbow'],
    now: 20_000,
    seed: 4,
  });
  const attacker = room.playerForSession(attackerSession);
  const target = room.playerForSession(targetSession);
  disableAllExcept(room, [attacker.slot, target.slot]);
  attacker.position = [-5, 0.02, 10];
  target.position = [5, 0.02, 10];
  attacker.lastAttackAt = -Infinity;
  target.damageProtectionUntil = 0;
  target.health = WAR_CLASSES.crossbow.damage;

  assert.equal(room.handleShot(attackerSession, {
    shotId: 1,
    yaw: -Math.PI / 2,
    pitch: 0,
    direction: [1, 0, 0],
  }, 20_100), true);
  assert.equal(target.health, 0);
  assert.equal(target.dead, true);
  assert.equal(target.respawnAt, 28_100);
  assert.equal(attacker.kills, 1);
  assert.equal(target.deaths, 1);
  assert.equal(attacker.ammo, 0);
  assert.equal(attacker.reserve, WAR_CLASSES.crossbow.reserve);
  assert.equal(attacker.reloadEndsAt, Infinity);

  assert.equal(room.handleSelectClass(targetSession, { classId: 'greatsword' }, 20_200), true);
  room.nextBotAt = Infinity;
  room.update(28_099);
  assert.equal(target.dead, true);
  room.update(28_100);
  assert.equal(target.dead, false);
  assert.equal(target.classId, 'greatsword');
  assert.equal(target.health, WAR_CLASSES.greatsword.health);
  assert.equal(target.maxHealth, WAR_CLASSES.greatsword.health);
});

test('greatsword uses a broad forward melee arc without consuming ammunition', () => {
  const session = createSession('Sword');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['greatsword'],
    now: 30_000,
    seed: 5,
  });
  const attacker = room.playerForSession(session);
  const enemies = room.players.filter((player) => player.team !== attacker.team).slice(0, 4);
  disableAllExcept(room, [attacker.slot, ...enemies.map((player) => player.slot)]);
  attacker.position = [0, 0.02, 8];
  attacker.lastAttackAt = -Infinity;
  enemies[0].position = [3, 0.02, 8];
  enemies[1].position = [2.6, 0.02, 9.3];
  enemies[2].position = [2.6, 0.02, 6.7];
  enemies[3].position = [-2, 0.02, 8];
  for (const enemy of enemies) enemy.health = enemy.maxHealth;
  const startingHealth = enemies.map((enemy) => enemy.health);

  assert.equal(room.handleShot(session, {
    shotId: 1,
    yaw: -Math.PI / 2,
    pitch: 0,
    direction: [1, 0, 0],
  }, 30_100), true);
  assert.ok(enemies.slice(0, 3).every((enemy, index) =>
    enemy.health === startingHealth[index] - WAR_CLASSES.greatsword.damage
  ));
  assert.equal(enemies[3].health, startingHealth[3]);
  assert.equal(attacker.ammo, WAR_CLASSES.greatsword.ammo);
  assert.equal(attacker.reserve, 0);
  assert.equal(room.handleReload(session, 30_200), false);
});

test('War exposes all Arena loadouts and keeps each magazine behavior', () => {
  assert.deepEqual(WAR_CLASS_IDS, [
    'knives',
    'shortbow',
    'ember',
    'crossbow',
    'greatsword',
    'lightning',
    'longbow',
    'fireball',
  ]);
  for (const classId of WAR_CLASS_IDS) {
    const definition = WAR_CLASSES[classId];
    const arena = ARENA_WEAPONS[classId];
    assert.equal(definition.weapon, classId, classId);
    assert.equal(definition.ammo, arena.ammo, `${classId} ammo`);
    assert.equal(definition.reserve, arena.reserve, `${classId} reserve`);
    assert.equal(definition.reloadMs, arena.reloadMs, `${classId} reload`);
    assert.equal(definition.usesAmmo, arena.usesAmmo !== false, `${classId} usesAmmo`);
    assert.equal(definition.attackMs, arena.interval * 1_000, `${classId} cadence`);
    assert.equal(definition.damage, arena.damage, `${classId} damage`);
    assert.equal(definition.headMultiplier, arena.headMultiplier, `${classId} head multiplier`);
    assert.equal(definition.spread, arena.spread, `${classId} spread`);
    assert.equal(definition.focusSpread, arena.focusSpread, `${classId} focus spread`);
    assert.equal(definition.pellets, arena.pellets, `${classId} pellets`);
    assert.equal(definition.range, arena.range, `${classId} range`);
    assert.equal(Boolean(definition.projectile), Boolean(arena.projectile), `${classId} projectile`);
  }
});

test('War hitscan authority preserves Ember pellets and ranged head multipliers', () => {
  const emberSession = createSession('Pellets');
  const emberRoom = new WarRoom({
    sessions: [emberSession],
    classIds: ['ember'],
    now: 34_000,
    seed: 0x51a7,
  });
  const ember = emberRoom.playerForSession(emberSession);
  const emberTarget = emberRoom.players.find((player) => player.team !== ember.team);
  emberRoom.setClass(emberTarget, 'greatsword', false);
  disableAllExcept(emberRoom, [ember.slot, emberTarget.slot]);
  ember.position = [0, 0.02, 2.5];
  emberTarget.position = [0, 0.02, 0.5];
  ember.focused = true;
  ember.lastAttackAt = -Infinity;

  assert.equal(emberRoom.handleShot(emberSession, {
    shotId: 1,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, 34_100), true);
  const emberAttack = emberSession.encoded
    .map(({ message }) => JSON.parse(message))
    .find((message) => message.event === 'attack' && message.shooter === ember.slot);
  assert.equal(emberAttack.traces.length, WAR_CLASSES.ember.pellets);
  assert.ok(emberAttack.hitCount > 1, `expected multiple pellets, got ${emberAttack.hitCount}`);
  assert.ok(emberAttack.damage > WAR_CLASSES.ember.damage);
  assert.equal(emberAttack.hits[0].hitCount, emberAttack.hitCount);

  const crossbowSession = createSession('Headshot');
  const crossbowRoom = new WarRoom({
    sessions: [crossbowSession],
    classIds: ['crossbow'],
    now: 34_500,
    seed: 0x51a8,
  });
  const crossbow = crossbowRoom.playerForSession(crossbowSession);
  const headTarget = crossbowRoom.players.find((player) => player.team !== crossbow.team);
  crossbowRoom.setClass(headTarget, 'greatsword', false);
  disableAllExcept(crossbowRoom, [crossbow.slot, headTarget.slot]);
  crossbow.position = [0, 0.02, 10];
  headTarget.position = [0, 0.02, 0];
  crossbow.focused = true;
  crossbow.lastAttackAt = -Infinity;
  const vertical = CHARACTER_HITBOX.head.offsetY - 1.58;
  const length = Math.hypot(10, vertical);
  const direction = [0, vertical / length, -10 / length];
  const pitch = Math.asin(direction[1]);

  assert.equal(crossbowRoom.handleShot(crossbowSession, {
    shotId: 1,
    yaw: 0,
    pitch,
    direction,
  }, 34_600), true);
  const headshot = crossbowSession.encoded
    .map(({ message }) => JSON.parse(message))
    .find((message) => message.event === 'attack' && message.shooter === crossbow.slot);
  assert.equal(headshot.headshot, true);
  assert.equal(
    headshot.damage,
    Math.round(WAR_CLASSES.crossbow.damage * WAR_CLASSES.crossbow.headMultiplier * 10) / 10,
  );
});

test('War rewinds targets for measured latency and clears temporary history state', () => {
  const session = createSession('Lag Comp');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['crossbow'],
    now: 45_000,
    seed: 0x600d,
  });
  const shooter = room.playerForSession(session);
  const target = room.players.find((player) => player.team !== shooter.team);
  room.setClass(target, 'greatsword', false);
  disableAllExcept(room, [shooter.slot, target.slot]);
  shooter.position = [0, 0.02, 10];
  shooter.focused = true;
  shooter.rtt = 400;
  shooter.lastAttackAt = -Infinity;
  target.position = [4, 0.02, 0];
  target.history = [
    { at: 44_900, position: [0, 0.02, 0] },
    { at: 45_100, position: [4, 0.02, 0] },
  ];
  const startingHealth = target.health;

  assert.equal(room.handleShot(session, {
    shotId: 1,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, 45_100), true);
  assert.ok(target.health < startingHealth, 'historical target position should be hit');
  assert.equal('rewoundPosition' in target, false);
});

test('War uses the slide eye height and increases airborne weapon spread', () => {
  const groundSession = createSession('Ground Aim');
  const groundRoom = new WarRoom({
    sessions: [groundSession],
    classIds: ['crossbow'],
    now: 46_000,
    seed: 0xabc1,
  });
  const ground = groundRoom.playerForSession(groundSession);
  disableAllExcept(groundRoom, [ground.slot]);
  ground.position = [10, 0.02, 10];
  ground.focused = false;
  ground.grounded = true;
  ground.sliding = true;
  const slideResult = groundRoom.performRangedAttack(ground, [0, 0, -1], 46_100, 7);
  assert.equal(slideResult.origin[1], 0.94);

  ground.sliding = false;
  const groundedResult = groundRoom.performRangedAttack(ground, [0, 0, -1], 46_100, 8);
  ground.grounded = false;
  const airborneResult = groundRoom.performRangedAttack(ground, [0, 0, -1], 46_100, 8);
  const deviation = (result) => {
    const vector = result.traces[0].map((value, axis) => value - result.origin[axis]);
    const length = Math.hypot(...vector);
    return Math.acos(Math.max(-1, Math.min(1, -vector[2] / length)));
  };
  assert.ok(
    deviation(airborneResult) > deviation(groundedResult) * 1.3,
    `${deviation(groundedResult)} ground vs ${deviation(airborneResult)} air`,
  );
});

test('an empty trigger starts a quiet server reload while knives, bows, and sword remain ammo-free', () => {
  const crossbowSession = createSession('Crossbow');
  const room = new WarRoom({
    sessions: [crossbowSession],
    classIds: ['crossbow'],
    now: 32_000,
    seed: 6,
  });
  const crossbow = room.playerForSession(crossbowSession);
  const enemy = room.players.find((player) => player.team !== crossbow.team);
  disableAllExcept(room, [crossbow.slot, enemy.slot]);
  room.nextBotAt = Infinity;
  crossbow.position = [0, 0.02, 15];
  enemy.position = [0, 0.02, 0];
  crossbow.lastAttackAt = -Infinity;

  assert.equal(room.handleShot(crossbowSession, {
    shotId: 1,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, 32_100), true);
  assert.equal(crossbow.ammo, 0);
  assert.equal(room.handleShot(crossbowSession, {
    shotId: 2,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, 32_101), false);
  assert.equal(crossbow.reloadEndsAt, 32_101 + WAR_CLASSES.crossbow.reloadMs);
  assert.equal(
    crossbowSession.messages.some((message) => message.event === 'reload'),
    false,
    'reload state stays in the minimal HUD instead of creating toast chatter',
  );
  room.update(crossbow.reloadEndsAt);
  assert.equal(crossbow.ammo, WAR_CLASSES.crossbow.ammo);
  assert.equal(crossbow.reserve, WAR_CLASSES.crossbow.reserve - 1);
  assert.equal(crossbow.reloadEndsAt, Infinity);

  for (const classId of ['knives', 'shortbow', 'longbow', 'greatsword']) {
    assert.equal(WAR_CLASSES[classId].usesAmmo, false);
    assert.equal(WAR_CLASSES[classId].reloadMs, 0);
  }
});

test('fireball attacks create one server projectile and damage only on impact', () => {
  const session = createSession('Fireball');
  const room = new WarRoom({
    sessions: [session],
    classIds: ['fireball'],
    now: 35_000,
    seed: 7,
  });
  const shooter = room.playerForSession(session);
  const target = room.players.find((player) => player.team !== shooter.team);
  disableAllExcept(room, [shooter.slot, target.slot]);
  shooter.position = [0, 0.02, 20];
  target.position = [0, 0.02, 14];
  shooter.lastAttackAt = -Infinity;
  const startingHealth = target.health;

  assert.equal(room.handleShot(session, {
    shotId: 1,
    yaw: 0,
    pitch: 0,
    direction: [0, 0, -1],
  }, 35_100), true);
  assert.equal(room.projectiles.length, 1);
  assert.equal(target.health, startingHealth, 'the viewmodel shot is not duplicate damage');
  assert.equal(room.snapshot(35_100).projectiles.length, 1);

  room.updateProjectiles(35_300);
  room.updateProjectiles(35_400);
  assert.equal(room.projectiles.length, 0);
  assert.ok(target.health < startingHealth);
  assert.ok(session.encoded.some(({ message }) =>
    JSON.parse(message).event === 'projectile_explode'));
});

test('a wall-face fireball splash reaches exposed targets and carries server impulse', () => {
  const session = createSession('Splash');
  const targetSession = createSession('Splash Target');
  const room = new WarRoom({
    sessions: [session, targetSession],
    classIds: ['fireball', 'greatsword'],
    now: 36_000,
    seed: 70,
  });
  const shooter = room.playerForSession(session);
  const target = room.playerForSession(targetSession);
  disableAllExcept(room, [shooter.slot, target.slot]);
  shooter.position = [-30, 0.02, 0];
  target.position = [-14, 0.02, 0];
  targetSession.messages.length = 0;
  const startingHealth = target.health;
  room.projectiles.push({
    id: 900,
    owner: shooter.slot,
    team: shooter.team,
    classId: 'fireball',
    position: [-16, 0.92, 0],
    velocity: [1, 0, 0],
    remaining: 1,
    updatedAt: 36_000,
  });

  room.explodeWarProjectile(0, [-16, 0.92, 0], 36_100);
  const encoded = session.encoded.at(-1);
  const explosion = JSON.parse(encoded.message);
  const hit = explosion.damage.find((entry) => entry.player === target.slot);
  const impulseEvent = targetSession.messages.find(
    (message) => message.event === 'impulse',
  );
  assert.ok(target.health < startingHealth);
  assert.ok(hit);
  assert.equal('impulse' in hit, false, 'volatile VFX event must not carry authority');
  assert.ok(impulseEvent.impulse[0] > 0);
  assert.ok(target.velocity[0] > 0);
  assert.deepEqual(encoded.options, { volatile: true });
});

test('fireball knockback moves human and bot positions under server authority', () => {
  const shooterSession = createSession('Knockback Caster');
  const targetSession = createSession('Knockback Target');
  const humanRoom = new WarRoom({
    sessions: [shooterSession, targetSession],
    classIds: ['fireball', 'greatsword'],
    now: 37_000,
    seed: 73,
  });
  const shooter = humanRoom.playerForSession(shooterSession);
  const target = humanRoom.playerForSession(targetSession);
  disableAllExcept(humanRoom, [shooter.slot, target.slot]);
  shooter.position = [-30, 0.02, 0];
  target.position = [-14, 0.02, 0];
  target.lastStateAt = 37_100;
  target.movementCredit = 0;
  humanRoom.projectiles.push({
    id: 901,
    owner: shooter.slot,
    team: shooter.team,
    classId: 'fireball',
    position: [-16, 0.92, 0],
    velocity: [1, 0, 0],
    remaining: 1,
    updatedAt: 37_000,
  });
  humanRoom.explodeWarProjectile(0, [-16, 0.92, 0], 37_100);
  const humanStartX = target.position[0];
  humanRoom.handleState(targetSession, {
    sequence: 1,
    position: [humanStartX, 0.02, 0],
    velocity: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    grounded: true,
  }, 37_150);
  assert.ok(
    target.position[0] > humanStartX + 0.15,
    `human resisted knockback at ${target.position[0] - humanStartX}m`,
  );
  assert.ok(target.position[1] > 0.02, 'server integrates the vertical impulse');

  const botShooterSession = createSession('Bot Knockback Caster');
  const botRoom = new WarRoom({
    sessions: [botShooterSession],
    classIds: ['fireball'],
    now: 38_000,
    seed: 74,
  });
  const botShooter = botRoom.playerForSession(botShooterSession);
  const botTarget = botRoom.players.find((player) =>
    player.team !== botShooter.team && player.bot);
  disableAllExcept(botRoom, [botShooter.slot, botTarget.slot]);
  botTarget.position = botRoom.botDestination(botTarget);
  const botStartX = botTarget.position[0];
  botRoom.projectiles.push({
    id: 902,
    owner: botShooter.slot,
    team: botShooter.team,
    classId: 'fireball',
    position: [botStartX + 2, 0.92, botTarget.position[2]],
    velocity: [-1, 0, 0],
    remaining: 1,
    updatedAt: 38_000,
  });
  botRoom.explodeWarProjectile(
    0,
    [botStartX + 2, 0.92, botTarget.position[2]],
    38_100,
  );
  botRoom.updateBotMovement(botTarget, 0.1, 38_200);
  assert.ok(
    botTarget.position[0] < botStartX - 0.1,
    `bot ignored knockback at ${botTarget.position[0] - botStartX}m`,
  );
  assert.ok(botTarget.position[1] > 0.02, 'bot keeps the vertical impulse');
});

test('server ticks finish human fireball knockback without follow-up state packets', () => {
  const shooterSession = createSession('Paused Knockback Caster');
  const targetSession = createSession('Paused Knockback Target');
  const room = new WarRoom({
    sessions: [shooterSession, targetSession],
    classIds: ['fireball', 'greatsword'],
    now: 39_000,
    seed: 75,
  });
  const shooter = room.playerForSession(shooterSession);
  const target = room.playerForSession(targetSession);
  disableAllExcept(room, [shooter.slot, target.slot]);
  shooter.position = [-30, 0.02, 0];
  target.position = [-14, 0.02, 0];
  target.history = [{ at: 39_000, position: [...target.position] }];
  room.projectiles.push({
    id: 903,
    owner: shooter.slot,
    team: shooter.team,
    classId: 'fireball',
    position: [-16, 0.92, 0],
    velocity: [1, 0, 0],
    remaining: 1,
    updatedAt: 39_000,
  });

  room.explodeWarProjectile(0, [-16, 0.92, 0], 39_100);
  const startX = target.position[0];
  assert.ok(target.knockbackVelocity[0] > 0);
  assert.ok(target.verticalVelocity > 0);

  for (let tick = 1; tick <= 20; tick += 1) {
    room.update(39_000 + tick * 100);
  }

  assert.equal(target.lastSequence, 0, 'the target sent no state after the impulse');
  assert.ok(target.position[0] > startX + 0.2, `knockback moved ${target.position[0] - startX}m`);
  assert.ok(Math.hypot(target.knockbackVelocity[0], target.knockbackVelocity[2]) < 0.001);
  assert.equal(target.position[1], 0.02);
  assert.equal(target.verticalVelocity, 0);
  assert.equal(target.grounded, true);
  assert.ok(
    target.history.some((sample) => sample.at > 39_100),
    'passive knockback must update rewind history',
  );
});

test('WarControl receives living point occupancy and can end the one-round match', () => {
  const room = new WarRoom({
    now: 40_000,
    seed: 8,
    rules: {
      unlockMs: 0,
      captureMs: 100,
      scorePerSecond: 1_000,
      scoreToWin: 100,
      overtimeThreshold: 99,
    },
  });
  const controller = room.players[0];
  disableAllExcept(room, [controller.slot]);
  controller.position = [0, 0.02, 0];
  for (let tick = 1; tick <= 3; tick += 1) room.update(40_000 + tick * 100);

  assert.equal(room.control.owner, 0);
  assert.equal(room.control.scores[0], 100);
  assert.equal(room.phase, 'result');
  assert.equal(room.winner, 0);
  assert.equal(room.resultReason, 'control');
});

test('snapshot is client-friendly, pickup-free, shared once, and stays within budget', () => {
  const first = createSession('One');
  const second = createSession('Two');
  const room = new WarRoom({
    sessions: [first, second],
    classIds: ['lightning', 'greatsword'],
    now: 50_000,
    seed: 10,
  });
  const snapshot = room.snapshot(50_000);
  assert.equal(snapshot.combatants.length, 80);
  assert.deepEqual(snapshot.pickups, []);
  assert.equal(snapshot.combatants[0].ammo, WAR_CLASSES.lightning.ammo);
  assert.equal(snapshot.combatants[0].reserve, WAR_CLASSES.lightning.reserve);
  assert.equal(snapshot.combatants[0].usesAmmo, true);
  assert.equal(snapshot.combatants[1].usesAmmo, false);
  assert.equal(snapshot.combatants[0].reloading, false);
  assert.deepEqual(snapshot.projectiles, []);
  for (const field of [
    'id', 'team', 'human', 'name', 'classId',
    'position', 'velocity', 'yaw', 'pitch', 'health', 'maxHealth',
    'ammo', 'reserve', 'usesAmmo', 'reloading', 'reloadRemaining',
    'dead', 'respawnRemaining', 'attackSequence', 'ack', 'shotAck',
  ]) {
    assert.ok(field in snapshot.combatants[0], field);
  }
  assert.equal('slot' in snapshot.combatants[0], false);
  assert.equal('teamSlot' in snapshot.combatants[0], false);
  assert.equal('weapon' in snapshot.combatants[0], false);
  const byteLength = Buffer.byteLength(JSON.stringify({
    type: 'war_snapshot',
    roomId: room.id,
    state: snapshot,
  }));
  assert.ok(byteLength < 28 * 1_024, `${byteLength} byte snapshot`);

  first.encoded.length = 0;
  second.encoded.length = 0;
  room.broadcastSnapshot(50_100);
  assert.equal(first.encoded.length, 1);
  assert.equal(second.encoded.length, 1);
  assert.equal(first.encoded[0].message, second.encoded[0].message);
  assert.deepEqual(first.encoded[0].options, { volatile: true });
});

test('80-agent fixed-tick simulation and snapshot encoding stay inside server budgets', () => {
  const room = new WarRoom({ now: 60_000, seed: 12, rules: { unlockMs: 0 } });
  const startedAt = performance.now();
  for (let tick = 1; tick <= 300; tick += 1) room.update(60_000 + tick * 100);
  const simulationMs = performance.now() - startedAt;
  assert.ok(simulationMs < 1_500, `${simulationMs.toFixed(1)} ms for 300 ticks`);
  assert.equal(room.players.length, 80);

  const snapshotStartedAt = performance.now();
  let totalBytes = 0;
  for (let index = 0; index < 100; index += 1) {
    totalBytes += Buffer.byteLength(JSON.stringify(room.snapshot(90_000 + index)));
  }
  const snapshotMs = performance.now() - snapshotStartedAt;
  assert.ok(snapshotMs < 1_000, `${snapshotMs.toFixed(1)} ms for 100 snapshots`);
  assert.ok(totalBytes / 100 < 28 * 1_024);
});
