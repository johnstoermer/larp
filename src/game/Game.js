import * as THREE from 'three';
import { CHARACTER_HITBOX } from '../../shared/characterHitbox.js';
import { WAR_CLASSES, normalizeWarClass } from '../../shared/warConfig.js';
import { GameRenderer } from './Renderer.js';
import { Arena } from './Arena.js';
import { AudioSystem } from './AudioSystem.js';
import { BotController } from './BotController.js';
import { Interface } from './Interface.js';
import { NetworkClient } from './NetworkClient.js';
import { PickupManager } from './PickupManager.js';
import { PlayerController } from './PlayerController.js';
import { RemotePlayer } from './RemotePlayer.js';
import { TitleAttractBattle } from './TitleAttractBattle.js';
import { VFX } from './VFX.js';
import { WarArena } from './WarArena.js';
import { WarCrowd } from './WarCrowd.js';
import { clamp, seededRandom, shuffle } from './math.js';
import { loadPhotoTexture } from './photoTexture.js';
import { getArenaLoadout, WEAPONS } from './weapons.js';

const TEMP_ORIGIN = new THREE.Vector3();
const TEMP_DIRECTION = new THREE.Vector3();
const TEMP_POINT = new THREE.Vector3();
const TEMP_POINT_B = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const TEMP_UP = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TEMP_RAY = new THREE.Ray();
const TEMP_SPHERE = new THREE.Sphere();
const fireballTexture = loadPhotoTexture('/assets/larp/effects/fireball.webp');

function spreadDirection(direction, spread) {
  if (spread <= 0) return direction.clone();
  TEMP_RIGHT.crossVectors(direction, WORLD_UP);
  if (TEMP_RIGHT.lengthSq() < 0.001) TEMP_RIGHT.set(1, 0, 0);
  else TEMP_RIGHT.normalize();
  TEMP_UP.crossVectors(TEMP_RIGHT, direction).normalize();
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * spread;
  return direction
    .clone()
    .addScaledVector(TEMP_RIGHT, Math.cos(angle) * radius)
    .addScaledVector(TEMP_UP, Math.sin(angle) * radius)
    .normalize();
}

function magicColor(definition) {
  return definition.id === 'lightning' ? 0x8feaff : 0xff8b35;
}

function magicPower(definition, base = 1) {
  return base * (definition.id === 'ember' || definition.id === 'lightning' ? 1.35 : 1);
}

function showWeaponTrail(vfx, muzzle, end, definition, pellet = 0) {
  if (['knives', 'shortbow', 'longbow', 'crossbow'].includes(definition.id)) {
    if (pellet === 0) vfx.spawnFlyingProp(muzzle, end, definition.id);
    return;
  }
  if (definition.id === 'greatsword') return;
  if (definition.id === 'lightning') {
    vfx.spawnTracer(muzzle, end, 0x8cefff, 0.04, 0.14);
    return;
  }
  if (definition.id === 'ember' && pellet < 4) {
    vfx.spawnTracer(muzzle, end, 0xff9d5c, pellet === 0 ? 0.014 : 0.006, pellet === 0 ? 0.07 : 0.035);
  }
}

function raySphereDistance(origin, direction, center, radius) {
  TEMP_RAY.set(origin, direction);
  TEMP_SPHERE.set(center, radius);
  const point = TEMP_RAY.intersectSphere(TEMP_SPHERE, TEMP_POINT_B);
  return point ? point.distanceTo(origin) : null;
}

export function warResumeCounters(snapshot, slot) {
  const local = snapshot?.combatants?.find(
    (combatant) => combatant.id === Number(slot),
  );
  return {
    state: Math.max(0, Number(local?.ack) || 0),
    shot: Math.max(0, Number(local?.shotAck) || 0),
  };
}

export class Game {
  constructor(canvas) {
    this.ui = new Interface();
    this.weapons = WEAPONS;
    this.rendering = new GameRenderer(canvas);
    this.scene = this.rendering.scene;
    this.camera = this.rendering.camera;
    this.audio = new AudioSystem();
    this.arena = new Arena(this.scene, this.rendering.renderer);
    this.baseArena = this.arena;
    this.warArena = null;
    this.warCrowd = null;
    this.vfx = new VFX(this.scene, this.camera);
    this.player = new PlayerController(this.camera, this.arena, this.audio);
    this.bot = new BotController(this.scene, this.arena, this.audio);
    this.titleAttract = new TitleAttractBattle(this.scene, this.arena, this.vfx);
    this.remote = new RemotePlayer(this.bot);
    this.network = new NetworkClient();
    this.pickups = new PickupManager(this.scene, this.camera);
    this.canvas = canvas;
    this.mode = 'title';
    this.phase = 'title';
    this.phaseTimer = 0;
    this.playerRounds = 0;
    this.botRounds = 0;
    this.playerTakes = 0;
    this.botTakes = 0;
    this.roundNumber = 1;
    this.takeNumber = 1;
    this.takeTime = 45;
    this.overtime = false;
    this.overtimeTick = 0;
    this.lastCountdown = 4;
    this.pendingRoundWinner = null;
    this.projectiles = [];
    this.matchSeed = Date.now() & 0xfffffff;
    this.mapOrder = [0];
    this.titleTime = 0;
    this.running = true;
    this.lastFrame = performance.now();
    this.elapsed = 0;
    this.lastMovement = {
      sliding: false,
      wallRunning: false,
      sprinting: false,
      speed: 0,
    };
    this.titleMapTimer = 0;
    this.matchType = 'practice';
    this.onlinePaused = false;
    this.onlineSlot = 0;
    this.onlineOpponent = 'Opponent';
    this.onlineRoomId = null;
    this.onlinePrivateMatch = false;
    this.onlineSnapshot = null;
    this.onlineRoundLoaded = 0;
    this.onlineMapLoaded = -1;
    this.onlineSequence = 0;
    this.onlineShotSequence = 0;
    this.onlineSendAccumulator = 0;
    this.onlineStateHistory = new Map();
    this.pendingPickupClaims = new Map();
    this.onlineProjectiles = new Map();
    this.lastOnlinePhase = null;
    this.lastOnlineCountdown = 4;
    this.hudAccumulator = 0;
    this.performanceAccumulator = 0;
    this.warTeam = 0;
    this.warSlot = null;
    this.warClassId = 'shortbow';
    this.warSnapshot = null;
    this.warLastAttackAt = -Infinity;
    this.warSendAccumulator = 0;
    this.setupEvents();
    this.setupNetworkEvents();
    this.setupTitleScene();
    this.ui.setMuted(this.audio.muted);
    this.ui.sensitivity.value = String(this.player.sensitivity);
    this.ui.callsign.value = this.network.name || 'PLAYER';
    this.ui.qualityProfile.value = this.rendering.qualityProfile;
    const selectedMode = localStorage.getItem('larp-mode') === 'war' ? 'war' : 'arena';
    this.selectWarNextClass(localStorage.getItem('larp-war-class'));
    this.ui.setSelectedMode(selectedMode);
    const invitedRoom = new URLSearchParams(location.search).get('room');
    if (invitedRoom) {
      this.titleAttract.stop();
      this.ui.showPrivateLobby(invitedRoom);
    }
    else if (this.network.resumeRequested) {
      window.setTimeout(() => this.resumeOnlineSession(), 0);
    }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupEvents() {
    this.ui.startButton.addEventListener('click', () => this.startMatch());
    this.ui.onlineButton.addEventListener('click', () => this.startQuickPlay());
    this.ui.gameMode.addEventListener('change', () => {
      const mode = this.ui.gameMode.value === 'war' ? 'war' : 'arena';
      localStorage.setItem('larp-mode', mode);
      this.ui.setSelectedMode(mode);
    });
    this.ui.warClass.addEventListener('change', (event) => {
      this.selectWarNextClass(event.target.value, true);
    });
    this.ui.warRespawnClass.addEventListener('change', (event) => {
      this.selectWarNextClass(event.target.value, true);
    });
    this.ui.privateButton.addEventListener('click', () => {
      this.titleAttract.stop();
      this.ui.showPrivateLobby();
    });
    this.ui.lobbyCloseButton.addEventListener('click', () => {
      this.network.cancelQueue();
      this.setupTitleScene();
    });
    this.ui.createRoomButton.addEventListener('click', () => this.createPrivateRoom());
    this.ui.joinRoomButton.addEventListener('click', () => this.joinPrivateRoom());
    this.ui.roomCodeInput.addEventListener('input', () => {
      this.ui.roomCodeInput.value = this.ui.roomCodeInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 5);
    });
    this.ui.roomCodeInput.addEventListener('keydown', (event) => {
      if (event.code === 'Enter') this.joinPrivateRoom();
    });
    this.ui.copyRoomButton.addEventListener('click', () => this.copyInviteLink());
    this.ui.callsign.addEventListener('change', () => {
      const name = this.ui.callsign.value.trim().slice(0, 18) || 'PLAYER';
      this.ui.callsign.value = name;
      this.network.name = name;
      localStorage.setItem('larp-name', name);
    });
    this.ui.resumeButton.addEventListener('click', () => this.resume());
    this.ui.restartButton.addEventListener('click', () => this.startMatch());
    this.ui.quitButton.addEventListener('click', () => this.returnToTitle());
    this.ui.rematchButton.addEventListener('click', () => {
      if (this.matchType === 'war') {
        this.startQuickPlay();
      } else if (this.matchType === 'online') {
        this.network.send({ type: 'rematch' });
        this.ui.showRematchWaiting();
      } else {
        this.startMatch();
      }
    });
    this.ui.resultQuitButton.addEventListener('click', () => this.returnToTitle());
    this.ui.audioToggle.addEventListener('click', async () => {
      await this.audio.init();
      this.ui.setMuted(this.audio.toggleMute());
    });
    this.ui.sensitivity.addEventListener('input', (event) => {
      this.player.setSensitivity(event.target.value);
    });
    this.ui.qualityProfile.addEventListener('change', (event) => {
      const ratio = this.rendering.setQualityProfile(event.target.value);
      this.vfx.resize(ratio);
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('click', () => {
      const playable = this.phase === 'playing' || (
        this.matchType === 'war' &&
        (this.phase === 'locked' || this.phase === 'control')
      );
      if (
        this.mode === 'match' &&
        playable &&
        !this.player.dead &&
        !document.pointerLockElement
      ) {
        this.ui.hideAnnouncement();
        this.requestPointerLock();
      }
    });
    window.addEventListener('resize', () => {
      const ratio = this.rendering.resize();
      this.vfx.resize(ratio);
    });
    window.addEventListener('keydown', (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.code === 'Enter') {
        if (this.mode === 'title') this.startQuickPlay();
        else if (this.mode === 'result') {
          if (this.matchType === 'war') {
            this.startQuickPlay();
          } else if (this.matchType === 'online') {
            this.network.send({ type: 'rematch' });
            this.ui.showRematchWaiting();
          } else {
            this.startMatch();
          }
        }
      }
      if (event.code === 'Escape' && this.mode === 'paused') {
        event.preventDefault();
        this.resume();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const playable = this.phase === 'playing' || (
        this.matchType === 'war' &&
        (this.phase === 'locked' || this.phase === 'control')
      );
      if (
        !document.pointerLockElement &&
        this.mode === 'match' &&
        playable &&
        !this.player.dead
      ) {
        this.pause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      const playable = this.phase === 'playing' || (
        this.matchType === 'war' &&
        (this.phase === 'locked' || this.phase === 'control')
      );
      if (
        document.hidden &&
        this.mode === 'match' &&
        playable &&
        !this.player.dead
      ) {
        this.pause();
      }
      this.lastFrame = performance.now();
    });
  }

  setupNetworkEvents() {
    this.network.addEventListener('status', (event) => {
      const { status, online } = event.detail;
      this.ui.setConnection(status, this.network.rtt, online);
      if (this.matchType !== 'online' && this.matchType !== 'war') return;
      if (status === 'reconnecting' || status === 'offline') {
        this.ui.showConnectionOverlay(
          this.matchType === 'war'
            ? 'Reconnecting to War.'
            : 'Reconnecting. The match will wait for twenty seconds.',
        );
      } else if (status === 'online') {
        this.ui.hideConnectionOverlay();
      }
    });
    this.network.addEventListener('latency', (event) => {
      this.remote.setLatency(event.detail.rtt);
      this.ui.setConnection(this.network.status, event.detail.rtt);
    });
    this.network.addEventListener('queue_status', (event) => {
      if (event.detail.status !== 'searching') return;
      this.ui.showQueue({
        title: 'Finding Match',
        detail: 'Searching for another player.',
      });
    });
    this.network.addEventListener('private_created', (event) => {
      this.ui.showQueue({
        title: 'Match Created',
        detail: 'Send the match code to the other player. Waiting for them to join.',
        code: event.detail.code,
        copyable: true,
      });
    });
    this.network.addEventListener('match_found', (event) => {
      this.startOnlineMatch(event.detail);
    });
    this.network.addEventListener('war_found', (event) => {
      this.startWarMatch(event.detail);
    });
    this.network.addEventListener('snapshot', (event) => {
      if (this.matchType === 'online') this.applyOnlineSnapshot(event.detail.state);
    });
    this.network.addEventListener('event', (event) => {
      if (this.matchType === 'online') this.handleOnlineEvent(event.detail);
    });
    this.network.addEventListener('war_snapshot', (event) => {
      if (this.matchType === 'war') this.applyWarSnapshot(event.detail.state);
    });
    this.network.addEventListener('war_event', (event) => {
      if (this.matchType === 'war') this.handleWarEvent(event.detail);
    });
    this.network.addEventListener('error', (event) => {
      const message = event.detail.message || 'The match server rejected the request.';
      this.ui.showLobbyError(message);
    });
    this.network.addEventListener('left_match', () => {
      if (
        (this.matchType === 'online' || this.matchType === 'war') &&
        this.mode !== 'title'
      ) {
        this.setupTitleScene();
      }
    });
    this.network.addEventListener('resume_unavailable', () => {
      if (!this.network.inMatch) this.setupTitleScene();
    });
  }

  selectWarNextClass(value, send = false) {
    const classId = normalizeWarClass(value);
    this.ui.warClass.value = classId;
    this.ui.warRespawnClass.value = classId;
    localStorage.setItem('larp-war-class', classId);
    if (send && this.matchType === 'war' && this.network.inMatch) {
      this.network.send({ type: 'war_select_class', classId });
    }
    return classId;
  }

  async connectOnline() {
    const name = this.ui.callsign.value.trim().slice(0, 18) || 'PLAYER';
    this.ui.callsign.value = name;
    try {
      await this.network.connect(name);
      return true;
    } catch {
      this.ui.showLobbyError('The match service could not be reached. Try again.');
      return false;
    }
  }

  async resumeOnlineSession() {
    this.titleAttract.stop();
    this.ui.showQueue({
      title: 'Restoring Match',
      detail: 'Rejoining the match.',
    });
    if (!(await this.connectOnline())) {
      localStorage.removeItem('larp-active-match');
      this.network.resumeRequested = false;
    }
  }

  async startQuickPlay() {
    if (
      this.mode === 'starting' ||
      (this.matchType === 'online' || this.matchType === 'war') && this.mode === 'match'
    ) {
      return;
    }
    const selectedMode = this.ui.gameMode.value === 'war' ? 'war' : 'arena';
    const classId = normalizeWarClass(this.ui.warClass.value);
    if (selectedMode === 'war' && this.network.inMatch) this.network.leave();
    this.titleAttract.stop();
    await this.audio.init();
    this.audio.click(true);
    this.ui.showQueue({
      title: 'Connecting',
      detail: 'Connecting to the match server.',
    });
    if (!(await this.connectOnline())) return;
    if (selectedMode === 'war') {
      this.warClassId = classId;
      this.network.warPlay(classId);
    } else {
      this.network.quickPlay();
    }
  }

  async createPrivateRoom() {
    this.ui.showQueue({
      title: 'Creating Match',
      detail: 'Connecting to the match server.',
    });
    if (await this.connectOnline()) this.network.createPrivate();
  }

  async joinPrivateRoom() {
    const code = this.ui.roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 5) {
      this.ui.showLobbyError('Enter the complete five-character match code.');
      return;
    }
    this.ui.showQueue({
      title: 'Joining Match',
      detail: `Joining match ${code}.`,
      code,
    });
    if (await this.connectOnline()) this.network.joinPrivate(code);
  }

  async copyInviteLink() {
    const code = this.ui.queueCode.textContent.trim();
    if (!code) return;
    const invite = `https://herm.cool/games/larp/?room=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(invite);
      this.ui.copyRoomButton.textContent = 'Invite Link Copied';
    } catch {
      this.ui.copyRoomButton.textContent = code;
    }
  }

  async requestPointerLock() {
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        // The player can click the canvas again if the browser rejects the first request.
      }
    }
  }

  activateArena(nextArena) {
    if (!nextArena) return;
    if (this.arena !== nextArena) {
      this.arena.root.visible = false;
      nextArena.root.visible = true;
      this.arena = nextArena;
      this.player.arena = nextArena;
      this.bot.arena = nextArena;
    }
    nextArena.activateEnvironment?.();
  }

  ensureWarWorld() {
    if (!this.warArena) {
      this.warArena = new WarArena(this.scene, this.rendering.renderer);
      this.warCrowd = new WarCrowd(this.scene);
      this.warArena.root.visible = false;
      this.warCrowd.root.visible = false;
    }
    this.activateArena(this.warArena);
    this.warCrowd.root.visible = true;
  }

  setupTitleScene() {
    this.titleAttract.stop();
    this.activateArena(this.baseArena);
    if (this.warCrowd) {
      this.warCrowd.clear();
      this.warCrowd.root.visible = false;
    }
    this.warSnapshot = null;
    this.warSlot = null;
    this.matchType = 'practice';
    this.onlinePaused = false;
    this.onlineRoomId = null;
    this.onlinePrivateMatch = false;
    this.onlineSnapshot = null;
    this.onlineStateHistory.clear();
    this.pendingPickupClaims.clear();
    this.onlineProjectiles.clear();
    this.remote.clear();
    this.mode = 'title';
    this.phase = 'title';
    this.phaseTimer = 0;
    this.clearProjectiles();
    this.vfx.clear();
    this.titleTime = 0;
    this.arena.load(2, 9124);
    const loadout = getArenaLoadout(9124, 6);
    this.pickups.reset(this.arena.weaponSlots, loadout);
    this.bot.root.visible = false;
    this.player.viewRoot.visible = false;
    this.player.inputEnabled = false;
    this.player.setMovementScale?.(1);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.ui.setOnlineMatch(false);
    this.ui.setWarMatch(false);
    this.ui.resetRematchButton();
    this.ui.showTitle();
    this.titleAttract.start();
  }

  async startMatch() {
    if (this.mode === 'starting') return;
    this.titleAttract.stop();
    this.activateArena(this.baseArena);
    this.player.setMovementScale?.(1);
    if (this.network.inMatch) this.network.leave();
    this.matchType = 'practice';
    this.ui.setOnlineMatch(false);
    this.ui.setWarMatch(false);
    this.mode = 'starting';
    await this.audio.init();
    this.audio.click(true);
    this.mode = 'match';
    this.phase = 'loading';
    this.playerRounds = 0;
    this.botRounds = 0;
    this.playerTakes = 0;
    this.botTakes = 0;
    this.roundNumber = 1;
    this.takeNumber = 1;
    this.matchSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
    const random = seededRandom(this.matchSeed);
    const mapIndices = Array.from({ length: this.arena.getMapCount() }, (_, mapIndex) => mapIndex);
    this.mapOrder = shuffle(mapIndices, random);
    while (this.mapOrder.length < 7) {
      this.mapOrder.push(...shuffle(mapIndices, random));
    }
    this.ui.showHUD();
    this.player.viewRoot.visible = true;
    this.startRound();
    this.requestPointerLock();
  }

  startOnlineMatch(message) {
    this.titleAttract.stop();
    this.activateArena(this.baseArena);
    this.player.setMovementScale?.(1);
    const snapshot = message.snapshot;
    if (!snapshot) return;
    this.matchType = 'online';
    this.mode = 'match';
    this.phase = snapshot.phase;
    this.onlinePaused = false;
    this.onlineSlot = Number(message.slot) === 1 ? 1 : 0;
    this.onlineOpponent = message.opponent || 'Opponent';
    this.onlinePrivateMatch = Boolean(message.privateMatch);
    this.onlineRoomId = message.roomId;
    this.matchSeed = message.seed;
    this.mapOrder = message.mapOrder;
    this.onlineSequence = 0;
    this.onlineShotSequence = 0;
    this.onlineSendAccumulator = 0;
    this.onlineStateHistory.clear();
    this.pendingPickupClaims.clear();
    this.lastOnlinePhase = null;
    this.lastOnlineCountdown = 4;
    this.ui.setOnlineMatch(true, this.onlineOpponent);
    this.ui.setWarMatch(false);
    this.ui.hideConnectionOverlay();
    this.ui.showHUD();
    this.player.viewRoot.visible = true;
    this.applyOnlineSnapshot(snapshot, true);
    this.audio.click(true);
  }

  startWarMatch(message) {
    this.titleAttract.stop();
    const snapshot = message.snapshot;
    if (!snapshot?.combatants?.length) return;
    this.ensureWarWorld();
    this.matchType = 'war';
    this.mode = 'match';
    this.phase = snapshot.phase;
    this.onlinePaused = false;
    this.warSlot = Number(message.slot);
    this.warTeam = Number(message.team) === 1 ? 1 : 0;
    this.warClassId = normalizeWarClass(message.classId);
    this.onlineRoomId = message.roomId;
    const resumeCounters = warResumeCounters(snapshot, this.warSlot);
    this.onlineSequence = resumeCounters.state;
    this.onlineShotSequence = resumeCounters.shot;
    this.onlineStateHistory.clear();
    this.warSendAccumulator = 0;
    this.warLastAttackAt = -Infinity;
    this.pickups.reset([], []);
    this.remote.clear();
    this.bot.root.visible = false;
    this.clearProjectiles();
    this.vfx.clear();
    this.ui.setSelectedMode('war');
    this.selectWarNextClass(this.warClassId);
    this.ui.setOnlineMatch(
      true,
      this.warTeam === 0 ? 'Red Team' : 'Blue Team',
    );
    this.ui.setWarMatch(true, this.warTeam);
    this.ui.hideConnectionOverlay();
    this.ui.showHUD();
    this.warCrowd.localId = this.warSlot;
    this.applyWarSnapshot(snapshot, true);
    this.audio.click(true);
    if (this.mode === 'match' && !this.player.dead) this.requestPointerLock();
  }

  equipWarClass(classId) {
    const normalized = normalizeWarClass(classId);
    const definition = WAR_CLASSES[normalized];
    this.warClassId = normalized;
    if (this.player.weaponType !== definition.weapon) {
      this.player.equip(definition.weapon, false);
    }
    this.player.maxHealth = definition.health;
    this.player.setMovementScale?.(definition.speed / 6.4);
  }

  applyWarSnapshot(state, initial = false) {
    if (!state?.combatants?.length || this.matchType !== 'war') return;
    const local = state.combatants.find((combatant) => combatant.id === this.warSlot);
    if (!local) return;
    const previous = this.warSnapshot?.combatants?.find(
      (combatant) => combatant.id === this.warSlot,
    );
    const respawned = Boolean(previous?.dead && !local.dead);
    const died = Boolean(previous && !previous.dead && local.dead);

    if (initial || respawned) {
      this.player.reset(new THREE.Vector3().fromArray(local.position), local.yaw);
      this.equipWarClass(local.classId);
      this.selectWarNextClass(local.classId);
      this.onlineStateHistory.clear();
      if (respawned && this.mode === 'match') this.requestPointerLock();
    } else {
      const predicted = this.onlineStateHistory.get(local.ack);
      if (predicted) {
        const correction = TEMP_POINT
          .fromArray(local.position)
          .sub(TEMP_POINT_B.fromArray(predicted));
        const error = correction.length();
        if (error > 0.05) {
          this.player.position.addScaledVector(correction, error > 2.2 ? 1 : 0.24);
        }
        for (const sequence of this.onlineStateHistory.keys()) {
          if (sequence <= local.ack) this.onlineStateHistory.delete(sequence);
        }
      }
      this.equipWarClass(local.classId);
    }

    const numericPreviousHealth = Number(this.player.health);
    const previousHealth = Number.isFinite(numericPreviousHealth)
      ? numericPreviousHealth
      : local.maxHealth;
    this.player.health = local.health;
    this.player.maxHealth = local.maxHealth;
    this.player.ammo = local.ammo;
    this.player.reserve = local.reserve;
    if (local.reloading && !this.player.reloading) {
      this.player.startReload(true);
    }
    if (local.reloading) {
      this.player.reloadRemaining = Math.max(
        0,
        Number(local.reloadRemaining || 0) / 1_000,
      );
      this.player.reloadDuration = WAR_CLASSES[local.classId].reloadMs / 1_000;
    } else if (this.player.reloading) {
      this.player.cancelReload();
    }
    this.player.dead = Boolean(local.dead);
    this.player.respawnRemaining = local.respawnRemaining;
    this.player.viewRoot.visible = !local.dead && state.phase !== 'result';
    if (died && document.pointerLockElement) document.exitPointerLock();
    if (!initial && local.health < previousHealth) {
      this.rendering.setDamage(0.2);
      this.player.addShake(0.12, 0.18);
    }

    this.phase = state.phase;
    this.warSnapshot = state;
    this.warCrowd.applySnapshot(state.combatants, performance.now());
    this.syncWarProjectiles(state.projectiles ?? []);
    this.warArena.setControlState(state.control);
    this.ui.updateWarHUD(state.control, local, this.warTeam);
    if (state.phase === 'result' && this.mode !== 'result') {
      this.showWarResult(state.winner, state.control?.scores ?? [0, 0]);
    }
  }

  handleWarEvent(message) {
    if (!message?.event) return;
    if (message.event === 'attack') {
      const localAttack = message.shooter === this.warSlot;
      const definition = WEAPONS[normalizeWarClass(message.classId)] ?? WEAPONS.shortbow;
      const origin = new THREE.Vector3().fromArray(message.origin ?? [0, 1.5, 0]);
      const direction = new THREE.Vector3().fromArray(message.direction ?? [0, 0, -1]);
      const hitPoint = new THREE.Vector3().fromArray(
        message.hitPoint ?? origin.clone().addScaledVector(direction, definition.range).toArray(),
      );
      if (!localAttack) {
        this.vfx.spawnMuzzle(
          origin,
          direction,
          magicColor(definition),
          magicPower(definition, 0.75),
          definition.id,
        );
        const tracePoints = Array.isArray(message.traces) && message.traces.length
          ? message.traces
          : [hitPoint.toArray()];
        tracePoints.forEach((point, pellet) => {
          showWeaponTrail(
            this.vfx,
            origin,
            new THREE.Vector3().fromArray(point),
            definition,
            pellet,
          );
        });
      }
      if (message.projectile) this.spawnWarProjectileState(message.projectile);
      if (localAttack && message.hit) {
        this.ui.showHit(Boolean(message.headshot), this.elapsed);
        const targets = Array.isArray(message.hits)
          ? message.hits
          : message.target != null
            ? [{ target: message.target, damage: message.damage }]
            : [];
        for (const hit of targets) {
          const target = this.warSnapshot?.combatants?.find(
            (combatant) => combatant.id === hit.target,
          );
          if (!target) continue;
          this.vfx.spawnDamageNumber(
            new THREE.Vector3().fromArray(target.position).add(new THREE.Vector3(0, 2.05, 0)),
            hit.damage,
          );
        }
      }
    } else if (message.event === 'class_selected') {
      this.selectWarNextClass(message.classId);
    } else if (
      message.event === 'impulse' &&
      message.player === this.warSlot &&
      Array.isArray(message.impulse)
    ) {
      this.player.velocity.add(new THREE.Vector3().fromArray(message.impulse));
    } else if (message.event === 'projectile_explode') {
      this.handleWarExplosion(message);
    } else if (message.event === 'match_end') {
      this.showWarResult(message.winner, message.scores ?? [0, 0]);
    }
  }

  spawnWarProjectileState(state) {
    if (!state || this.onlineProjectiles.has(state.id)) return;
    const definition = WEAPONS[state.classId] ?? WEAPONS.fireball;
    const velocity = new THREE.Vector3().fromArray(state.velocity);
    const projectile = this.spawnProjectile(
      state.owner === this.warSlot ? 'player' : 'bot',
      new THREE.Vector3().fromArray(state.position),
      velocity.clone().normalize(),
      definition,
      {
        networked: true,
        networkId: state.id,
        positionIsCenter: true,
      },
    );
    projectile.velocity.copy(velocity);
    this.onlineProjectiles.set(state.id, projectile);
  }

  syncWarProjectiles(states) {
    const active = new Set();
    for (const state of states) {
      active.add(state.id);
      const existing = this.onlineProjectiles.get(state.id);
      if (!existing) {
        this.spawnWarProjectileState(state);
        continue;
      }
      existing.position.lerp(new THREE.Vector3().fromArray(state.position), 0.45);
      existing.velocity.fromArray(state.velocity);
    }
    for (const [id, projectile] of this.onlineProjectiles) {
      if (active.has(id)) continue;
      const index = this.projectiles.indexOf(projectile);
      if (index >= 0) this.removeProjectile(index);
      this.onlineProjectiles.delete(id);
    }
  }

  handleWarExplosion(message) {
    const position = new THREE.Vector3().fromArray(message.position);
    const projectile = this.onlineProjectiles.get(message.projectileId);
    if (projectile) {
      projectile.position.copy(position);
      this.explodeProjectile(projectile);
      const index = this.projectiles.indexOf(projectile);
      if (index >= 0) this.removeProjectile(index);
      this.onlineProjectiles.delete(message.projectileId);
    } else {
      this.vfx.spawnExplosion(position, Number(message.radius) * 0.88);
      this.audio.explosion(this.getPan(position), 0.9);
      this.ui.flash();
    }
    if (message.owner === this.warSlot && message.damage?.length) {
      this.ui.showHit(false, this.elapsed);
    }
  }

  showWarResult(winner, scores) {
    if (this.mode === 'result') return;
    const won = Number(winner) === this.warTeam;
    this.mode = 'result';
    this.phase = 'result';
    this.player.inputEnabled = false;
    this.player.viewRoot.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.resetRematchButton();
    this.ui.showResult(
      won,
      `${Math.floor(Number(scores[this.warTeam]) || 0)}%`,
      `${Math.floor(Number(scores[1 - this.warTeam]) || 0)}%`,
      this.warTeam === 0 ? 'Red Team' : 'Blue Team',
    );
  }

  loadOnlineRound(state) {
    this.clearProjectiles();
    this.onlineProjectiles.clear();
    this.vfx.clear();
    this.arena.load(state.mapIndex, state.mapSeed);
    const loadout = state.pickups.map((pickup) => pickup.type);
    this.roundLoadout = loadout;
    this.pickups.reset(this.arena.weaponSlots, loadout);
    const local = state.players[this.onlineSlot];
    const remote = state.players[this.onlineSlot === 0 ? 1 : 0];
    this.player.reset(
      new THREE.Vector3().fromArray(local.position),
      local.yaw,
    );
    if (local.weapon !== 'knives') this.player.equip(local.weapon, false);
    this.player.ammo = local.ammo;
    this.player.reserve = local.reserve ?? this.player.definition.reserve;
    if (local.reloading) {
      this.player.startReload(true);
      this.player.reloadRemaining = Math.max(0, Number(local.reloadRemaining || 0) / 1000);
    }
    this.player.health = local.health;
    this.player.dead = local.dead;
    this.remote.reset(remote.position, remote.yaw, remote.weapon);
    this.remote.applyImmediate(remote);
    this.bot.root.visible = true;
    this.player.viewRoot.visible = !local.dead;
    this.onlineRoundLoaded = state.roundNumber;
    this.onlineMapLoaded = state.mapIndex;
    this.onlineStateHistory.clear();
    this.onlineSequence = Math.max(this.onlineSequence, Number(local.ack) || 0);
    this.pendingPickupClaims.clear();
    this.ui.showAnnouncement('Match', `Round ${state.roundNumber}`);
    this.network.send({
      type: 'ready',
      roundNumber: state.roundNumber,
    });
  }

  returnToTitle() {
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.matchType === 'online' || this.matchType === 'war') this.network.leave();
    this.audio.click();
    this.setupTitleScene();
  }

  pause() {
    const playable = this.phase === 'playing' || (
      this.matchType === 'war' &&
      (this.phase === 'locked' || this.phase === 'control')
    );
    if (this.mode !== 'match' || !playable) return;
    if (this.matchType === 'online' || this.matchType === 'war') {
      this.onlinePaused = true;
      this.player.inputEnabled = false;
      this.ui.showPause();
      return;
    }
    this.mode = 'paused';
    this.player.inputEnabled = false;
    this.ui.showPause();
  }

  async resume() {
    if (
      (this.matchType === 'online' || this.matchType === 'war') &&
      this.onlinePaused
    ) {
      await this.audio.init();
      this.onlinePaused = false;
      this.ui.hidePause();
      this.requestPointerLock();
      return;
    }
    if (this.mode !== 'paused') return;
    await this.audio.init();
    this.mode = 'match';
    this.ui.hidePause();
    this.requestPointerLock();
  }

  startRound() {
    this.clearProjectiles();
    this.vfx.clear();
    const mapIndex = this.mapOrder[(this.roundNumber - 1) % this.mapOrder.length];
    const mapSeed = this.matchSeed + this.roundNumber * 1009;
    this.arena.load(mapIndex, mapSeed);
    const loadout = getArenaLoadout(mapSeed, 6);
    this.roundLoadout = loadout;
    this.pickups.reset(this.arena.weaponSlots, loadout);
    this.playerTakes = 0;
    this.botTakes = 0;
    this.takeNumber = 1;
    this.resetCombatants();
    this.phase = 'roundIntro';
    this.phaseTimer = 2.65;
    this.ui.showHUD();
    this.ui.showAnnouncement('Match', `Round ${this.roundNumber}`);
    this.updateHUD();
  }

  resetCombatants() {
    this.clearProjectiles();
    this.vfx.clear();
    this.pickups.reset(this.arena.weaponSlots, this.roundLoadout);
    this.player.reset(this.arena.getSpawn('player'), this.arena.getSpawnYaw('player'));
    const scorePressure = (this.playerRounds - this.botRounds) * 0.055;
    const difficulty = clamp(0.93 + (this.roundNumber - 1) * 0.035 + scorePressure, 0.82, 1.22);
    this.bot.reset(this.arena.getSpawn('bot'), this.arena.getSpawnYaw('bot'), difficulty);
    this.player.viewRoot.visible = true;
    this.takeTime = 45;
    this.overtime = false;
    this.overtimeTick = 0;
  }

  beginCountdown() {
    this.resetCombatants();
    this.phase = 'countdown';
    this.phaseTimer = 3.15;
    this.lastCountdown = 4;
    this.ui.showAnnouncement(
      `Round ${this.roundNumber}`,
      '3',
    );
    this.audio.countdown(3);
    this.lastCountdown = 3;
  }

  beginTake() {
    this.phase = 'playing';
    this.phaseTimer = 0;
    this.takeTime = 45;
    this.overtime = false;
    this.ui.hideAnnouncement();
    this.audio.countdown(0);
    if (!document.pointerLockElement) this.requestPointerLock();
  }

  endTake(winner) {
    if (this.phase !== 'playing') return;
    this.phase = 'takeEnd';
    this.phaseTimer = 2.15;
    if (winner === 'player') {
      this.playerTakes += 1;
      this.ui.showAnnouncement(
        `Round ${this.roundNumber}`,
        'Point won',
        `${this.playerTakes}–${this.botTakes}`,
      );
      this.audio.roundResult(true);
    } else if (winner === 'bot') {
      this.botTakes += 1;
      this.ui.showAnnouncement(
        `Round ${this.roundNumber}`,
        'Point lost',
        `${this.playerTakes}–${this.botTakes}`,
      );
      this.audio.roundResult(false);
    } else {
      this.ui.showAnnouncement(`Round ${this.roundNumber}`, 'Draw');
      this.audio.roundResult(false);
    }
    this.player.inputEnabled = false;
    this.updateHUD();
  }

  endRound() {
    const playerWon = this.playerTakes >= 2;
    if (playerWon) this.playerRounds += 1;
    else this.botRounds += 1;
    this.pendingRoundWinner = playerWon ? 'player' : 'bot';
    this.phase = 'roundEnd';
    this.phaseTimer = 2.75;
    this.ui.showAnnouncement(
      'Match',
      playerWon ? 'Round won' : 'Round lost',
      `${this.playerRounds}–${this.botRounds}`,
    );
    this.audio.roundResult(playerWon);
    this.updateHUD();
  }

  finishMatch() {
    const won = this.playerRounds >= 4;
    this.mode = 'result';
    this.phase = 'result';
    this.player.inputEnabled = false;
    this.player.viewRoot.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showResult(won, this.playerRounds, this.botRounds);
  }

  applyOnlineSnapshot(state, initial = false) {
    if (!state?.players?.length || this.matchType !== 'online') return;
    const local = state.players[this.onlineSlot];
    const remote = state.players[this.onlineSlot === 0 ? 1 : 0];
    if (!local || !remote) return;
    const roundChanged =
      this.onlineRoundLoaded !== state.roundNumber ||
      this.onlineMapLoaded !== state.mapIndex;
    if (roundChanged) this.loadOnlineRound(state);

    const previousPhase = this.phase;
    this.onlineSnapshot = state;
    this.phase = state.phase;
    this.roundNumber = state.roundNumber;
    this.takeNumber = state.takeNumber;
    this.takeTime = Math.max(0, state.remaining / 1000);
    this.overtime = Boolean(state.overtime);
    this.playerRounds = state.rounds[this.onlineSlot];
    this.botRounds = state.rounds[this.onlineSlot === 0 ? 1 : 0];
    this.playerTakes = state.takes[this.onlineSlot];
    this.botTakes = state.takes[this.onlineSlot === 0 ? 1 : 0];

    const respawned =
      !roundChanged &&
      state.phase === 'countdown' &&
      previousPhase !== 'countdown';
    if (respawned) {
      this.player.reset(new THREE.Vector3().fromArray(local.position), local.yaw);
      if (local.weapon !== 'knives') this.player.equip(local.weapon, false);
      this.player.ammo = local.ammo;
      this.onlineStateHistory.clear();
      this.clearProjectiles();
      this.onlineProjectiles.clear();
    }

    const predicted = respawned ? null : this.onlineStateHistory.get(local.ack);
    if (predicted) {
      const correction = TEMP_POINT
        .fromArray(local.position)
        .sub(TEMP_POINT_B.fromArray(predicted));
      const error = correction.length();
      if (error > 0.04) {
        this.player.position.addScaledVector(
          correction,
          error > 1.8 ? 1 : 0.28,
        );
      }
      for (const sequence of this.onlineStateHistory.keys()) {
        if (sequence <= local.ack) this.onlineStateHistory.delete(sequence);
      }
    }

    const previousHealth = this.player.health;
    this.player.health = local.health;
    this.player.dead = local.dead;
    if (this.player.weaponType !== local.weapon) {
      this.player.equip(local.weapon, false);
    }
    this.player.ammo = local.ammo;
    this.player.reserve = local.reserve ?? this.player.reserve;
    if (local.reloading && !this.player.reloading) {
      this.player.startReload(true);
    }
    if (local.reloading) {
      this.player.reloadRemaining = Math.max(0, Number(local.reloadRemaining || 0) / 1000);
    } else if (this.player.reloading) {
      this.player.cancelReload();
    }
    if (local.dead) this.player.viewRoot.visible = false;
    else if (this.phase !== 'result') this.player.viewRoot.visible = true;
    if (
      local.health < previousHealth &&
      previousPhase !== 'playing' &&
      this.phase !== 'playing'
    ) {
      this.rendering.setDamage(0.16);
    }

    this.remote.push(remote);
    this.remote.applyImmediate(remote);
    this.syncOnlinePickups(state.pickups);
    this.updateOnlinePhasePresentation(previousPhase, state, initial);
    this.updateHUD(true);
  }

  syncOnlinePickups(states) {
    if (!Array.isArray(states)) return;
    for (const state of states) {
      const pickup = this.pickups.pickups[state.id];
      if (!pickup) continue;
      pickup.active = Boolean(state.active);
      pickup.group.visible = pickup.active;
      if (!pickup.active) this.pendingPickupClaims.delete(state.id);
    }
  }

  updateOnlinePhasePresentation(previousPhase, state, initial) {
    if (state.phase === 'loading') {
      this.player.inputEnabled = false;
    } else if (state.phase === 'roundIntro' && previousPhase !== 'roundIntro') {
      this.ui.showAnnouncement('Match', `Round ${state.roundNumber}`);
    } else if (state.phase === 'countdown') {
      const value = Math.max(1, Math.ceil(state.remaining / 1000));
      if (previousPhase !== 'countdown' || value !== this.lastOnlineCountdown) {
        this.lastOnlineCountdown = value;
        this.ui.showAnnouncement(
          `Round ${state.roundNumber}`,
          String(value),
        );
        this.audio.countdown(value);
      }
    } else if (state.phase === 'playing' && previousPhase !== 'playing') {
      this.ui.hideAnnouncement();
      this.audio.countdown(0);
      if (!document.pointerLockElement && !initial) {
        this.ui.showAnnouncement('Match', 'Click to start');
      }
    } else if (state.phase === 'reconnecting') {
      this.player.inputEnabled = false;
      this.ui.showConnectionOverlay(
        'The other player disconnected. The match is paused.',
      );
    } else if (state.phase === 'result' && this.mode !== 'result') {
      this.showOnlineResult(state.winner, state.rounds, state.resultReason);
    }
    if (previousPhase === 'reconnecting' && state.phase !== 'reconnecting') {
      this.ui.hideConnectionOverlay();
    }
    this.lastOnlinePhase = state.phase;
  }

  handleOnlineEvent(message) {
    if (!message?.event) return;
    if (message.event === 'shot') {
      this.handleOnlineShot(message);
    } else if (message.event === 'pickup') {
      this.handleOnlinePickup(message);
    } else if (message.event === 'discard') {
      const local = message.player === this.onlineSlot;
      if (local) {
        this.player.equip('knives', false);
        this.player.ammo = message.ammo;
        this.player.reserve = message.reserve ?? this.player.definition.reserve;
      } else {
        this.bot.equip('knives');
        this.bot.ammo = message.ammo;
        this.bot.reserve = message.reserve ?? WEAPONS.knives.reserve;
      }
    } else if (message.event === 'reload_start') {
      if (message.player === this.onlineSlot) {
        if (!this.player.reloading) this.player.startReload(true);
        this.player.reloadDuration = Number(message.duration || this.player.definition.reloadMs) / 1000;
        this.player.reloadRemaining = this.player.reloadDuration;
      } else {
        this.bot.reloading = true;
      }
    } else if (message.event === 'reload_complete') {
      if (message.player === this.onlineSlot) {
        this.player.finishReload(message.ammo, message.reserve);
      } else {
        this.bot.ammo = message.ammo;
        this.bot.reserve = message.reserve;
        this.bot.reloading = false;
      }
    } else if (message.event === 'explosion') {
      this.handleOnlineExplosion(message);
    } else if (message.event === 'take_end') {
      const won = message.winner === this.onlineSlot;
      const draw = message.winner == null;
      this.player.inputEnabled = false;
      this.ui.showAnnouncement(
        `Round ${this.roundNumber}`,
        draw ? 'Draw' : won ? 'Point won' : 'Point lost',
        draw
          ? ''
          : `${message.takes[this.onlineSlot]}–${message.takes[this.onlineSlot === 0 ? 1 : 0]}`,
      );
      this.audio.roundResult(won && !draw);
      if (!won && !draw) this.player.viewRoot.visible = false;
    } else if (message.event === 'round_end') {
      const won = message.winner === this.onlineSlot;
      this.ui.showAnnouncement(
        'Match',
        won ? 'Round won' : 'Round lost',
        `${message.rounds[this.onlineSlot]}–${message.rounds[this.onlineSlot === 0 ? 1 : 0]}`,
      );
      this.audio.roundResult(won);
    } else if (message.event === 'match_end') {
      this.showOnlineResult(message.winner, message.rounds, message.reason);
    } else if (message.event === 'overtime') {
      this.ui.showAnnouncement(`Round ${this.roundNumber}`, 'Overtime');
      window.setTimeout(() => {
        if (this.matchType === 'online' && this.overtime) this.ui.hideAnnouncement();
      }, 950);
      this.audio.countdown(0);
    } else if (message.event === 'overtime_damage') {
      const health = message.health[this.onlineSlot];
      if (health < this.player.health) {
        this.damagePlayer(this.player.health - health, this.bot.position, false);
      }
      this.player.health = health;
      const opponentHealth = message.health[this.onlineSlot === 0 ? 1 : 0];
      if (opponentHealth < this.bot.health) this.bot.flashHit = 0.1;
      this.bot.health = opponentHealth;
      if (opponentHealth <= 0) this.bot.dead = true;
      this.bot.updateFighterState();
      this.bot.updateHealthBar();
    } else if (message.event === 'opponent_disconnected') {
      const localDrop = message.player === this.onlineSlot;
      this.ui.showConnectionOverlay(
        localDrop
          ? 'Reconnecting. The match is paused.'
          : 'The other player disconnected. The match is paused.',
      );
    } else if (message.event === 'opponent_reconnected') {
      this.ui.hideConnectionOverlay();
    } else if (message.event === 'rematch_status') {
      if (message.ready[this.onlineSlot]) this.ui.showRematchWaiting();
    }
  }

  handleOnlineShot(message) {
    const definition = WEAPONS[message.weapon];
    if (!definition) return;
    const localShot = message.shooter === this.onlineSlot;
    if (message.projectile) {
      this.spawnOnlineProjectile(message);
    }
    if (localShot) {
      this.player.ammo = message.ammo;
      this.player.reserve = message.reserve ?? this.player.reserve;
      if (message.hit) {
        this.ui.showHit(message.headshot, this.elapsed);
        this.audio.impact(true, message.headshot);
        const damagePosition = message.hitPoint
          ? new THREE.Vector3().fromArray(message.hitPoint)
          : this.bot.getHeadCenter(new THREE.Vector3());
        damagePosition.y += 0.28;
        this.vfx.spawnDamageNumber(damagePosition, message.damage, {
          headshot: message.headshot,
        });
        if (message.hitPoint) {
          this.vfx.spawnBloodImpact(
            new THREE.Vector3().fromArray(message.hitPoint),
            new THREE.Vector3().fromArray(message.direction).multiplyScalar(0.7),
            message.headshot,
          );
        }
        this.bot.health = message.targetHealth;
        this.bot.flashHit = 0.1;
        if (message.targetHealth <= 0) this.bot.dead = true;
        this.bot.updateFighterState();
        this.bot.updateHealthBar();
      }
      return;
    }

    this.bot.ammo = message.ammo;
    this.bot.reserve = message.reserve ?? this.bot.reserve;
    this.bot.recoil = Math.min(1.8, this.bot.recoil + definition.recoil);
    this.bot.attackTime = definition.id === 'greatsword' ? 0.46 : 0.24;
    const direction = new THREE.Vector3().fromArray(message.direction).normalize();
    const muzzle = this.bot.getMuzzlePosition(new THREE.Vector3());
    this.audio.gun(definition.sound, this.getPan(muzzle), true);
    this.vfx.spawnMuzzle(
      muzzle,
      direction,
      magicColor(definition),
      magicPower(definition, 0.9),
      definition.id,
    );
    if (!message.projectile) {
      const traces = message.traces?.slice(
        0,
        definition.id === 'ember' ? 5 : 1,
      ) ?? [];
      for (let traceIndex = 0; traceIndex < traces.length; traceIndex += 1) {
        showWeaponTrail(
          this.vfx,
          muzzle,
          new THREE.Vector3().fromArray(traces[traceIndex]),
          definition,
          traceIndex,
        );
      }
    }
    if (message.target === this.onlineSlot && message.damage > 0) {
      this.damagePlayer(
        message.damage,
        this.bot.position,
        message.headshot,
      );
      this.player.health = message.targetHealth;
    }
  }

  handleOnlinePickup(message) {
    const pickup = this.pickups.pickups[message.pickupId];
    if (!pickup) return;
    if (pickup.active) {
      this.pickups.collect(pickup);
      this.spawnPickupBurst(pickup.position, pickup.definition.accent);
    }
    this.pendingPickupClaims.delete(message.pickupId);
    if (message.player === this.onlineSlot) {
      this.player.equip(message.weapon);
      this.player.ammo = message.ammo;
      this.player.reserve = message.reserve ?? this.player.definition.reserve;
    } else {
      this.bot.equip(message.weapon);
      this.bot.ammo = message.ammo;
      this.bot.reserve = message.reserve ?? WEAPONS[message.weapon].reserve;
      this.audio.tone({
        frequency: 390,
        endFrequency: 610,
        duration: 0.09,
        volume: 0.035,
        type: 'square',
        pan: this.getPan(pickup.position),
      });
    }
  }

  spawnOnlineProjectile(message) {
    if (!message.projectile || this.onlineProjectiles.has(message.projectile.id)) return;
    const definition = WEAPONS[message.weapon];
    const velocity = new THREE.Vector3().fromArray(message.projectile.velocity);
    const direction = velocity.clone().normalize();
    const projectile = this.spawnProjectile(
      message.shooter === this.onlineSlot ? 'player' : 'bot',
      new THREE.Vector3().fromArray(message.projectile.position),
      direction,
      definition,
      {
        networked: true,
        networkId: message.projectile.id,
        positionIsCenter: true,
      },
    );
    projectile.velocity.copy(velocity);
    this.onlineProjectiles.set(message.projectile.id, projectile);
  }

  handleOnlineExplosion(message) {
    const projectile = this.onlineProjectiles.get(message.projectileId);
    const position = new THREE.Vector3().fromArray(message.position);
    if (projectile) {
      projectile.position.copy(position);
      this.explodeProjectile(projectile);
      const index = this.projectiles.indexOf(projectile);
      if (index >= 0) this.removeProjectile(index);
      this.onlineProjectiles.delete(message.projectileId);
    } else {
      this.vfx.spawnExplosion(position, message.radius * 0.88);
      this.audio.explosion(this.getPan(position), 0.9);
      this.ui.flash();
    }
    for (const entry of message.damage) {
      if (entry.player === this.onlineSlot) {
        this.damagePlayer(entry.amount, position, false);
        this.player.health = entry.health;
        this.player.velocity.add(new THREE.Vector3().fromArray(entry.impulse));
      } else {
        this.bot.health = entry.health;
        this.bot.flashHit = Math.max(this.bot.flashHit, 0.1);
        if (entry.health <= 0) this.bot.dead = true;
        this.bot.updateFighterState();
        this.bot.updateHealthBar();
        this.bot.velocity.add(new THREE.Vector3().fromArray(entry.impulse));
        if (message.owner === this.onlineSlot) {
          this.ui.showHit(false, this.elapsed);
          this.audio.impact(true, false);
          this.vfx.spawnDamageNumber(
            this.bot.getHeadCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.28, 0)),
            entry.amount,
          );
        }
      }
    }
  }

  showOnlineResult(winner, rounds, reason = 'score') {
    if (this.mode === 'result') return;
    const won = winner === this.onlineSlot;
    this.mode = 'result';
    this.phase = 'result';
    this.player.inputEnabled = false;
    this.player.viewRoot.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const localRounds = rounds[this.onlineSlot];
    const remoteRounds = rounds[this.onlineSlot === 0 ? 1 : 0];
    this.playerRounds = localRounds;
    this.botRounds = remoteRounds;
    this.ui.resetRematchButton();
    this.ui.showResult(won, localRounds, remoteRounds, this.onlineOpponent);
    if (reason === 'disconnect' || reason === 'forfeit') {
      this.ui.resultDetail.textContent = won
        ? 'Opponent disconnected.'
        : 'Connection lost.';
    }
  }

  traceAgainstWar(origin, direction, range) {
    const worldHit = this.arena.raycast(origin, direction, range);
    let distance = worldHit?.distance ?? range;
    let target = null;
    for (const combatant of this.warSnapshot?.combatants ?? []) {
      if (
        combatant.id === this.warSlot ||
        combatant.team === this.warTeam ||
        combatant.dead
      ) {
        continue;
      }
      const position = new THREE.Vector3().fromArray(combatant.position);
      const bodyDistance = raySphereDistance(
        origin,
        direction,
        position.clone().add(new THREE.Vector3(0, CHARACTER_HITBOX.body.offsetY, 0)),
        CHARACTER_HITBOX.body.radius,
      );
      const headDistance = raySphereDistance(
        origin,
        direction,
        position.clone().add(new THREE.Vector3(0, CHARACTER_HITBOX.head.offsetY, 0)),
        CHARACTER_HITBOX.head.radius,
      );
      const candidate = bodyDistance == null
        ? headDistance
        : headDistance == null
          ? bodyDistance
          : Math.min(bodyDistance, headDistance);
      if (candidate == null || candidate >= distance) continue;
      distance = candidate;
      target = combatant;
    }
    return {
      target,
      distance,
      point: origin.clone().addScaledVector(direction, distance),
      worldHit,
    };
  }

  fireWarWeapon() {
    const classDefinition = WAR_CLASSES[this.warClassId];
    const definition = WEAPONS[classDefinition.weapon];
    if (this.player.reloading) return false;
    if (classDefinition.usesAmmo && this.player.ammo <= 0) {
      return this.startWarReload();
    }
    if (
      !definition ||
      this.player.dead ||
      this.elapsed - this.warLastAttackAt < classDefinition.attackMs / 1_000
    ) {
      return false;
    }
    this.warLastAttackAt = this.elapsed;
    this.player.registerShot(this.elapsed);
    this.ui.showShot(this.elapsed);
    const { origin, direction } = this.player.getAim(TEMP_ORIGIN, TEMP_DIRECTION);
    const muzzle = this.player.getMuzzlePosition(new THREE.Vector3());
    this.audio.gun(definition.sound);
    this.vfx.spawnMuzzle(
      muzzle,
      direction,
      magicColor(definition),
      magicPower(definition, 1),
      definition.id,
    );
    if (definition.id !== 'greatsword' && !definition.projectile) {
      const visualSpread = this.player.focused
        ? definition.focusSpread
        : definition.spread;
      const pelletCount = Math.max(1, Number(definition.pellets) || 1);
      for (let pellet = 0; pellet < pelletCount; pellet += 1) {
        const pelletDirection = pellet === 0
          ? direction
          : spreadDirection(direction, visualSpread);
        const result = this.traceAgainstWar(
          origin,
          pelletDirection,
          classDefinition.range,
        );
        showWeaponTrail(this.vfx, muzzle, result.point, definition, pellet);
        if (pellet === 0 && !result.target && result.worldHit) {
          this.vfx.spawnImpact(result.point, result.worldHit.normal, {
            count: definition.id === 'lightning' ? 18 : 7,
            color: definition.id === 'lightning' ? 0x8feaff : definition.accent,
            kind: definition.id,
          });
        }
      }
    }
    const shotId = ++this.onlineShotSequence;
    this.network.send({
      type: 'war_shoot',
      shotId,
      direction: direction.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    });
    if (definition.id === 'lightning' || definition.id === 'greatsword') {
      this.ui.flash();
    }
    return true;
  }

  startWarReload() {
    const definition = WAR_CLASSES[this.warClassId];
    if (!definition.usesAmmo || !this.player.startReload(true)) return false;
    this.network.send({ type: 'war_reload' });
    return true;
  }

  sendWarState() {
    if (!this.network.inMatch || this.network.status !== 'online') return;
    const sequence = ++this.onlineSequence;
    const position = this.player.position.toArray();
    this.onlineStateHistory.set(sequence, position);
    while (this.onlineStateHistory.size > 64) {
      this.onlineStateHistory.delete(this.onlineStateHistory.keys().next().value);
    }
    this.network.send({
      type: 'war_state',
      sequence,
      position,
      velocity: this.player.velocity.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      grounded: this.player.grounded,
      sliding: this.lastMovement.sliding,
      wallRunning: this.lastMovement.wallRunning,
      focused: this.player.focused,
      rtt: this.network.rtt,
    });
  }

  updateWar(delta) {
    const canMove =
      (this.phase === 'locked' || this.phase === 'control') &&
      this.network.status === 'online' &&
      !this.onlinePaused &&
      !this.player.dead;
    this.lastMovement = this.player.update(delta, canMove);
    if (canMove && this.lastMovement.reload) this.startWarReload();
    if (canMove && this.lastMovement.fire) this.fireWarWeapon();
    if (this.player.dead) {
      this.player.respawnRemaining = Math.max(
        0,
        (Number(this.player.respawnRemaining) || 0) - delta * 1_000,
      );
    }
    this.warCrowd.update(this.camera, delta);
    this.updateProjectiles(delta);

    this.warSendAccumulator += delta;
    if (canMove && this.warSendAccumulator >= 1 / 20) {
      this.warSendAccumulator %= 1 / 20;
      this.sendWarState();
    }
    this.hudAccumulator += delta;
    if (this.hudAccumulator >= 0.1 && this.warSnapshot) {
      this.hudAccumulator = 0;
      const local = this.warSnapshot.combatants.find(
        (combatant) => combatant.id === this.warSlot,
      );
      if (local) {
        this.ui.updateWarHUD(
          this.warSnapshot.control,
          {
            ...local,
            health: this.player.health,
            dead: this.player.dead,
            respawnRemaining: this.player.respawnRemaining,
            focused: this.player.focused,
            ammo: this.player.ammo,
            reserve: this.player.reserve,
            usesAmmo: WAR_CLASSES[this.warClassId].usesAmmo,
          },
          this.warTeam,
        );
      }
    }
  }

  updateOnline(delta) {
    const canMove =
      this.phase === 'playing' &&
      this.network.status === 'online' &&
      !this.onlinePaused &&
      !this.player.dead;
    this.lastMovement = this.player.update(delta, canMove);
    this.remote.update(delta);
    if (this.lastMovement.reload && canMove) this.startPlayerReload(true);

    if (canMove) {
      const pickup = this.pickups.findPlayerContact(this.player.position);
      if (pickup) {
        const pickupId = this.pickups.pickups.indexOf(pickup);
        const lastClaim = this.pendingPickupClaims.get(pickupId) ?? -Infinity;
        if (this.elapsed - lastClaim > 0.45) {
          this.pendingPickupClaims.set(pickupId, this.elapsed);
          this.network.send({ type: 'pickup', pickupId });
        }
      }
      if (this.lastMovement.fire) this.fireOnlineWeapon();
    }

    this.updateProjectiles(delta);
    if (this.phase === 'playing' && !this.overtime) {
      this.takeTime = Math.max(0, this.takeTime - delta);
    }
    this.onlineSendAccumulator += delta;
    if (this.onlineSendAccumulator >= 1 / 30) {
      this.onlineSendAccumulator %= 1 / 30;
      this.sendOnlineState();
    }
    this.hudAccumulator += delta;
    if (this.hudAccumulator >= 1 / 30) {
      this.hudAccumulator = 0;
      this.updateHUD(true);
    }
  }

  sendOnlineState() {
    if (!this.network.inMatch || this.network.status !== 'online') return;
    const sequence = ++this.onlineSequence;
    const position = this.player.position.toArray();
    this.onlineStateHistory.set(sequence, position);
    while (this.onlineStateHistory.size > 96) {
      this.onlineStateHistory.delete(this.onlineStateHistory.keys().next().value);
    }
    this.network.send({
      type: 'state',
      sequence,
      position,
      velocity: this.player.velocity.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      grounded: this.player.grounded,
      sliding: this.lastMovement.sliding,
      wallRunning: this.lastMovement.wallRunning,
      focused: this.player.focused,
      rtt: this.network.rtt,
    });
  }

  updateMatch(delta) {
    if (this.matchType === 'war') {
      this.updateWar(delta);
      return;
    }
    if (this.matchType === 'online') {
      this.updateOnline(delta);
      return;
    }
    if (this.phase === 'roundIntro') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      if (this.phaseTimer <= 0) this.beginCountdown();
    } else if (this.phase === 'countdown') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.update(delta, this.elapsed, this.player, this.pickups.pickups, false);
      const value = Math.max(1, Math.ceil(this.phaseTimer));
      if (value !== this.lastCountdown && this.phaseTimer > 0.08) {
        this.lastCountdown = value;
        this.ui.showAnnouncement(
          `Round ${this.roundNumber}`,
          String(value),
        );
        this.audio.countdown(value);
      }
      if (this.phaseTimer <= 0) this.beginTake();
    } else if (this.phase === 'playing') {
      this.updatePlaying(delta);
    } else if (this.phase === 'takeEnd') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      this.updateProjectiles(delta);
      if (this.phaseTimer <= 0) {
        if (this.playerTakes >= 2 || this.botTakes >= 2) {
          this.endRound();
        } else {
          this.takeNumber += 1;
          this.beginCountdown();
        }
      }
    } else if (this.phase === 'roundEnd') {
      this.phaseTimer -= delta;
      this.player.update(delta, false);
      this.bot.animate(delta, new THREE.Vector3(), false);
      if (this.phaseTimer <= 0) {
        if (this.playerRounds >= 4 || this.botRounds >= 4) {
          this.finishMatch();
        } else {
          this.roundNumber += 1;
          this.startRound();
        }
      }
    }
  }

  updatePlaying(delta) {
    this.takeTime = Math.max(0, this.takeTime - delta);
    if (this.takeTime <= 0 && !this.overtime) {
      this.overtime = true;
      this.overtimeTick = 0;
      this.ui.showAnnouncement(`Round ${this.roundNumber}`, 'Overtime');
      window.setTimeout(() => {
        if (this.phase === 'playing' && this.overtime) this.ui.hideAnnouncement();
      }, 950);
      this.audio.countdown(0);
    }

    this.lastMovement = this.player.update(delta, true);
    if (this.lastMovement.reload) this.startPlayerReload(false);

    const botAction = this.bot.update(
      delta,
      this.elapsed,
      this.player,
      this.pickups.pickups,
      true,
    );

    const playerPickup = this.pickups.findPlayerContact(this.player.position);
    if (playerPickup) {
      this.pickups.collect(playerPickup);
      this.player.equip(playerPickup.type);
      this.spawnPickupBurst(playerPickup.position, playerPickup.definition.accent);
    }
    if (botAction.pickup) {
      this.pickups.collect(botAction.pickup);
      this.spawnPickupBurst(botAction.pickup.position, botAction.pickup.definition.accent);
      const pan = this.getPan(botAction.pickup.position);
      this.audio.tone({
        frequency: 390,
        endFrequency: 610,
        duration: 0.09,
        volume: 0.035,
        type: 'square',
        pan,
      });
    }

    if (this.lastMovement.fire) this.firePlayerWeapon();
    if (botAction.fire) this.fireBotWeapon();
    this.updateProjectiles(delta);

    if (this.overtime) {
      this.overtimeTick += delta;
      if (this.overtimeTick >= 0.55) {
        this.overtimeTick -= 0.55;
        if (!this.player.dead) this.damagePlayer(5, this.bot.position, false);
        if (!this.bot.dead) {
          this.bot.damage(5);
          this.vfx.spawnBloodImpact(
            this.bot.getBodyCenter(new THREE.Vector3()),
            new THREE.Vector3(0, 1, 0),
            false,
          );
        }
        this.rendering.setDamage(0.14);
      }
    }

    if (this.player.position.y < -8 && !this.player.dead) {
      this.damagePlayer(999, this.bot.position, false);
    }
    this.resolveDeaths();
  }

  startPlayerReload(serverControlled) {
    if (!this.player.startReload(serverControlled)) return false;
    if (serverControlled) this.network.send({ type: 'reload' });
    return true;
  }

  handleEmptyWeapon(serverControlled) {
    if (
      this.player.definition.usesAmmo === false ||
      this.player.ammo > 0
    ) {
      return false;
    }
    if (this.player.reloading || this.startPlayerReload(serverControlled)) return true;
    this.player.dryFire(this.elapsed);
    return true;
  }

  firePlayerWeapon() {
    const definition = this.player.definition;
    if (!this.player.canFire(this.elapsed)) {
      this.handleEmptyWeapon(false);
      return;
    }

    this.player.registerShot(this.elapsed);
    this.ui.showShot(this.elapsed);
    const { origin, direction } = this.player.getAim(TEMP_ORIGIN, TEMP_DIRECTION);
    const muzzle = this.player.getMuzzlePosition(new THREE.Vector3());
    this.audio.gun(definition.sound);
    this.vfx.spawnMuzzle(
      muzzle,
      direction,
      magicColor(definition),
      magicPower(definition, 1),
      definition.id,
    );

    if (definition.projectile) {
      this.spawnProjectile('player', muzzle, direction, definition);
    } else {
      let anyHit = false;
      let headshot = false;
      let totalDamage = 0;
      for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
        const spread = this.player.focused
          ? definition.focusSpread
          : definition.spread *
            (this.player.grounded ? 1 : 1.42) *
            (1 + clamp(this.lastMovement.speed / 12, 0, 0.3));
        const shotDirection = spreadDirection(direction, spread);
        const result = this.traceAgainstBot(origin, shotDirection, definition.range);
        const end = result.point;
        if (result.kind === 'bot') {
          const falloff =
            definition.id === 'ember'
              ? clamp(1.15 - result.distance / 38, 0.32, 1)
              : 1;
          const damage =
            definition.damage *
            falloff *
            (result.headshot ? definition.headMultiplier : 1);
          totalDamage += this.bot.damage(damage);
          anyHit = true;
          headshot ||= result.headshot;
          this.vfx.spawnBloodImpact(
            end,
            shotDirection.clone().multiplyScalar(0.7),
            result.headshot,
          );
          this.audio.impact(true, result.headshot);
        } else if (result.kind === 'world') {
          this.vfx.spawnImpact(end, result.normal, {
            count: definition.id === 'lightning' ? 24 : definition.id === 'ember' ? 5 : 10,
            color: definition.id === 'lightning' ? 0x8feaff : 0xffb043,
            kind: definition.id,
          });
          if (pellet === 0 || definition.pellets === 1) this.audio.impact(false);
        }
        showWeaponTrail(this.vfx, muzzle, end, definition, pellet);
      }
      if (anyHit) {
        this.ui.showHit(headshot, this.elapsed);
        this.vfx.spawnDamageNumber(
          this.bot.getHeadCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.28, 0)),
          totalDamage,
          { headshot },
        );
      }
    }

    if (definition.id === 'lightning' || definition.id === 'ember' || definition.id === 'greatsword') this.ui.flash();
  }

  fireOnlineWeapon() {
    const definition = this.player.definition;
    if (!this.player.canFire(this.elapsed)) {
      this.handleEmptyWeapon(true);
      return;
    }

    this.player.registerShot(this.elapsed);
    this.ui.showShot(this.elapsed);
    const { origin, direction } = this.player.getAim(TEMP_ORIGIN, TEMP_DIRECTION);
    const muzzle = this.player.getMuzzlePosition(new THREE.Vector3());
    this.audio.gun(definition.sound);
    this.vfx.spawnMuzzle(
      muzzle,
      direction,
      magicColor(definition),
      magicPower(definition, 1),
      definition.id,
    );

    if (!definition.projectile) {
      for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
        const spread = this.player.focused
          ? definition.focusSpread
          : definition.spread *
            (this.player.grounded ? 1 : 1.42) *
            (1 + clamp(this.lastMovement.speed / 12, 0, 0.3));
        const shotDirection = spreadDirection(direction, spread);
        const result = this.traceAgainstBot(origin, shotDirection, definition.range);
        if (result.kind === 'world') {
          this.vfx.spawnImpact(result.point, result.normal, {
            count: definition.id === 'lightning' ? 18 : definition.id === 'ember' ? 3 : 7,
            color: definition.id === 'lightning' ? 0x8feaff : 0xffb043,
            kind: definition.id,
            debris: pellet === 0,
          });
        }
        showWeaponTrail(this.vfx, muzzle, result.point, definition, pellet);
      }
    }

    const shotId = ++this.onlineShotSequence;
    this.network.send({
      type: 'shoot',
      shotId,
      direction: direction.toArray(),
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    });

    if (definition.id === 'lightning' || definition.id === 'ember' || definition.id === 'greatsword') this.ui.flash();
  }

  fireBotWeapon() {
    if (this.bot.dead || this.player.dead) return;
    const definition = this.bot.definition;
    const origin = this.bot.getEyePosition(new THREE.Vector3());
    const muzzle = this.bot.getMuzzlePosition(new THREE.Vector3());
    const baseDirection = this.bot.aimDirection.clone().normalize();
    const pan = this.getPan(muzzle);
    this.audio.gun(definition.sound, pan, true);
    this.vfx.spawnMuzzle(
      muzzle,
      baseDirection,
      magicColor(definition),
      magicPower(definition, 0.9),
      definition.id,
    );
    if (definition.projectile) {
      this.spawnProjectile('bot', muzzle, baseDirection, definition);
      return;
    }

    for (let pellet = 0; pellet < definition.pellets; pellet += 1) {
      const botSpread =
        definition.spread *
        (definition.id === 'ember' ? 0.9 : 0.72) *
        (1.14 - this.bot.difficulty * 0.12);
      const direction = spreadDirection(baseDirection, botSpread);
      const result = this.traceAgainstPlayer(origin, direction, definition.range);
      if (result.kind === 'player') {
        const falloff =
          definition.id === 'ember'
            ? clamp(1.12 - result.distance / 34, 0.3, 1)
            : 1;
        const damage =
          definition.damage *
          falloff *
          (result.headshot ? definition.headMultiplier : 1) *
          0.9;
        this.damagePlayer(damage, this.bot.position, result.headshot);
      } else if (result.kind === 'world') {
        this.vfx.spawnImpact(result.point, result.normal, {
          count: definition.id === 'ember' ? 4 : 8,
          color: definition.id === 'lightning' ? 0x8feaff : 0xff9b43,
          kind: definition.id,
          debris: pellet === 0,
        });
      }
      showWeaponTrail(this.vfx, muzzle, result.point, definition, pellet);
    }
  }

  traceAgainstBot(origin, direction, range) {
    const worldHit = this.arena.raycast(origin, direction, range);
    const worldDistance = worldHit?.distance ?? range;
    if (!this.bot.dead) {
      const headCenter = this.bot.getHeadCenter(new THREE.Vector3());
      const bodyCenter = this.bot.getBodyCenter(new THREE.Vector3());
      const headDistance = raySphereDistance(
        origin,
        direction,
        headCenter,
        CHARACTER_HITBOX.head.radius,
      );
      const bodyDistance = raySphereDistance(
        origin,
        direction,
        bodyCenter,
        CHARACTER_HITBOX.body.radius,
      );
      let distance = null;
      let headshot = false;
      if (headDistance != null && headDistance < worldDistance) {
        distance = headDistance;
        headshot = true;
      }
      if (
        bodyDistance != null &&
        bodyDistance < worldDistance &&
        (distance == null || bodyDistance < distance)
      ) {
        distance = bodyDistance;
        headshot = false;
      }
      if (distance != null) {
        return {
          kind: 'bot',
          distance,
          headshot,
          point: origin.clone().addScaledVector(direction, distance),
          normal: direction.clone().negate(),
        };
      }
    }
    if (worldHit) {
      return {
        kind: 'world',
        distance: worldHit.distance,
        point: worldHit.point.clone(),
        normal: worldHit.normal,
      };
    }
    return {
      kind: 'miss',
      distance: range,
      point: origin.clone().addScaledVector(direction, range),
      normal: direction.clone().negate(),
    };
  }

  traceAgainstPlayer(origin, direction, range) {
    const worldHit = this.arena.raycast(origin, direction, range);
    const worldDistance = worldHit?.distance ?? range;
    if (!this.player.dead) {
      const headCenter = this.player.position
        .clone()
        .add(new THREE.Vector3(0, this.player.cameraHeight, 0));
      const bodyCenter = this.player.position.clone().add(new THREE.Vector3(0, 0.93, 0));
      const headDistance = raySphereDistance(origin, direction, headCenter, 0.31);
      const bodyDistance = raySphereDistance(origin, direction, bodyCenter, 0.56);
      let distance = null;
      let headshot = false;
      if (headDistance != null && headDistance < worldDistance) {
        distance = headDistance;
        headshot = true;
      }
      if (
        bodyDistance != null &&
        bodyDistance < worldDistance &&
        (distance == null || bodyDistance < distance)
      ) {
        distance = bodyDistance;
        headshot = false;
      }
      if (distance != null) {
        return {
          kind: 'player',
          distance,
          headshot,
          point: origin.clone().addScaledVector(direction, distance),
          normal: direction.clone().negate(),
        };
      }
    }
    if (worldHit) {
      return {
        kind: 'world',
        distance: worldHit.distance,
        point: worldHit.point.clone(),
        normal: worldHit.normal,
      };
    }
    return {
      kind: 'miss',
      distance: range,
      point: origin.clone().addScaledVector(direction, range),
      normal: direction.clone().negate(),
    };
  }

  damagePlayer(amount, sourcePosition, headshot = false) {
    if (this.player.dead) return;
    const applied = this.player.damage(amount);
    if (applied <= 0) return;
    const sourceDirection = sourcePosition.clone().sub(this.player.position);
    const sourceYaw = Math.atan2(-sourceDirection.x, -sourceDirection.z);
    const relative = sourceYaw - this.player.yaw;
    this.ui.showDamage(relative, this.elapsed);
    this.audio.hurt(applied, this.getPan(sourcePosition));
    this.audio.impact(true, headshot, this.getPan(sourcePosition));
    this.rendering.setDamage(clamp(0.22 + applied / 80, 0.22, 0.88));
  }

  spawnProjectile(owner, position, direction, definition, options = {}) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.SpriteMaterial({
      map: fireballTexture,
      color: owner === 'player' ? 0xffffff : 0xffd6ca,
      transparent: true,
      alphaTest: 0.04,
      depthWrite: true,
      fog: true,
      toneMapped: true,
    });
    const body = new THREE.Sprite(bodyMaterial);
    body.name = 'individual-photographic-fireball-projectile';
    body.scale.set(0.92, 0.92, 1);
    group.add(body);
    const light = new THREE.PointLight(
      owner === 'player' ? 0xff9e3d : 0xff5336,
      3.2,
      5,
      2,
    );
    light.position.z = 0.18;
    group.add(light);
    group.position.copy(position);
    if (!options.positionIsCenter) group.position.addScaledVector(direction, 0.58);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    this.scene.add(group);
    const projectile = {
      owner,
      definition,
      mesh: group,
      position: group.position,
      velocity: direction.clone().multiplyScalar(definition.projectileSpeed),
      life: 4.2,
      bodyMaterial,
      glowMaterial: null,
      networked: Boolean(options.networked),
      networkId: options.networkId ?? null,
      trailAccumulator: 0,
    };
    this.projectiles.push(projectile);
    this.player.addShake(owner === 'player' ? 0.08 : 0, 0.12);
    return projectile;
  }

  updateProjectiles(delta) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= delta;
      const speed = projectile.velocity.length();
      const direction = projectile.velocity.clone().normalize();
      const distance = speed * delta;
      if (projectile.networked) {
        projectile.position.addScaledVector(projectile.velocity, delta);
        projectile.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, -1),
          direction,
        );
        projectile.trailAccumulator += delta;
        if (projectile.trailAccumulator >= 1 / 45) {
          projectile.trailAccumulator %= 1 / 45;
          this.vfx.addParticle(
            projectile.position.clone().addScaledVector(direction, 0.2),
            direction.clone().multiplyScalar(-2.4).add(new THREE.Vector3(0, 0.25, 0)),
            0xff8a42,
            0.25,
            0.11,
            -0.4,
            2.4,
          );
        }
        if (projectile.life <= 0) this.removeProjectile(index);
        continue;
      }
      const worldHit = this.arena.raycast(projectile.position, direction, distance + 0.12);
      let hit = Boolean(worldHit);
      if (!hit && projectile.owner === 'player' && !this.bot.dead) {
        const botDistance = raySphereDistance(
          projectile.position,
          direction,
          this.bot.getBodyCenter(new THREE.Vector3()),
          0.68,
        );
        hit = botDistance != null && botDistance <= distance + 0.24;
      }
      if (!hit && projectile.owner === 'bot' && !this.player.dead) {
        const playerDistance = raySphereDistance(
          projectile.position,
          direction,
          this.player.position.clone().add(new THREE.Vector3(0, 0.95, 0)),
          0.65,
        );
        hit = playerDistance != null && playerDistance <= distance + 0.24;
      }
      if (hit || projectile.life <= 0) {
        if (worldHit) projectile.position.copy(worldHit.point).addScaledVector(worldHit.normal, 0.08);
        this.explodeProjectile(projectile);
        this.removeProjectile(index);
        continue;
      }
      projectile.position.addScaledVector(projectile.velocity, delta);
      projectile.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        direction,
      );
      for (let trail = 0; trail < 3; trail += 1) {
        this.vfx.addParticle(
          projectile.position
            .clone()
            .addScaledVector(direction, 0.18 + trail * 0.08)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.08,
                (Math.random() - 0.5) * 0.08,
                (Math.random() - 0.5) * 0.08,
              ),
            ),
          direction
            .clone()
            .multiplyScalar(-1.8 - Math.random() * 2)
            .add(new THREE.Vector3(0, 0.25, 0)),
          trail === 0 ? 0xffdc7c : 0xff7538,
          0.18 + Math.random() * 0.18,
          0.09 + Math.random() * 0.06,
          -0.4,
          2.4,
        );
      }
    }
  }

  explodeProjectile(projectile) {
    const position = projectile.position.clone();
    const radius = projectile.definition.splashRadius;
    this.vfx.spawnExplosion(position, radius * 0.88);
    this.audio.explosion(this.getPan(position), 0.9);
    const playerCenter = this.player.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    const playerDistance = playerCenter.distanceTo(position);
    if (projectile.networked) {
      this.player.addShake(clamp(0.65 - playerDistance / 16, 0, 0.65), 0.42);
      this.rendering.setDamage(clamp(0.25 - playerDistance / 35, 0, 0.25));
      this.ui.flash();
      return;
    }
    if (!this.player.dead && playerDistance < radius) {
      const clear = this.arena.hasLineOfSight(
        position.clone().add(new THREE.Vector3(0, 0.15, 0)),
        playerCenter,
        0.18,
      );
      if (clear || playerDistance < 1.6) {
        const falloff = 1 - clamp(playerDistance / radius, 0, 1);
        const ownerScale = projectile.owner === 'player' ? 0.5 : 0.92;
        this.damagePlayer(
          projectile.definition.damage * falloff * ownerScale,
          position,
          false,
        );
        const impulse = playerCenter
          .clone()
          .sub(position)
          .normalize()
          .multiplyScalar(7.5 * falloff);
        impulse.y = Math.max(3.8 * falloff, impulse.y);
        this.player.velocity.add(impulse);
      }
    }
    const botCenter = this.bot.getBodyCenter(new THREE.Vector3());
    const botDistance = botCenter.distanceTo(position);
    if (!this.bot.dead && botDistance < radius) {
      const clear = this.arena.hasLineOfSight(
        position.clone().add(new THREE.Vector3(0, 0.15, 0)),
        botCenter,
        0.18,
      );
      if (clear || botDistance < 1.6) {
        const falloff = 1 - clamp(botDistance / radius, 0, 1);
        const ownerScale = projectile.owner === 'bot' ? 0.5 : 1;
        const appliedDamage = this.bot.damage(
          projectile.definition.damage * falloff * ownerScale,
        );
        const impulse = botCenter
          .clone()
          .sub(position)
          .normalize()
          .multiplyScalar(6 * falloff);
        impulse.y = Math.max(2.5 * falloff, impulse.y);
        this.bot.velocity.add(impulse);
        if (projectile.owner === 'player') {
          this.ui.showHit(false, this.elapsed);
          this.audio.impact(true, false);
          this.vfx.spawnDamageNumber(
            this.bot.getHeadCenter(new THREE.Vector3()).add(new THREE.Vector3(0, 0.28, 0)),
            appliedDamage,
          );
        }
      }
    }
    this.player.addShake(clamp(0.65 - playerDistance / 16, 0, 0.65), 0.42);
    this.rendering.setDamage(clamp(0.25 - playerDistance / 35, 0, 0.25));
    this.ui.flash();
  }

  removeProjectile(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    this.scene.remove(projectile.mesh);
    projectile.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    projectile.bodyMaterial.dispose();
    projectile.glowMaterial?.dispose();
    if (projectile.networkId != null) {
      this.onlineProjectiles.delete(projectile.networkId);
    }
  }

  clearProjectiles() {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      this.removeProjectile(index);
    }
  }

  resolveDeaths() {
    if (this.phase !== 'playing') return;
    if (this.player.dead && this.bot.dead) {
      this.vfx.spawnDeathBurst(this.bot.position.clone(), new THREE.Vector3(0, 0, 1));
      this.endTake('draw');
    } else if (this.bot.dead) {
      const facing = this.player.position.clone().sub(this.bot.position).normalize();
      this.vfx.spawnDeathBurst(this.bot.position.clone(), facing);
      this.player.addShake(0.08, 0.15);
      this.endTake('player');
    } else if (this.player.dead) {
      this.player.viewRoot.visible = false;
      this.endTake('bot');
    }
  }

  spawnPickupBurst(position, color) {
    const center = position.clone().add(new THREE.Vector3(0, 0.8, 0));
    for (let index = 0; index < 18; index += 1) {
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 3.2,
        1.2 + Math.random() * 3,
        (Math.random() - 0.5) * 3.2,
      );
      this.vfx.addParticle(
        center,
        velocity,
        index % 3 === 0 ? 0xffffff : color,
        0.25 + Math.random() * 0.3,
        0.07 + Math.random() * 0.05,
        5,
        1.4,
      );
    }
  }

  getPan(worldPosition) {
    const direction = worldPosition.clone().sub(this.camera.position).normalize();
    this.camera.getWorldDirection(TEMP_DIRECTION);
    TEMP_RIGHT.crossVectors(TEMP_DIRECTION, WORLD_UP).normalize();
    return clamp(direction.dot(TEMP_RIGHT), -0.8, 0.8);
  }

  updateHUD() {
    this.ui.updateHUD(
      {
        playerRounds: this.playerRounds,
        botRounds: this.botRounds,
        playerTakes: this.playerTakes,
        botTakes: this.botTakes,
        roundNumber: this.roundNumber,
        takeTime: this.takeTime,
        overtime: this.overtime,
      },
      this.player,
      this.bot,
      this.arena.map,
      this.lastMovement,
    );
  }

  updateTitle(delta) {
    this.titleTime += delta;
    this.titleMapTimer += delta;
    if (this.mode === 'title' && this.titleAttract.active) {
      this.titleAttract.update(delta, this.camera);
      return;
    }
    const t = this.titleTime;
    const radius = 13.8 + Math.sin(t * 0.17) * 1.2;
    this.camera.position.set(
      Math.sin(t * 0.095) * radius - 0.8,
      3.8 + Math.sin(t * 0.21) * 0.55,
      Math.cos(t * 0.095) * radius - 0.6,
    );
    const target = TEMP_POINT.set(
      Math.sin(t * 0.09) * 1.5,
      1.45 + Math.sin(t * 0.15) * 0.2,
      Math.cos(t * 0.08) * 1.2,
    );
    this.camera.lookAt(target);
    this.camera.rotation.z = Math.sin(t * 0.13) * 0.008;
    this.bot.yaw = 0.7 + Math.sin(t * 0.22) * 0.22;
    this.bot.animate(delta, new THREE.Vector3(), true);
  }

  loop(frameTime) {
    if (!this.running) return;
    const rawDelta = (frameTime - this.lastFrame) / 1000;
    const delta = Math.min(Math.max(rawDelta, 0), 0.05);
    this.lastFrame = frameTime;
    this.elapsed += delta;

    if (this.mode === 'title' || this.mode === 'result') {
      this.updateTitle(delta);
    } else if (this.mode === 'match') {
      this.updateMatch(delta);
    } else if (this.mode === 'paused') {
      this.player.syncCamera(delta);
    }

    if (
      this.mode === 'match' &&
      this.matchType === 'practice'
    ) {
      this.hudAccumulator += delta;
      if (this.hudAccumulator >= 1 / 30) {
        this.hudAccumulator = 0;
        this.updateHUD();
      }
    }

    this.arena.update(this.elapsed, delta, this.camera.position);
    this.pickups.update(this.elapsed, delta);
    this.vfx.update(delta);
    this.ui.update(this.elapsed);
    this.performanceAccumulator += delta;
    if (this.performanceAccumulator >= 1) {
      this.performanceAccumulator = 0;
      const performanceState = this.rendering.getPerformanceState();
      this.vfx.setQuality(performanceState);
      this.vfx.resize(performanceState.pixelRatio);
    }
    this.rendering.setFocus(this.player.focused && this.mode === 'match');
    this.rendering.render(delta, this.elapsed);
    requestAnimationFrame(this.loop);
  }
}

export { WEAPONS };
