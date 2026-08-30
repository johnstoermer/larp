import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WAR_COMBATANT_COUNT,
  WAR_MAP,
  WAR_MODES,
  WAR_MODE_CONTROL,
  WAR_MODE_TEAM_DEATHMATCH,
  WAR_RULES,
  WAR_TEAM_SIZE,
  normalizeWarMode,
} from '../shared/warConfig.js';
import { WarRoom } from '../server/multiplayer/WarRoom.js';

function disableAllExcept(room, slots) {
  const enabled = new Set(slots);
  for (const player of room.players) {
    if (enabled.has(player.slot)) continue;
    player.dead = true;
    player.health = 0;
    player.respawnAt = Infinity;
  }
}

test('shared War mode identifiers normalize aliases and retain 20v20 teams', () => {
  assert.deepEqual(Object.keys(WAR_MODES), [
    WAR_MODE_CONTROL,
    WAR_MODE_TEAM_DEATHMATCH,
  ]);
  assert.equal(normalizeWarMode(undefined), WAR_MODE_CONTROL);
  assert.equal(normalizeWarMode('control'), WAR_MODE_CONTROL);
  assert.equal(normalizeWarMode('tdm'), WAR_MODE_TEAM_DEATHMATCH);
  assert.equal(normalizeWarMode('team-deathmatch'), WAR_MODE_TEAM_DEATHMATCH);
  assert.equal(WAR_MODES[WAR_MODE_TEAM_DEATHMATCH].scoreToWin, 100);
  assert.equal(WAR_RULES.respawnMs, 5_000);

  const room = new WarRoom({
    now: 1_000,
    seed: 0x7d4,
    warMode: WAR_MODE_TEAM_DEATHMATCH,
  });
  assert.equal(room.players.length, WAR_COMBATANT_COUNT);
  assert.equal(room.players.filter(({ team }) => team === 0).length, WAR_TEAM_SIZE);
  assert.equal(room.players.filter(({ team }) => team === 1).length, WAR_TEAM_SIZE);
  assert.equal(room.phase, 'combat');
  assert.equal(room.control, null);
  assert.deepEqual(room.teamScores, [0, 0]);
});

test('Team Deathmatch ignores control-point occupancy and scores only enemy kills', () => {
  const room = new WarRoom({
    now: 2_000,
    seed: 0x71d,
    warMode: WAR_MODE_TEAM_DEATHMATCH,
  });
  const controller = room.players[0];
  disableAllExcept(room, [controller.slot]);
  controller.bot = false;
  controller.position = [...WAR_MAP.objective.position];

  room.runBotTick(2_100);

  assert.ok(room.objectiveOccupancy()[0] > 0);
  assert.equal(room.control, null);
  assert.deepEqual(room.teamScores, [0, 0]);
  assert.equal(room.phase, 'combat');
  const snapshot = room.snapshot(2_100);
  assert.equal(snapshot.warMode, WAR_MODE_TEAM_DEATHMATCH);
  assert.equal(snapshot.control, null);
  assert.deepEqual(snapshot.teamScores, [0, 0]);
  assert.equal(snapshot.scoreToWin, 100);
});

test('Team Deathmatch ends on the hundredth enemy kill and cannot overscore', () => {
  const room = new WarRoom({
    now: 3_000,
    seed: 0x100,
    warMode: WAR_MODE_TEAM_DEATHMATCH,
    rules: { respawnMs: 0 },
  });
  const attacker = room.players[0];
  const target = room.players[WAR_TEAM_SIZE];
  disableAllExcept(room, [attacker.slot, target.slot]);
  const events = [];
  room.broadcast = (payload) => events.push(payload);
  room.broadcastSnapshot = () => {};

  for (let kill = 1; kill <= 100; kill += 1) {
    target.health = 1;
    target.dead = false;
    target.damageContributors.clear();
    assert.equal(room.applyDamage(target, 1, attacker, 3_000 + kill), 1);
    assert.equal(room.teamScores[0], kill);
    if (kill < 100) {
      assert.equal(room.phase, 'combat');
      room.respawn(target, 3_000 + kill, false);
    }
  }

  assert.deepEqual(room.teamScores, [100, 0]);
  assert.equal(attacker.kills, 100);
  assert.equal(target.deaths, 100);
  assert.equal(room.phase, 'result');
  assert.equal(room.winner, 0);
  assert.equal(room.resultReason, 'kills');
  assert.equal(
    events.filter(({ event }) => event === 'match_end').length,
    1,
  );
  assert.deepEqual(
    events.find(({ event }) => event === 'match_end').scores,
    [100, 0],
  );
  assert.equal(room.applyDamage(target, 1, attacker, 3_200), 0);
  assert.deepEqual(room.teamScores, [100, 0]);
});

test('same-tick hundredth bot kills both resolve before a deterministic winner', () => {
  const room = new WarRoom({
    now: 4_000,
    seed: 0xdecafbad,
    warMode: WAR_MODE_TEAM_DEATHMATCH,
  });
  const red = room.players[4];
  const blue = room.players[WAR_TEAM_SIZE + 4];
  disableAllExcept(room, [red.slot, blue.slot]);
  room.updateBotMovement = () => {};
  room.setClass(red, 'greatsword', false);
  room.setClass(blue, 'greatsword', false);
  red.position = [-1, 0.02, 0];
  blue.position = [1, 0.02, 0];
  red.health = 1;
  blue.health = 1;
  red.botDamageScale = 1;
  blue.botDamageScale = 1;
  red.botMeleeAccuracy = 1;
  blue.botMeleeAccuracy = 1;
  red.botTargetSlot = blue.slot;
  blue.botTargetSlot = red.slot;
  red.botTargetRefreshAt = Infinity;
  blue.botTargetRefreshAt = Infinity;
  red.lastAttackAt = -Infinity;
  blue.lastAttackAt = -Infinity;
  room.teamScores = [99, 99];
  const events = [];
  room.broadcast = (payload) => events.push(payload);
  room.broadcastSnapshot = () => {};

  room.runBotTick(4_100);

  assert.equal(red.dead, true);
  assert.equal(blue.dead, true);
  assert.equal(red.deaths, 1);
  assert.equal(blue.deaths, 1);
  assert.deepEqual(room.teamScores, [100, 100]);
  assert.equal(room.phase, 'result');
  assert.ok(room.winner === 0 || room.winner === 1);
  assert.equal(events.filter(({ event }) => event === 'death').length, 2);
  assert.equal(events.filter(({ event }) => event === 'match_end').length, 1);
});

test('War snapshots and death events carry authoritative K/D/A with timed assists', () => {
  const room = new WarRoom({ now: 5_000, seed: 0xa55157 });
  const killer = room.players[0];
  const assister = room.players[1];
  const target = room.players[WAR_TEAM_SIZE];
  disableAllExcept(room, [killer.slot, assister.slot, target.slot]);
  const events = [];
  room.broadcast = (payload) => events.push(payload);
  target.health = 100;

  assert.equal(room.applyDamage(target, 30, assister, 5_100), 30);
  assert.equal(room.applyDamage(target, 70, killer, 5_200), 70);
  assert.equal(killer.kills, 1);
  assert.equal(killer.assists, 0);
  assert.equal(assister.kills, 0);
  assert.equal(assister.assists, 1);
  assert.equal(target.deaths, 1);
  assert.deepEqual(
    events.find(({ event }) => event === 'death').assists,
    [assister.slot],
  );

  const snapshot = room.snapshot(5_200);
  assert.deepEqual(
    ['kills', 'deaths', 'assists'].map((field) =>
      snapshot.combatants[killer.slot][field]),
    [1, 0, 0],
  );
  assert.deepEqual(
    ['kills', 'deaths', 'assists'].map((field) =>
      snapshot.combatants[assister.slot][field]),
    [0, 0, 1],
  );

  room.respawn(target, 20_000, false);
  target.health = 100;
  room.applyDamage(target, 30, assister, 20_100);
  room.applyDamage(target, 70, killer, 30_101);
  assert.equal(assister.assists, 1, 'expired damage is not an assist');
  assert.equal(killer.kills, 2);
  assert.equal(target.deaths, 2);
});

test('seeded Team Deathmatch bots remain deterministic with authoritative scores', () => {
  const options = {
    now: 40_000,
    seed: 0x44dd11,
    warMode: WAR_MODE_TEAM_DEATHMATCH,
    rules: { scoreToWin: 999_999, respawnMs: 3_000 },
  };
  const first = new WarRoom(options);
  const second = new WarRoom(options);
  for (let tick = 1; tick <= 120; tick += 1) {
    first.update(40_000 + tick * 100);
    second.update(40_000 + tick * 100);
  }
  const state = (room) => ({
    phase: room.phase,
    scores: room.teamScores,
    players: room.players.map((player) => ({
      position: player.position,
      health: player.health,
      dead: player.dead,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
    })),
  });
  assert.deepEqual(state(first), state(second));
  assert.equal(first.phase, 'combat');
});
