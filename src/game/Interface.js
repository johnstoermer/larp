import { clamp, formatTime } from './math.js';

const byId = (id) => document.getElementById(id);

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
    this.queueMessage = byId('queue-message');
    this.copyRoomButton = byId('copy-room-button');
    this.lobbyConnectionLight = byId('lobby-connection-light');
    this.lobbyConnection = byId('lobby-connection');
    this.lobbyLatency = byId('lobby-latency');
    this.titleNetworkState = byId('title-network-state');
    this.networkMeter = byId('network-meter');
    this.networkMode = byId('network-mode');
    this.networkPing = byId('network-ping');
    this.opponentName = byId('opponent-name');
    this.resultOpponentName = byId('result-opponent-name');
    this.connectionOverlay = byId('connection-overlay');
    this.connectionDetail = byId('connection-detail');
    this.playerRounds = byId('player-rounds');
    this.botRounds = byId('bot-rounds');
    this.playerTakes = byId('player-takes');
    this.botTakes = byId('bot-takes');
    this.roundLabel = byId('round-label');
    this.arenaLabel = byId('arena-label');
    this.timer = byId('take-timer');
    this.healthValue = byId('health-value');
    this.healthFill = byId('health-fill');
    this.healthPanel = document.querySelector('.health-panel');
    this.weaponName = byId('weapon-name');
    this.ammoValue = byId('ammo-value');
    this.ammoReserve = byId('ammo-reserve');
    this.fireMode = byId('fire-mode');
    this.movementState = byId('movement-state');
    this.pickupToast = byId('pickup-toast');
    this.pickupName = this.pickupToast.querySelector('strong');
    this.crosshair = byId('crosshair');
    this.hitMarker = byId('hit-marker');
    this.damageDirection = byId('damage-direction');
    this.announcementKicker = byId('announcement-kicker');
    this.announcementTitle = byId('announcement-title');
    this.announcementDetail = byId('announcement-detail');
    this.resultKicker = byId('result-kicker');
    this.resultTitle = byId('result-title');
    this.resultPlayerScore = byId('result-player-score');
    this.resultBotScore = byId('result-bot-score');
    this.resultDetail = byId('result-detail');
    this.postFlash = byId('post-flash');
    this.errorDetail = byId('error-detail');
    this.onlineMatch = false;
    this.currentOpponent = 'GRILLMASTER';
    this.pickupUntil = 0;
    this.hitUntil = 0;
    this.damageUntil = 0;
    this.crosshairUntil = 0;
    this.setTakes(this.playerTakes, 0);
    this.setTakes(this.botTakes, 0);
  }

  showTitle() {
    this.titleScreen.classList.add('active');
    this.networkLobby.classList.remove('active');
    this.connectionOverlay.classList.add('hidden');
    this.pauseScreen.classList.remove('active');
    this.resultScreen.classList.remove('active');
    this.hud.classList.add('hidden');
    this.announcement.classList.add('hidden');
  }

  showPrivateLobby(prefill = '') {
    this.titleScreen.classList.remove('active');
    this.networkLobby.classList.add('active');
    this.privateRoomControls.classList.remove('hidden');
    this.queueState.classList.add('hidden');
    this.copyRoomButton.classList.add('hidden');
    this.lobbyKicker.textContent = 'LOCKED BACKYARD';
    this.lobbyTitle.innerHTML = 'PRIVATE<br>PATIO';
    this.lobbyDetail.textContent =
      'Open a locked yard or enter a five-character gate code.';
    this.roomCodeInput.value = String(prefill).toUpperCase().slice(0, 5);
    if (prefill) window.setTimeout(() => this.roomCodeInput.focus(), 0);
  }

  showQueue({ title, detail, code = '', copyable = false }) {
    this.titleScreen.classList.remove('active');
    this.networkLobby.classList.add('active');
    this.privateRoomControls.classList.add('hidden');
    this.queueState.classList.remove('hidden');
    this.lobbyKicker.textContent = 'LIVE MATCH SERVICE';
    this.lobbyTitle.innerHTML = title;
    this.lobbyDetail.textContent = detail;
    this.queueCode.textContent = code;
    this.queueMessage.textContent = code
      ? 'Gate code secured. Waiting for the second player.'
      : 'Searching the block for a low-latency opponent.';
    this.copyRoomButton.classList.toggle('hidden', !copyable);
  }

  showLobbyError(message) {
    this.lobbyKicker.textContent = 'MATCH SERVICE RESPONSE';
    this.lobbyDetail.textContent = message;
    this.queueMessage.textContent = message;
  }

  setConnection(status, rtt = 0, online = null) {
    const label =
      status === 'online'
        ? online == null
          ? 'NETWORK READY'
          : `${online} ONLINE`
        : status === 'reconnecting'
          ? 'RECONNECTING'
          : status === 'connecting'
            ? 'CONNECTING'
            : 'NETWORK STANDBY';
    this.titleNetworkState.textContent = label;
    this.lobbyConnection.textContent = label;
    this.lobbyConnectionLight.classList.toggle(
      'offline',
      status === 'offline' || status === 'reconnecting',
    );
    const latency = rtt > 0 ? `${Math.round(rtt)} MS` : '-- MS';
    this.lobbyLatency.textContent = latency;
    this.networkPing.textContent = latency;
    this.networkMeter.classList.toggle('degraded', rtt >= 90 && rtt < 180);
    this.networkMeter.classList.toggle(
      'lost',
      status === 'offline' || status === 'reconnecting' || rtt >= 180,
    );
  }

  setOnlineMatch(active, opponent = 'GRILLMASTER') {
    this.onlineMatch = active;
    this.currentOpponent = opponent || 'NEIGHBOR';
    this.opponentName.textContent = this.currentOpponent;
    this.resultOpponentName.textContent = this.currentOpponent;
    this.networkMeter.classList.toggle('hidden', !active);
    this.restartButton.classList.toggle('hidden', active);
    this.quitButton.textContent = active ? 'FORFEIT AND QUIT' : 'QUIT TO TITLE';
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
  }

  showPause() {
    this.pauseScreen.classList.add('active');
    this.hud.classList.add('hidden');
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
    this.resultKicker.textContent = won ? 'COOKOUT COMPLETE' : 'PLATE DROPPED';
    this.resultTitle.innerHTML = won ? 'YARD<br>SECURED' : 'YARD<br>LOST';
    this.resultPlayerScore.textContent = playerScore;
    this.resultBotScore.textContent = botScore;
    this.resultOpponentName.textContent = opponent;
    this.resultDetail.textContent = won
      ? 'You owned the lanes, controlled the gear, and ruled the block.'
      : `${opponent} claimed the yard. Move sooner, control the coolers, run it back.`;
    this.rematchButton.querySelector('span').textContent = this.onlineMatch
      ? 'REQUEST REMATCH'
      : 'RUN IT AGAIN';
    this.resultScreen.classList.add('active');
  }

  showRematchWaiting() {
    this.rematchButton.querySelector('span').textContent = 'REMATCH REQUESTED';
    this.rematchButton.querySelector('small').textContent = 'WAITING FOR NEIGHBOR';
    this.rematchButton.disabled = true;
  }

  resetRematchButton() {
    this.rematchButton.disabled = false;
    this.rematchButton.querySelector('small').textContent = 'PRESS ENTER';
  }

  showError(message) {
    this.errorDetail.textContent = message;
    this.errorScreen.classList.add('active');
  }

  setTakes(container, count) {
    if (Number(container.dataset.count) === count) return;
    container.dataset.count = String(count);
    container.replaceChildren();
    for (let index = 0; index < 2; index += 1) {
      const mark = document.createElement('i');
      if (index < count) mark.classList.add('won');
      container.appendChild(mark);
    }
  }

  updateHUD(state, player, bot, map, movement) {
    if (this.playerRounds.textContent !== String(state.playerRounds)) {
      this.playerRounds.textContent = state.playerRounds;
    }
    if (this.botRounds.textContent !== String(state.botRounds)) {
      this.botRounds.textContent = state.botRounds;
    }
    this.setTakes(this.playerTakes, state.playerTakes);
    this.setTakes(this.botTakes, state.botTakes);
    const roundLabel = `ROUND ${String(state.roundNumber).padStart(2, '0')}`;
    if (this.roundLabel.textContent !== roundLabel) this.roundLabel.textContent = roundLabel;
    if (this.arenaLabel.textContent !== map.name) this.arenaLabel.textContent = map.name;
    const timer = state.overtime ? 'OVERTIME' : formatTime(state.takeTime);
    if (this.timer.textContent !== timer) this.timer.textContent = timer;
    const health = String(Math.ceil(player.health));
    if (this.healthValue.textContent !== health) this.healthValue.textContent = health;
    const healthWidth = `${Math.round(clamp(player.health, 0, 100) * 10) / 10}%`;
    if (this.healthFill.style.width !== healthWidth) this.healthFill.style.width = healthWidth;
    this.healthPanel.classList.toggle('danger', player.health <= 30);
    if (this.weaponName.textContent !== player.definition.name) {
      this.weaponName.textContent = player.definition.name;
    }
    const ammo = String(player.ammo).padStart(2, '0');
    if (this.ammoValue.textContent !== ammo) this.ammoValue.textContent = ammo;
    const reserve = ` / ${String(player.reserve ?? 0).padStart(2, '0')}`;
    if (this.ammoReserve.textContent !== reserve) this.ammoReserve.textContent = reserve;
    if (this.fireMode.textContent !== player.definition.fireMode) {
      this.fireMode.textContent = player.definition.fireMode;
    }
    this.crosshair.classList.toggle('empty', player.ammo <= 0);
    this.crosshair.classList.toggle('focused', player.focused);

    let movementLabel = 'READY';
    let hot = false;
    if (movement.wallRunning) {
      movementLabel = 'WALL RUN';
      hot = true;
    } else if (movement.sliding) {
      movementLabel = 'SLIDE';
      hot = true;
    } else if (movement.sprinting) {
      movementLabel = 'SPRINT';
    } else if (!player.grounded && player.velocity.y > 0.5) {
      movementLabel = 'AIRBORNE';
    } else if (player.reloading) {
      movementLabel = 'RELOADING';
      hot = true;
    } else if (player.ammo <= 0) {
      movementLabel = player.reserve > 0 ? 'R TO RELOAD' : 'FIND A WEAPON';
      hot = true;
    }
    if (this.movementState.textContent !== movementLabel) {
      this.movementState.textContent = movementLabel;
    }
    this.movementState.classList.toggle('hot', hot);
  }

  showAnnouncement(kicker, title, detail = '') {
    this.announcementKicker.textContent = kicker;
    this.announcementTitle.textContent = title;
    this.announcementDetail.textContent = detail;
    this.announcement.classList.remove('hidden');
    const oldRule = byId('announcement-rule');
    const newRule = oldRule.cloneNode(true);
    oldRule.replaceWith(newRule);
  }

  hideAnnouncement() {
    this.announcement.classList.add('hidden');
  }

  showPickup(name, time) {
    this.pickupName.textContent = name;
    this.pickupToast.classList.add('active');
    this.pickupUntil = time + 1.35;
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
    this.audioToggle.classList.toggle('muted', muted);
    this.audioToggle.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
  }

  update(time) {
    if (time >= this.pickupUntil) this.pickupToast.classList.remove('active');
    if (time >= this.hitUntil) this.hitMarker.classList.remove('active');
    if (time >= this.damageUntil) this.damageDirection.classList.remove('active');
    if (time >= this.crosshairUntil) this.crosshair.classList.remove('firing');
  }
}
