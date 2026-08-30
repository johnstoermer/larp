import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreboardRows,
  observedArenaStats,
} from '../src/game/scoreboard.js';

test('scoreboard puts the local player first, then allies, with only K/D/A stats', () => {
  const rows = buildScoreboardRows([
    { id: 3, team: 1, name: 'Enemy', kills: 9, deaths: 2, assists: 1 },
    { id: 2, team: 0, name: 'Ally', kills: 2, deaths: 4, assists: 7 },
    { id: 1, team: 0, name: 'Local', kills: 1, deaths: 3, assists: 5 },
  ], { localId: 1, localTeam: 0 });

  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3]);
  assert.deepEqual(Object.keys(rows[0]), [
    'id', 'name', 'kills', 'deaths', 'assists', 'local', 'ally',
  ]);
  assert.deepEqual(
    rows.map(({ kills, deaths, assists }) => [kills, deaths, assists]),
    [[1, 3, 5], [2, 4, 7], [9, 2, 1]],
  );
});

test('scoreboard safely normalizes absent and invalid snapshot stats', () => {
  const [row] = buildScoreboardRows([
    { id: 'player', name: '', kills: -4, deaths: '3.9', assists: Number.NaN },
  ], { localId: 'player' });
  assert.equal(row.name, 'Player');
  assert.equal(row.kills, 0);
  assert.equal(row.deaths, 3);
  assert.equal(row.assists, 0);
});

test('Arena fallback stats count each alive-to-dead transition once', () => {
  const initial = [
    { kills: 0, deaths: 0, assists: 0 },
    { kills: 0, deaths: 0, assists: 0 },
  ];
  const alive = {
    players: [{ slot: 0, dead: false }, { slot: 1, dead: false }],
  };
  const mutual = {
    players: [{ slot: 0, dead: true }, { slot: 1, dead: true }],
  };
  const first = observedArenaStats(alive, mutual, initial);
  const repeated = observedArenaStats(mutual, mutual, first);

  assert.deepEqual(first, [
    { kills: 1, deaths: 1, assists: 0 },
    { kills: 1, deaths: 1, assists: 0 },
  ]);
  assert.deepEqual(repeated, first);
});
