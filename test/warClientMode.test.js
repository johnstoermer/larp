import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatWarScore,
  lobbyModeForWarMode,
  normalizeLobbyMode,
  warModeForLobbyMode,
} from '../src/game/Game.js';
import { Interface } from '../src/game/Interface.js';
import {
  WAR_MODE_CONTROL,
  WAR_MODE_TEAM_DEATHMATCH,
} from '../shared/warConfig.js';

function classListProbe() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
  };
}

function element() {
  return {
    classList: classListProbe(),
    setAttribute() {},
    style: { width: '' },
    textContent: '',
  };
}

test('lobby selections map to distinct authoritative War modes', () => {
  assert.equal(normalizeLobbyMode('arena'), 'arena');
  assert.equal(normalizeLobbyMode('arena-2v2'), 'arena-2v2');
  assert.equal(normalizeLobbyMode('arena_2v2'), 'arena-2v2');
  assert.equal(normalizeLobbyMode('war'), 'war');
  assert.equal(normalizeLobbyMode('war-tdm'), 'war-tdm');
  assert.equal(normalizeLobbyMode('unknown'), 'arena');
  assert.equal(warModeForLobbyMode('war'), WAR_MODE_CONTROL);
  assert.equal(warModeForLobbyMode('war-tdm'), WAR_MODE_TEAM_DEATHMATCH);
  assert.equal(lobbyModeForWarMode(WAR_MODE_CONTROL), 'war');
  assert.equal(lobbyModeForWarMode(WAR_MODE_TEAM_DEATHMATCH), 'war-tdm');
  assert.equal(formatWarScore(99.8, WAR_MODE_CONTROL), '99%');
  assert.equal(formatWarScore(100, WAR_MODE_TEAM_DEATHMATCH), '100');
});

test('Team Deathmatch HUD shows kill scores and no control-point UI', () => {
  let matchMode = null;
  const ui = {
    warMode: WAR_MODE_CONTROL,
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
    updateRespawnCountdown() {},
    setWarMatch(_active, _team, warMode) {
      matchMode = warMode;
    },
  };

  Interface.prototype.updateWarHUD.call(
    ui,
    null,
    {
      dead: false,
      health: 90,
      maxHealth: 100,
      ammo: 0,
      reserve: 0,
      usesAmmo: false,
    },
    0,
    {
      warMode: WAR_MODE_TEAM_DEATHMATCH,
      teamScores: [37, 42],
      scoreToWin: 100,
    },
  );

  assert.equal(ui.warRedScore.textContent, '37');
  assert.equal(ui.warBlueScore.textContent, '42');
  assert.equal(ui.roundLabel.textContent, 'Team Deathmatch');
  assert.equal(ui.timer.textContent, '');
  assert.equal(ui.warCapture.classList.contains('hidden'), true);
  assert.equal(matchMode, WAR_MODE_TEAM_DEATHMATCH);
});
