import { clamp, formatTime } from './math.js';
import {
  WAR_MODE_TEAM_DEATHMATCH,
  normalizeWarMode,
} from '../../shared/warConfig.js';

const byId = (id) => document.getElementById(id);

export function shouldShowWarRespawnClass(warMatch, player) {
  return Boolean(warMatch && player?.dead);
}

export function respawnCountdownText(player) {
  const remaining = Number(player?.respawnRemaining);
  if (!player?.dead || !Number.isFinite(remaining) || remaining <= 0) return '';
  return `Respawn: ${Math.max(1, Math.ceil(remaining / 1_000))}`;
}

export class Interface {
  constructor() {
    this.titleScreen = byId('title-screen');
    this.hud = byId('hud');
    this.announcement = byId('announcement');
    this.pauseScreen = byId('pause-screen');
    this.resultScreen = byId('result-screen');
    this.errorScreen = byId('error-screen');
    this.startButton = byId('start-button');
    this.onlineButton = byId('online-button');
    this.privateButton = byId('private-button');
    this.callsign = byId('callsign');
    this.gameMode = byId('game-mode');
    this.warClass = byId('war-class');
    this.warClassField = byId('war-class-field');
    this.warRespawnClass = byId('war-respawn-class');
    this.warRespawnClassField = byId('war-respawn-class-field');
    this.arenaActions = byId('arena-actions');
    this.resumeButton = byId('resume-button');
    this.restartButton = byId('restart-button');
    this.quitButton = byId('quit-button');
    this.rematchButton = byId('rematch-button');
    this.resultQuitButton = byId('result-quit-button');
    this.audioToggle = byId('audio-toggle');
    this.sensitivity = byId('sensitivity');
    this.qualityProfile = byId('quality-profile');
    this.networkLobby = byId('network-lobby');
    this.lobbyKicker = byId('lobby-kicker');
    this.lobbyTitle = byId('lobby-title');
    this.lobbyDetail = byId('lobby-detail');
    this.lobbyCloseButton = byId('lobby-close-button');
    this.privateRoomControls = byId('private-room-controls');
    this.createRoomButton = byId('create-room-button');
    this.roomCodeInput = byId('room-code-input');
    this.joinRoomButton = byId('join-room-button');
    this.queueState = byId('queue-state');
    this.queueCode = byId('queue-code');
    this.copyRoomButton = byId('copy-room-button');
    this.lobbyConnectionLight = byId('lobby-connection-light');
    this.lobbyConnection = byId('lobby-connection');
    this.lobbyLatency = byId('lobby-latency');
    this.titleNetworkState = byId('title-network-state');
    this.networkMeter = byId('network-meter');
    this.networkPing = byId('network-ping');
    this.opponentName = byId('opponent-name');
    this.resultOpponentName = byId('result-opponent-name');
    this.connectionOverlay = byId('connection-overlay');
    this.connectionDetail = byId('connection-detail');
    this.scoreboard = byId('scoreboard');
    this.scoreboardBody = byId('scoreboard-body');
    this.respawnCountdown = byId('respawn-countdown');
    this.respawnCountdownValue = byId('respawn-countdown-value');
    this.playerRounds = byId('player-rounds');
    this.botRounds = byId('bot-rounds');
    this.playerTakes = byId('player-takes');
    this.botTakes = byId('bot-takes');
    this.roundLabel = byId('round-label');
    this.timer = byId('take-timer');
    this.arenaScore = byId('arena-score');
    this.warScore = byId('war-score');
    this.warRedScore = byId('war-red-score');
    this.warBlueScore = byId('war-blue-score');
    this.warCapture = byId('war-capture');
    this.warCaptureFill = byId('war-capture-fill');
    this.healthValue = byId('health-value');
    this.healthFill = byId('health-fill');
    this.healthPanel = document.querySelector('.health-panel');
    this.ammoValue = byId('ammo-value');
    this.ammoReserve = byId('ammo-reserve');
    this.crosshair = byId('crosshair');
    this.hitMarker = byId('hit-marker');
    this.damageDirection = byId('damage-direction');
    this.announcementKicker = byId('announcement-kicker');
    this.announcementTitle = byId('announcement-title');
    this.announcementDetail = byId('announcement-detail');
    this.resultTitle = byId('result-title');
    this.resultPlayerScore = byId('result-player-score');
    this.resultBotScore = byId('result-bot-score');
    this.resultDetail = byId('result-detail');
    this.postFlash = byId('post-flash');
    this.errorDetail = byId('error-detail');
    this.onlineMatch = false;
    this.warMatch = false;
    this.warTeam = 0;
    this.warMode = 'control';
    this.currentOpponent = 'Computer';
    this.hitUntil = 0;
    this.damageUntil = 0;
    this.crosshairUntil = 0;
    this.scoreboardVisible = false;
    this.scoreboardSignature = '';
    this.setTakes(this.playerTakes, 0);
    this.setTakes(this.botTakes, 0);
  }

  setSelectedMode(mode) {
    const selected = mode === 'war-tdm'
      ? 'war-tdm'
      : mode === 'war'
        ? 'war'
        : mode === 'arena-2v2'
          ? 'arena-2v2'
          : 'arena';
    const war = selected === 'war' || selected === 'war-tdm';
    this.gameMode.value = selected;
    this.warClassField.classList.toggle('hidden', !war);
    this.arenaActions.classList.toggle('hidden', selected !== 'arena');
    this.onlineButton.textContent = selected === 'war-tdm'
      ? 'Join Team Deathmatch'
      : selected === 'war'
        ? 'Join Control'
        : selected === 'arena-2v2'
          ? 'Join Arena 2v2'
          : 'Quick Match';
  }

  showTitle() {
    this.titleScreen.classList.add('active');
    this.networkLobby.classList.remove('active');
    this.connectionOverlay.classList.add('hidden');
    this.pauseScreen.classList.remove('active');
    this.resultScreen.classList.remove('active');
    this.hud.classList.add('hidden');
    this.announcement.classList.add('hidden');
    this.hideScoreboard();
    this.updateRespawnCountdown(null);
  }

  showPrivateLobby(prefill = '') {
    this.titleScreen.classList.remove('active');
    this.networkLobby.classList.add('active');
    this.privateRoomControls.classList.remove('hidden');
    this.queueState.classList.add('hidden');
    this.copyRoomButton.classList.add('hidden');
    this.lobbyKicker.textContent = 'Private Match';
    this.lobbyTitle.textContent = 'Private Match';
    this.lobbyDetail.textContent =
      'Create a match or enter a five-character match code.';
    this.roomCodeInput.value = String(prefill).toUpperCase().slice(0, 5);
    if (prefill) window.setTimeout(() => this.roomCodeInput.focus(), 0);
  }

  showQueue({ title, detail, code = '', copyable = false }) {
    this.titleScreen.classList.remove('active');
    this.networkLobby.classList.add('active');
    this.privateRoomControls.classList.add('hidden');
    this.queueState.classList.remove('hidden');
    this.lobbyKicker.textContent = 'Match';
    this.lobbyTitle.textContent = title;
    this.lobbyDetail.textContent = detail;
    this.queueCode.textContent = code;
    this.copyRoomButton.classList.toggle('hidden', !copyable);
  }

  showLobbyError(message) {
    this.lobbyKicker.textContent = 'Match';
    this.lobbyDetail.textContent = message;
  }

  setConnection(status, rtt = 0, online = null) {
    const label =
      status === 'online'
        ? online == null
          ? 'Online'
          : `${online} online`
        : status === 'reconnecting'
          ? 'Reconnecting'
          : status === 'connecting'
            ? 'Connecting'
            : 'Offline';
    this.titleNetworkState.textContent = label;
    this.lobbyConnection.textContent = label;
    this.lobbyConnectionLight.classList.toggle(
      'offline',
      status === 'offline' || status === 'reconnecting',
    );
    const latency = rtt > 0 ? `${Math.round(rtt)} ms` : '-- ms';
    this.lobbyLatency.textContent = latency;
    this.networkPing.textContent = latency;
    this.networkMeter.classList.toggle('degraded', rtt >= 90 && rtt < 180);
    this.networkMeter.classList.toggle(
      'lost',
      status === 'offline' || status === 'reconnecting' || rtt >= 180,
    );
  }

  setOnlineMatch(active, opponent = 'Computer', forfeit = true) {
    this.onlineMatch = active;
    this.currentOpponent = opponent || 'Opponent';
    this.opponentName.textContent = this.currentOpponent;
    this.resultOpponentName.textContent = this.currentOpponent;
    this.networkMeter.classList.toggle('hidden', !active);
    this.restartButton.classList.toggle('hidden', active);
    this.quitButton.textContent = active && forfeit
      ? 'Forfeit and Quit'
      : 'Quit to Menu';
  }

  setWarMatch(active, team = 0, warMode = this.warMode) {
    this.warMatch = Boolean(active);
    this.warTeam = Number(team) === 1 ? 1 : 0;
    this.warMode = normalizeWarMode(warMode);
    this.arenaScore.classList.toggle('hidden', this.warMatch);
    this.warScore.classList.toggle('hidden', !this.warMatch);
    if (!this.warMatch || this.warMode === WAR_MODE_TEAM_DEATHMATCH) {
      this.warCapture.classList.add('hidden');
    }
    if (!this.warMatch) {
      this.warRespawnClassField?.classList.add('hidden');
      this.updateRespawnCountdown(null);
    }
  }

  showConnectionOverlay(message) {
    this.connectionDetail.textContent = message;
    this.connectionOverlay.classList.remove('hidden');
  }

  hideConnectionOverlay() {
    this.connectionOverlay.classList.add('hidden');
  }

  showHUD() {
    this.titleScreen.classList.remove('active');
    this.networkLobby.classList.remove('active');
    this.pauseScreen.classList.remove('active');
    this.resultScreen.classList.remove('active');
    this.hud.classList.remove('hidden');
    this.hideScoreboard();
  }

  showPause() {
    this.pauseScreen.classList.add('active');
    this.hud.classList.add('hidden');
    this.hideScoreboard();
  }

  hidePause() {
    this.pauseScreen.classList.remove('active');
    this.hud.classList.remove('hidden');
  }

  showResult(won, playerScore, botScore, opponent = this.currentOpponent) {
    this.networkLobby.classList.remove('active');
    this.hud.classList.add('hidden');
    this.announcement.classList.add('hidden');
    this.pauseScreen.classList.remove('active');
    this.hideScoreboard();
    this.updateRespawnCountdown(null);
    this.resultTitle.textContent = won ? 'Win' : 'Loss';
    this.resultPlayerScore.textContent = playerScore;
    this.resultBotScore.textContent = botScore;
    this.resultOpponentName.textContent = opponent;
    this.resultDetail.textContent = '';
    this.rematchButton.textContent = this.warMatch
      ? 'Play Again'
      : this.onlineMatch
        ? 'Request Rematch'
        : 'Play Again';
    this.resultScreen.classList.add('active');
  }

  showRematchWaiting() {
    this.rematchButton.textContent = 'Waiting for Opponent';
    this.rematchButton.disabled = true;
  }

  resetRematchButton() {
    this.rematchButton.disabled = false;
    this.rematchButton.textContent = this.warMatch
      ? 'Play Again'
      : this.onlineMatch
        ? 'Request Rematch'
        : 'Play Again';
  }

  showError(message) {
    this.errorDetail.textContent = message;
    this.errorScreen.classList.add('active');
  }

  setTakes(container, count) {
    if (Number(container.dataset.count) === count) return;
    container.dataset.count = String(count);
    container.textContent = `${count}/2`;
  }

  updateHUD(state, player, bot, map, movement) {
    this.updateRespawnCountdown?.(null);
    if (this.playerRounds.textContent !== String(state.playerRounds)) {
      this.playerRounds.textContent = state.playerRounds;
    }
    if (this.botRounds.textContent !== String(state.botRounds)) {
      this.botRounds.textContent = state.botRounds;
    }
    this.setTakes(this.playerTakes, state.playerTakes);
    this.setTakes(this.botTakes, state.botTakes);
    const roundLabel = `Round ${state.roundNumber}`;
    if (this.roundLabel.textContent !== roundLabel) this.roundLabel.textContent = roundLabel;
    const timer = state.overtime ? 'Overtime' : formatTime(state.takeTime);
    if (this.timer.textContent !== timer) this.timer.textContent = timer;
    const health = String(Math.ceil(player.health));
    if (this.healthValue.textContent !== health) this.healthValue.textContent = health;
    const healthWidth = `${Math.round(clamp(player.health, 0, 100) * 10) / 10}%`;
    if (this.healthFill.style.width !== healthWidth) this.healthFill.style.width = healthWidth;
    const usesAmmo = player.definition.usesAmmo !== false;
    this.healthPanel.classList.toggle('ammo-free', !usesAmmo);
    const ammo = usesAmmo ? String(player.ammo).padStart(2, '0') : '';
    if (this.ammoValue.textContent !== ammo) this.ammoValue.textContent = ammo;
    const reserve = usesAmmo
      ? ` / ${String(player.reserve ?? 0).padStart(2, '0')}`
      : '';
    if (this.ammoReserve.textContent !== reserve) this.ammoReserve.textContent = reserve;
    this.crosshair.classList.toggle('empty', usesAmmo && player.ammo <= 0);
    this.crosshair.classList.toggle('focused', player.focused);
  }

  updateWarHUD(control, player, team = this.warTeam, warState = null) {
    const warMode = normalizeWarMode(warState?.warMode ?? this.warMode);
    const teamDeathmatch = warMode === WAR_MODE_TEAM_DEATHMATCH;
    const scores = teamDeathmatch
      ? (Array.isArray(warState?.teamScores) ? warState.teamScores : [0, 0])
      : (Array.isArray(control?.scores) ? control.scores : [0, 0]);
    const suffix = teamDeathmatch ? '' : '%';
    this.warRedScore.textContent = `${Math.floor(Number(scores[0]) || 0)}${suffix}`;
    this.warBlueScore.textContent = `${Math.floor(Number(scores[1]) || 0)}${suffix}`;

    let label = teamDeathmatch ? 'Team Deathmatch' : 'Point neutral';
    if (!teamDeathmatch && control?.phase === 'locked') label = 'Point locked';
    else if (!teamDeathmatch && control?.overtime) label = 'Overtime';
    else if (!teamDeathmatch && control?.contested) label = 'Point contested';
    else if (!teamDeathmatch && control?.captureTeam === 0) label = 'Red capturing';
    else if (!teamDeathmatch && control?.captureTeam === 1) label = 'Blue capturing';
    else if (!teamDeathmatch && control?.owner === 0) label = 'Red controls point';
    else if (!teamDeathmatch && control?.owner === 1) label = 'Blue controls point';
    this.roundLabel.textContent = label;

    const respawnRemaining = Number(player?.respawnRemaining) || 0;
    this.timer.textContent = control?.phase === 'locked'
      ? formatTime((Number(control.unlockRemaining) || 0) / 1000)
      : control?.overtime
        ? 'OT'
        : '';
    this.updateRespawnCountdown?.({
      dead: Boolean(player?.dead),
      respawnRemaining,
    });

    const captureVisible = !teamDeathmatch && (
      control?.captureTeam === 0 || control?.captureTeam === 1
    );
    this.warCapture.classList.toggle('hidden', !captureVisible);
    this.warCapture.setAttribute(
      'aria-label',
      captureVisible
        ? `${control.captureTeam === 0 ? 'Red' : 'Blue'} capture progress`
        : 'Capture progress',
    );
    this.warCaptureFill.style.width = `${clamp(Number(control?.captureProgress) || 0, 0, 100)}%`;

    const maxHealth = Math.max(1, Number(player?.maxHealth) || 100);
    const health = clamp(Number(player?.health) || 0, 0, maxHealth);
    this.healthValue.textContent = String(Math.ceil(health));
    this.healthFill.style.width = `${Math.round(health / maxHealth * 1_000) / 10}%`;
    const usesAmmo = player?.usesAmmo !== false;
    this.healthPanel.classList.toggle('ammo-free', !usesAmmo);
    this.ammoValue.textContent = usesAmmo
      ? String(Math.max(0, Number(player?.ammo) || 0)).padStart(2, '0')
      : '';
    this.ammoReserve.textContent = usesAmmo
      ? ` / ${String(Math.max(0, Number(player?.reserve) || 0)).padStart(2, '0')}`
      : '';
    this.crosshair.classList.toggle('focused', Boolean(player?.focused));
    this.crosshair.classList.toggle(
      'empty',
      usesAmmo && (Number(player?.ammo) || 0) <= 0,
    );
    this.setWarMatch(true, team, warMode);
    this.warRespawnClassField?.classList.toggle(
      'hidden',
      !shouldShowWarRespawnClass(this.warMatch, player),
    );
  }

  showAnnouncement(kicker, title, detail = '') {
    this.announcementKicker.textContent = kicker;
    this.announcementTitle.textContent = title;
    this.announcementDetail.textContent = detail;
    this.announcement.classList.remove('hidden');
  }

  hideAnnouncement() {
    this.announcement.classList.add('hidden');
  }

  setScoreboardRows(rows = []) {
    const normalized = rows.map((row) => ({
      id: row.id,
      name: String(row.name || 'Player').slice(0, 18),
      kills: Math.max(0, Math.floor(Number(row.kills) || 0)),
      deaths: Math.max(0, Math.floor(Number(row.deaths) || 0)),
      assists: Math.max(0, Math.floor(Number(row.assists) || 0)),
      local: Boolean(row.local),
    }));
    const signature = JSON.stringify(normalized);
    if (signature === this.scoreboardSignature) return;
    this.scoreboardSignature = signature;
    const fragment = document.createDocumentFragment();
    for (const row of normalized) {
      const tableRow = document.createElement('tr');
      if (row.local) tableRow.setAttribute('aria-current', 'true');
      for (const value of [row.name, row.kills, row.deaths, row.assists]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        tableRow.append(cell);
      }
      fragment.append(tableRow);
    }
    this.scoreboardBody.replaceChildren(fragment);
  }

  showScoreboard(rows) {
    this.setScoreboardRows(rows);
    this.scoreboardVisible = true;
    this.scoreboard.classList.remove('hidden');
  }

  hideScoreboard() {
    this.scoreboardVisible = false;
    this.scoreboard?.classList.add('hidden');
  }

  updateRespawnCountdown(player) {
    const text = respawnCountdownText(player);
    if (this.respawnCountdownValue) this.respawnCountdownValue.textContent = text;
    this.respawnCountdown?.classList.toggle('hidden', !text);
    return text;
  }

  showHit(headshot, time) {
    this.hitMarker.classList.toggle('headshot', headshot);
    this.hitMarker.classList.add('active');
    this.hitUntil = time + (headshot ? 0.14 : 0.1);
  }

  showDamage(directionAngle, time) {
    this.damageDirection.style.transform = `translate(-50%, -50%) rotate(${directionAngle}rad)`;
    this.damageDirection.classList.add('active');
    this.damageUntil = time + 0.28;
  }

  showShot(time) {
    this.crosshair.classList.add('firing');
    this.crosshairUntil = time + 0.07;
  }

  flash() {
    this.postFlash.classList.add('active');
    window.setTimeout(() => this.postFlash.classList.remove('active'), 55);
  }

  setMuted(muted) {
    this.audioToggle.textContent = muted ? 'Sound: Off' : 'Sound: On';
    this.audioToggle.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
  }

  update(time) {
    if (time >= this.hitUntil) this.hitMarker.classList.remove('active');
    if (time >= this.damageUntil) this.damageDirection.classList.remove('active');
    if (time >= this.crosshairUntil) this.crosshair.classList.remove('firing');
  }
}
