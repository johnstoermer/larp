import { randomUUID } from 'node:crypto';
import {
  WAR_CLASSES,
  WAR_CLASS_IDS,
  WAR_COMBATANT_COUNT,
  WAR_MAP,
  WAR_MODES,
  WAR_MODE_CONTROL,
  WAR_MODE_TEAM_DEATHMATCH,
  WAR_RULES,
  WAR_TEAM_COUNT,
  WAR_TEAM_SIZE,
  normalizeWarClass,
  normalizeWarMode,
  warSpawnForSlot,
  warSpawnYaw,
} from '../../shared/warConfig.js';
import { WarControl } from './WarControl.js';
import {
  addScaled,
  directionFromAngles,
  dot,
  isFiniteVector,
  normalize,
  spreadDirections,
} from './geometry.js';
import {
  distanceSquared,
  firstWarWorldHit,
  hasWarLineOfSight,
  moveWarBody,
  traceWarCombatants,
} from './warGeometry.js';
import { createWarBotNavigator } from './warBotNavigation.js';

const MAX_MESSAGES_AHEAD = 2_048;
const MAX_MOVEMENT_CREDIT = 1.35;
const MAX_BOT_CATCHUP_STEPS = 100;
const MAX_HISTORY_MS = 1_100;
const WAR_FLOOR_Y = 0.02;
const WAR_MAX_FOOT_Y = 2.25;
const WAR_MAX_AIRBORNE_MS = 1_700;
const WAR_JUMP_SPEED = 7.55;
const WAR_WALL_JUMP_SPEED = 7.15;
const WAR_GRAVITY = 22.5;
const WAR_WALL_GRAVITY = 5.5;
const WAR_WALL_FALL_SPEED = -1.7;
const WAR_SLIDE_SPEED = 10.25;
const WAR_SLIDE_DURATION_MS = 720;
const WAR_SLIDE_COOLDOWN_MS = 950;
const WAR_WALL_RUN_DURATION_MS = 1_150;
const WAR_WALL_RUN_SPEED = 9.75;
const WAR_FOCUS_SPEED_SCALE = 4.5 / 6.4;
const WAR_FOCUS_SPEED_TOLERANCE = 0.45;
const WAR_KNOCKBACK_DECELERATION = 18;
const WAR_ACCEPTED_MOTION_FRESH_MS = 150;
const WAR_STANDING_EYE_HEIGHT = 1.58;
const WAR_SLIDING_EYE_HEIGHT = 0.92;
const GREAT_SWORD_HALF_ARC = Math.PI * 0.39;
const GREAT_SWORD_MAX_TARGETS = 4;
const BOT_DAMAGE_SCALE_MIN = 0.5;
const BOT_DAMAGE_SCALE_MAX = 0.6;
const BOT_CADENCE_SCALE_MIN = 1.28;
const BOT_CADENCE_SCALE_MAX = 1.72;
const BOT_DODGE_MIN_MS = 1_250;
const BOT_DODGE_VARIANCE_MS = 1_900;
const BOT_DODGE_DURATION_MIN_MS = 360;
const BOT_DODGE_DURATION_VARIANCE_MS = 300;
const BOT_STUCK_REPATH_TICKS = 3;
const BOT_STUCK_JUMP_TICKS = 7;
const BOT_RECOVERY_MIN_MS = 1_100;
const BOT_RECOVERY_REPATH_MS = 450;
const HUMAN_DROP_IN_PROTECTION_MS = 1_800;
const HUMAN_DROP_IN_DAMAGE_SCALE = 0.25;

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const copyVector = (value) => [value[0], value[1], value[2]];

const rounded = (value, precision = 100) =>
  Math.round(value * precision) / precision;

const roundVector = (value, precision = 100) =>
  value.map((component) => rounded(component, precision));

function hashUnit(seed, slot, tick, salt = 0) {
  let value = (
    seed ^
    Math.imul(slot + 1, 0x9e3779b1) ^
    Math.imul(tick + 1, 0x85ebca6b) ^
    Math.imul(salt + 1, 0xc2b2ae35)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

function defaultClassForSlot(teamSlot) {
  return WAR_CLASS_IDS[teamSlot % WAR_CLASS_IDS.length];
}

function hasWarWallContact(position) {
  const origin = [position[0], position[1] + 0.88, position[2]];
  return [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ].some((direction) => firstWarWorldHit(origin, direction, 0.52).hit);
}

function createCombatant(globalSlot, now, seed) {
  const team = Math.floor(globalSlot / WAR_TEAM_SIZE);
  const teamSlot = globalSlot % WAR_TEAM_SIZE;
  const classId = defaultClassForSlot(teamSlot);
  const definition = WAR_CLASSES[classId];
  const spawn = warSpawnForSlot(team, teamSlot);
  return {
    id: globalSlot,
    slot: globalSlot,
    team,
    teamSlot,
    session: null,
    token: null,
    name: `Bot ${teamSlot + 1}`,
    connected: false,
    human: false,
    bot: true,
    reconnectUntil: 0,
    classId,
    pendingClassId: classId,
    weapon: definition.weapon,
    ammo: definition.ammo,
    reserve: definition.reserve,
    reloadEndsAt: Infinity,
    maxHealth: definition.health,
    health: definition.health,
    position: copyVector(spawn),
    velocity: [0, 0, 0],
    yaw: warSpawnYaw(team),
    pitch: 0,
    focused: false,
    grounded: true,
    sliding: false,
    slideInputHeld: false,
    slideEndsAt: 0,
    slideCooldownUntil: 0,
    wallRunning: false,
    wallRunStartedAt: 0,
    acceptedHorizontalSpeed: 0,
    verticalVelocity: 0,
    knockbackVelocity: [0, 0, 0],
    airborneSince: 0,
    rtt: 0,
    history: [{ at: now, position: copyVector(spawn) }],
    dead: false,
    deathAt: Infinity,
    respawnAt: Infinity,
    damageProtectionUntil: 0,
    lastStateAt: now,
    lastPhysicsAt: now,
    movementCredit: MAX_MOVEMENT_CREDIT,
    lastSequence: 0,
    lastShotId: 0,
    lastAttackAt:
      now - hashUnit(seed, teamSlot, 0, 11) * definition.attackMs,
    attackSequence: 1 + Math.floor(hashUnit(seed, teamSlot, 0, 12) * 3),
    botTargetSlot: null,
    botTargetRefreshAt: 0,
    botPath: [],
    botPathIndex: 0,
    botPathGoal: null,
    botStuckTicks: 0,
    botRecoveryUntil: 0,
    botRecoveryRepathAt: 0,
    botLastProgressAt: now,
    botLastProgressPosition: copyVector(spawn),
    botDodgeUntil: 0,
    botNextDodgeAt: now + BOT_DODGE_MIN_MS +
      hashUnit(seed, teamSlot, 0, 13) * BOT_DODGE_VARIANCE_MS,
    botDodgeSign: hashUnit(seed, teamSlot, 0, 14) < 0.5 ? -1 : 1,
    botDodgeCount: 0,
    botJumpCount: 0,
    botCadenceScale: BOT_CADENCE_SCALE_MIN +
      hashUnit(seed, teamSlot, 0, 15) *
        (BOT_CADENCE_SCALE_MAX - BOT_CADENCE_SCALE_MIN),
    botDamageScale: BOT_DAMAGE_SCALE_MIN +
      hashUnit(seed, teamSlot, 0, 16) *
        (BOT_DAMAGE_SCALE_MAX - BOT_DAMAGE_SCALE_MIN),
    botAccuracy: 0.38 + hashUnit(seed, teamSlot, 0, 17) * 0.18,
    botMeleeAccuracy: 0.62 + hashUnit(seed, teamSlot, 0, 18) * 0.12,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageContributors: new Map(),
    ready: true,
  };
}

function sessionEntry(entry) {
  if (entry?.session) {
    return {
      session: entry.session,
      classId: entry.classId,
    };
  }
  return {
    session: entry,
    classId: entry?.warClass,
  };
}

export class WarRoom {
  constructor({
    sessions = [],
    classIds = [],
    rules = {},
    now = Date.now(),
    seed = (Math.floor(Math.random() * 0xffffffff) ^ now) >>> 0,
    teamSideSwap = null,
    warMode = WAR_MODE_CONTROL,
  } = {}) {
    if (!Array.isArray(sessions) || sessions.length > WAR_COMBATANT_COUNT) {
      throw new Error(`A War room accepts at most ${WAR_COMBATANT_COUNT} sessions.`);
    }
    this.id = randomUUID();
    this.mode = 'war';
    this.warMode = normalizeWarMode(warMode);
    this.code = null;
    this.privateMatch = false;
    this.rules = Object.freeze({
      ...WAR_RULES,
      scoreToWin: WAR_MODES[this.warMode].scoreToWin,
      ...rules,
    });
    this.seed = seed >>> 0;
    // The authored north and south approaches are intentionally different.
    // Alternate which logical team receives each physical side so neither team
    // identifier owns the stronger approach across matches.
    this.teamSideSwap = teamSideSwap == null
      ? this.seed & 1
      : Number(Boolean(teamSideSwap));
    this.createdAt = now;
    this.updatedAt = now;
    this.destroyAt = Infinity;
    this.phase = this.warMode === WAR_MODE_CONTROL ? 'locked' : 'combat';
    this.winner = null;
    this.resultReason = null;
    this.matchEndSent = false;
    this.joinSequence = 0;
    this.botTick = 0;
    this.botInterval = 1_000 / this.rules.botTickRate;
    this.nextBotAt = now + this.botInterval;
    this.snapshotInterval = 1_000 / this.rules.snapshotRate;
    this.snapshotAt = now + this.snapshotInterval;
    this.botNavigator = createWarBotNavigator(WAR_MAP);
    this.players = Array.from(
      { length: WAR_COMBATANT_COUNT },
      (_, slot) => createCombatant(slot, now, this.seed),
    );
    this.stageInitialBattle(now);
    this.projectiles = [];
    this.nextProjectileId = 1;
    this.pendingBotDamage = null;
    this.pendingBotAttacks = null;
    this.deferTeamDeathmatchEnd = false;
    this.teamScores = [0, 0];
    this.control = this.warMode === WAR_MODE_CONTROL
      ? new WarControl({ now, rules: this.rules })
      : null;

    sessions.forEach((entry, index) => {
      const normalized = sessionEntry(entry);
      this.addSession(
        normalized.session,
        classIds[index] ?? normalized.classId,
        now,
      );
    });
  }

  battlePocket(pairIndex) {
    const column = pairIndex % 5;
    const row = Math.floor(pairIndex / 5);
    const rowCount = Math.max(1, Math.ceil((WAR_TEAM_SIZE / 2) / 5));
    const separation = 1.05 + hashUnit(this.seed, pairIndex, 0, 35) * 0.52;
    const preferredX = -76 + column * 38 +
      (hashUnit(this.seed, pairIndex, 0, 36) - 0.5) * 15;
    const preferredZ = 15 + (
      rowCount <= 1 ? 0 : row / (rowCount - 1) * 52.5
    ) +
      (hashUnit(this.seed, pairIndex, 0, 37) - 0.5) * 9;
    const candidateIsClear = (x, z) => [
      [x - separation, WAR_FLOOR_Y, z],
      [x + separation, WAR_FLOOR_Y, z],
      [x - separation, WAR_FLOOR_Y, -z],
      [x + separation, WAR_FLOOR_Y, -z],
    ].every((position) => this.botNavigator.pointIsWalkable(position));

    for (let ring = 0; ring <= 24; ring += 1) {
      const offsets = [];
      for (let offsetZ = -ring; offsetZ <= ring; offsetZ += 1) {
        for (let offsetX = -ring; offsetX <= ring; offsetX += 1) {
          if (
            ring > 0 &&
            Math.abs(offsetX) !== ring &&
            Math.abs(offsetZ) !== ring
          ) continue;
          offsets.push([offsetX, offsetZ]);
        }
      }
      offsets.sort((first, second) =>
        Math.hypot(first[0], first[1]) - Math.hypot(second[0], second[1]) ||
        Math.abs(first[1]) - Math.abs(second[1]) ||
        first[0] - second[0] ||
        first[1] - second[1]
      );
      for (const [offsetX, offsetZ] of offsets) {
        const x = preferredX + offsetX * 3.2;
        const z = preferredZ + offsetZ * 3.2;
        if (candidateIsClear(x, z)) return { x, z, separation };
      }
    }
    return { x: preferredX, z: preferredZ, separation };
  }

  stageInitialBattle(now) {
    for (let pairIndex = 0; pairIndex < WAR_TEAM_SIZE / 2; pairIndex += 1) {
      const pocket = this.battlePocket(pairIndex);
      for (let side = 0; side < 2; side += 1) {
        const teamSlot = pairIndex * 2 + side;
        const red = this.players[teamSlot];
        const blue = this.players[WAR_TEAM_SIZE + teamSlot];
        const redPosition = [
          pocket.x + (side ? pocket.separation : -pocket.separation),
          WAR_FLOOR_Y,
          side ? -pocket.z : pocket.z,
        ];
        const mirroredPosition = [
          redPosition[0],
          WAR_FLOOR_Y,
          -redPosition[2],
        ];
        red.position = this.teamSideSwap ? mirroredPosition : redPosition;
        blue.position = this.teamSideSwap ? redPosition : mirroredPosition;
        red.botTargetSlot = WAR_TEAM_SIZE + (teamSlot ^ 1);
        blue.botTargetSlot = teamSlot ^ 1;

        const healthRoll = hashUnit(this.seed, teamSlot, 0, 40);
        const healthRatio = healthRoll < 0.68
          ? 0.72 + healthRoll / 0.68 * 0.28
          : 1;
        const airborne = hashUnit(this.seed, teamSlot, 0, 41) < 0.34;
        const footY = airborne
          ? 0.28 + hashUnit(this.seed, teamSlot, 0, 42) * 0.72
          : WAR_FLOOR_Y;
        const verticalVelocity = airborne
          ? 2.4 + hashUnit(this.seed, teamSlot, 0, 43) * 3.8
          : 0;
        for (const player of [red, blue]) {
          player.health = Math.max(1, player.maxHealth * healthRatio);
          player.position[1] = footY;
          player.grounded = !airborne;
          player.verticalVelocity = verticalVelocity;
          player.airborneSince = airborne ? now - 120 : 0;
          player.botJumpCount = airborne ? 1 : 0;
          player.botLastProgressPosition = copyVector(player.position);
          player.botLastProgressAt = now;
          player.botNextDodgeAt = now +
            hashUnit(this.seed, teamSlot, 0, 44) * 900;
          player.lastAttackAt = now -
            WAR_CLASSES[player.classId].attackMs * player.botCadenceScale *
              hashUnit(this.seed, teamSlot, 0, 45);
        }
      }
    }

    for (const player of this.players) {
      const target = this.players[player.botTargetSlot];
      const offsetX = target.position[0] - player.position[0];
      const offsetZ = target.position[2] - player.position[2];
      const distance = Math.max(0.001, Math.hypot(offsetX, offsetZ));
      const strafeSign = player.botDodgeSign *
        ((player.team ^ this.teamSideSwap) === 0 ? 1 : -1);
      const strafeSpeed = 1.8 + hashUnit(this.seed, player.teamSlot, 0, 46) * 2.2;
      player.velocity = [
        (-offsetZ / distance) * strafeSign * strafeSpeed,
        player.verticalVelocity,
        (offsetX / distance) * strafeSign * strafeSpeed,
      ];
      player.yaw = Math.atan2(-offsetX, -offsetZ);
      if (hashUnit(this.seed, player.teamSlot, 0, 47) < 0.42) {
        player.botDodgeUntil = now + 280 +
          hashUnit(this.seed, player.teamSlot, 0, 48) * 360;
        player.botDodgeCount = 1;
      }
      player.history = [{ at: now, position: copyVector(player.position) }];
    }
  }

  connectedHumans() {
    return this.players.filter((player) => player.human && player.connected);
  }

  reservedHumanCounts(now = Date.now()) {
    const counts = [0, 0];
    for (const player of this.players) {
      if (player.human || (player.token && player.reconnectUntil > now)) {
        counts[player.team] += 1;
      }
    }
    return counts;
  }

  clearExpiredReservations(now) {
    for (const player of this.players) {
      if (!player.bot || !player.token || player.reconnectUntil > now) continue;
      if (player.session?.room === this) {
        player.session.room = null;
        player.session.slot = null;
        player.session.team = null;
      }
      player.session = null;
      player.token = null;
      player.reconnectUntil = 0;
      player.name = `Bot ${player.teamSlot + 1}`;
      this.setClass(player, defaultClassForSlot(player.teamSlot), false);
    }
  }

  eligibleBotForTeam(team, now) {
    this.clearExpiredReservations(now);
    const eligible = this.players.filter(
      (player) => player.team === team && player.bot && !player.token,
    );
    return eligible.find((player) => !player.dead) ?? eligible[0] ?? null;
  }

  canJoin(now = Date.now()) {
    if (this.phase === 'result') return false;
    this.clearExpiredReservations(now);
    return this.players.some((player) => player.bot && !player.token);
  }

  chooseJoinTeam(now) {
    const counts = this.reservedHumanCounts(now);
    const first = counts[0] === counts[1]
      ? this.joinSequence % WAR_TEAM_COUNT
      : counts[0] < counts[1] ? 0 : 1;
    if (this.eligibleBotForTeam(first, now)) return first;
    return 1 - first;
  }

  resetCombatantIdentity(player) {
    player.kills = 0;
    player.deaths = 0;
    player.assists = 0;
    player.rtt = 0;
    player.focused = false;
    player.damageContributors.clear();
    for (const target of this.players) {
      target.damageContributors.delete(player.slot);
    }
    this.projectiles = this.projectiles.filter(
      (projectile) => projectile.owner !== player.slot,
    );
  }

  addSession(session, requestedClass, now = Date.now()) {
    if (!session || this.phase === 'result') return null;
    const existing = this.playerForSession(session);
    if (existing) return this.reconnect(session, now) ? existing : null;
    const team = this.chooseJoinTeam(now);
    const player = this.eligibleBotForTeam(team, now);
    if (!player) return null;

    // Scoreboard stats and assist credit belong to the identity controlling a
    // slot, not to the replaceable bot body. Same-token reconnects return via
    // the existing-player branch above and intentionally retain this state.
    this.resetCombatantIdentity(player);
    player.session = session;
    player.token = session.token ?? null;
    player.name = String(session.name ?? 'Player').slice(0, 18);
    player.connected = true;
    player.human = true;
    player.bot = false;
    player.reconnectUntil = 0;
    player.lastSequence = 0;
    player.lastShotId = 0;
    this.setClass(player, normalizeWarClass(requestedClass), false);
    if (player.dead) {
      this.respawn(player, now, false);
      player.damageProtectionUntil = now + HUMAN_DROP_IN_PROTECTION_MS;
    } else {
      // A joining human takes over the living bot's active skirmish position
      // instead of materializing back on an empty deployment line. Reset only
      // transient bot/physics state so the first frame opens inside the battle.
      player.position[1] = WAR_FLOOR_Y;
      player.velocity = [0, 0, 0];
      player.knockbackVelocity = [0, 0, 0];
      player.verticalVelocity = 0;
      player.grounded = true;
      player.airborneSince = 0;
      player.sliding = false;
      player.slideInputHeld = false;
      player.slideEndsAt = 0;
      player.slideCooldownUntil = 0;
      player.wallRunning = false;
      player.wallRunStartedAt = 0;
      player.acceptedHorizontalSpeed = 0;
      player.lastStateAt = now;
      player.lastPhysicsAt = now;
      player.movementCredit = MAX_MOVEMENT_CREDIT;
      player.history = [{ at: now, position: copyVector(player.position) }];
      player.lastAttackAt = now;
      player.botPath = [];
      player.botPathIndex = 0;
      player.botPathGoal = null;
      player.botStuckTicks = 0;
      player.botDodgeUntil = 0;
      player.damageProtectionUntil = now + HUMAN_DROP_IN_PROTECTION_MS;
    }
    session.room = this;
    session.slot = player.slot;
    session.team = player.team;
    this.destroyAt = Infinity;
    this.joinSequence += 1;
    this.sendFound(player, false, now);
    this.broadcast({
      type: 'war_event',
      event: 'player_joined',
      player: player.slot,
      team: player.team,
      name: player.name,
    }, player, { volatile: true });
    return player;
  }

  join(session, classId, now = Date.now()) {
    return this.addSession(session, classId, now);
  }

  playerForSession(session) {
    if (!session) return null;
    return this.players.find((player) =>
      player.session === session ||
      (session.token && player.token === session.token)
    ) ?? null;
  }

  setClass(player, requestedClass, preserveHealth = true) {
    const classId = normalizeWarClass(requestedClass);
    const previousMax = player.maxHealth || WAR_CLASSES[classId].health;
    const healthRatio = preserveHealth ? player.health / previousMax : 1;
    const definition = WAR_CLASSES[classId];
    player.classId = classId;
    player.pendingClassId = classId;
    player.weapon = definition.weapon;
    player.ammo = definition.ammo;
    player.reserve = definition.reserve;
    player.reloadEndsAt = Infinity;
    player.maxHealth = definition.health;
    player.health = player.dead
      ? 0
      : clamp(definition.health * healthRatio, 1, definition.health);
    if (!preserveHealth) player.damageContributors?.clear();
  }

  handleSelectClass(session, message, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || !player.human || !player.connected) return false;
    const classId = normalizeWarClass(message?.classId ?? message);
    player.pendingClassId = classId;
    if (player.dead) {
      this.send(player, {
        type: 'war_event',
        event: 'class_selected',
        classId,
        appliesOnRespawn: true,
        respawnRemaining: Math.max(0, player.respawnAt - now),
      });
    }
    return true;
  }

  handleClass(session, message, now = Date.now()) {
    return this.handleSelectClass(session, message, now);
  }

  send(player, payload) {
    if (!player?.connected || !player.session) return false;
    return player.session.send?.(payload) ?? false;
  }

  broadcast(payload, except = null, options = undefined) {
    const encoded = JSON.stringify(payload);
    for (const player of this.players) {
      if (!player.human || !player.connected || player === except) continue;
      if (player.session?.sendEncoded) player.session.sendEncoded(encoded, options);
      else player.session?.send?.(payload);
    }
  }

  sendFound(player, resumed, now) {
    this.send(player, {
      type: 'war_found',
      roomId: this.id,
      mode: this.mode,
      warMode: this.warMode,
      slot: player.slot,
      team: player.team,
      teamSlot: player.teamSlot,
      classId: player.classId,
      seed: this.seed,
      mapId: WAR_MAP.id,
      resumed,
      rules: {
        teamSize: WAR_TEAM_SIZE,
        unlockMs: this.rules.unlockMs,
        captureMs: this.rules.captureMs,
        scoreToWin: this.rules.scoreToWin,
        respawnMs: this.rules.respawnMs,
        assistWindowMs: this.rules.assistWindowMs,
      },
      snapshot: this.snapshot(now),
    });
  }

  handleReady() {
    // War starts immediately; bots already fill all unoccupied team slots.
  }

  handlePickup() {
    // War loadouts are selected before spawning and there are no field pickups.
  }

  handleReload(session, now = Date.now()) {
    const player = this.playerForSession(session);
    return this.startReload(player, now);
  }

  handleDiscard() {
    // A War class keeps its selected loadout until the next class selection.
  }

  requestRematch() {
    // A completed War room is replaced instead of resetting its stable slots.
  }

  integrateKnockback(player, deltaSeconds) {
    const velocity = Array.isArray(player.knockbackVelocity)
      ? player.knockbackVelocity
      : [0, 0, 0];
    const speed = Math.hypot(Number(velocity[0]) || 0, Number(velocity[2]) || 0);
    if (speed <= 0.001) {
      player.knockbackVelocity = [0, 0, 0];
      return 0;
    }
    if (deltaSeconds <= 0) return 0;
    const before = copyVector(player.position);
    player.position = moveWarBody(player.position, [
      player.position[0] + velocity[0] * deltaSeconds,
      player.position[1],
      player.position[2] + velocity[2] * deltaSeconds,
    ]);
    const nextSpeed = Math.max(
      0,
      speed - WAR_KNOCKBACK_DECELERATION * deltaSeconds,
    );
    const scale = nextSpeed / speed;
    player.knockbackVelocity = [
      velocity[0] * scale,
      0,
      velocity[2] * scale,
    ];
    return Math.hypot(
      player.position[0] - before[0],
      player.position[2] - before[2],
    );
  }

  integrateVerticalMotion(player, deltaSeconds, now, {
    jumpRequested = false,
    wallJumpRequested = false,
    wallRunning = false,
  } = {}) {
    const currentY = player.position[1];
    const wasGrounded = currentY <= WAR_FLOOR_Y + 0.04;
    let verticalVelocity = Number(player.verticalVelocity) || 0;
    if (wasGrounded) {
      player.position[1] = WAR_FLOOR_Y;
      if (verticalVelocity <= 0) verticalVelocity = 0;
      if (jumpRequested && verticalVelocity <= 0.05) {
        verticalVelocity = WAR_JUMP_SPEED;
      }
    }
    if (wallJumpRequested) {
      verticalVelocity = Math.max(verticalVelocity, WAR_WALL_JUMP_SPEED);
      wallRunning = false;
      player.wallRunStartedAt = now - WAR_WALL_RUN_DURATION_MS;
    }

    const airborne = !wasGrounded || verticalVelocity > 0.05;
    if (!airborne || deltaSeconds <= 0) {
      player.verticalVelocity = airborne ? verticalVelocity : 0;
      player.grounded = !airborne;
      if (!airborne) player.airborneSince = 0;
      return wallRunning && airborne;
    }
    if (!player.airborneSince) player.airborneSince = now;
    const verticalVelocityBeforeGravity = verticalVelocity;
    verticalVelocity = wallRunning
      ? Math.max(
        WAR_WALL_FALL_SPEED,
        verticalVelocity - WAR_WALL_GRAVITY * deltaSeconds,
      )
      : verticalVelocity - WAR_GRAVITY * deltaSeconds;
    if (now - player.airborneSince > WAR_MAX_AIRBORNE_MS) {
      verticalVelocity = Math.min(verticalVelocity, -8);
    }

    const beforeY = player.position[1];
    const targetY = clamp(
      beforeY + (
        verticalVelocityBeforeGravity + verticalVelocity
      ) * 0.5 * deltaSeconds,
      WAR_FLOOR_Y,
      WAR_MAX_FOOT_Y,
    );
    player.position = moveWarBody(player.position, [
      player.position[0],
      targetY,
      player.position[2],
    ]);
    const verticalTravel = player.position[1] - beforeY;
    if (verticalVelocity > 0 && verticalTravel <= 0.001) verticalVelocity = 0;
    if (player.position[1] <= WAR_FLOOR_Y + 0.04) {
      player.position[1] = WAR_FLOOR_Y;
      player.verticalVelocity = 0;
      player.grounded = true;
      player.airborneSince = 0;
      return false;
    }
    player.verticalVelocity = verticalVelocity;
    player.grounded = false;
    return wallRunning;
  }

  advancePassiveMotion(player, now) {
    if (!player || player.dead) return false;
    const physicsAt = Number.isFinite(player.lastPhysicsAt)
      ? player.lastPhysicsAt
      : Number(player.lastStateAt) || now;
    if (now <= physicsAt) return false;
    const deltaSeconds = clamp((now - physicsAt) / 1_000, 0, 0.25);
    const before = copyVector(player.position);
    const knockbackBefore = player.knockbackVelocity ?? [0, 0, 0];
    const acceptedMotionFresh = now - player.lastStateAt <=
      WAR_ACCEPTED_MOTION_FRESH_MS;
    const voluntaryVelocityX = acceptedMotionFresh
      ? (Number(player.velocity[0]) || 0) - (Number(knockbackBefore[0]) || 0)
      : 0;
    const voluntaryVelocityZ = acceptedMotionFresh
      ? (Number(player.velocity[2]) || 0) - (Number(knockbackBefore[2]) || 0)
      : 0;

    this.integrateKnockback(player, deltaSeconds);
    let wallRunning = Boolean(
      player.wallRunning &&
      !player.grounded &&
      player.wallRunStartedAt &&
      now - player.wallRunStartedAt <= WAR_WALL_RUN_DURATION_MS &&
      hasWarWallContact(player.position),
    );
    wallRunning = this.integrateVerticalMotion(player, deltaSeconds, now, {
      wallRunning,
    });
    player.lastPhysicsAt = now;
    if (!acceptedMotionFresh) player.acceptedHorizontalSpeed = 0;

    const knockback = player.knockbackVelocity ?? [0, 0, 0];
    player.velocity = [
      voluntaryVelocityX + knockback[0],
      player.verticalVelocity,
      voluntaryVelocityZ + knockback[2],
    ];
    if (now > player.slideEndsAt) player.sliding = false;
    if (player.grounded) {
      player.wallRunStartedAt = 0;
      player.wallRunning = false;
    } else {
      player.sliding = false;
      player.wallRunning = wallRunning && hasWarWallContact(player.position);
    }
    if (
      !player.grounded ||
      Math.hypot(knockback[0], knockback[2]) > 0.1
    ) {
      player.focused = false;
    }

    const moved = distanceSquared(before, player.position) > 0.000001;
    if (moved) this.recordHistory(player, now);
    return moved;
  }

  handleState(session, message, now = Date.now()) {
    const player = this.playerForSession(session);
    if (
      !player ||
      !player.human ||
      !player.connected ||
      player.dead ||
      this.phase === 'result' ||
      !isFiniteVector(message?.position)
    ) {
      return false;
    }
    const sequence = Number(message.sequence);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= player.lastSequence ||
      sequence > player.lastSequence + MAX_MESSAGES_AHEAD
    ) {
      return false;
    }

    const definition = WAR_CLASSES[player.classId];
    const requested = copyVector(message.position);
    const deltaSeconds = clamp((now - player.lastStateAt) / 1_000, 0, 0.25);
    const physicsAt = Number.isFinite(player.lastPhysicsAt)
      ? player.lastPhysicsAt
      : player.lastStateAt;
    const physicsDeltaSeconds = clamp((now - physicsAt) / 1_000, 0, 0.25);
    const acceptedSpeedBeforeState = Math.max(
      0,
      Number(player.acceptedHorizontalSpeed) || 0,
    );
    const acceptedMotionFresh = now - player.lastStateAt <=
      WAR_ACCEPTED_MOTION_FRESH_MS;
    const wasGrounded = Boolean(
      player.grounded && player.position[1] <= WAR_FLOOR_Y + 0.04,
    );
    const wasWallRunning = Boolean(player.wallRunning && !wasGrounded);
    const requestedVelocityY = isFiniteVector(message.velocity)
      ? clamp(message.velocity[1], -12, 12)
      : 0;
    const wantsSliding = Boolean(message.sliding);
    if (
      wantsSliding &&
      !player.slideInputHeld &&
      wasGrounded &&
      acceptedMotionFresh &&
      acceptedSpeedBeforeState > 5.4 &&
      now >= player.slideCooldownUntil
    ) {
      player.slideEndsAt = now + WAR_SLIDE_DURATION_MS;
      player.slideCooldownUntil = now + WAR_SLIDE_COOLDOWN_MS;
    }
    const sliding = wantsSliding &&
      wasGrounded &&
      now <= player.slideEndsAt;
    player.slideInputHeld = wantsSliding;
    const wantsWallRunning = Boolean(message.wallRunning);
    let wallRunning = false;
    if (wasGrounded) {
      player.wallRunStartedAt = 0;
    } else if (
      wantsWallRunning &&
      acceptedMotionFresh &&
      acceptedSpeedBeforeState > 5.2 &&
      hasWarWallContact(player.position)
    ) {
      if (!player.wallRunStartedAt) player.wallRunStartedAt = now;
      wallRunning = now - player.wallRunStartedAt <= WAR_WALL_RUN_DURATION_MS;
    }
    const movementSpeed = Math.max(
      definition.speed * 1.35,
      sliding ? WAR_SLIDE_SPEED : 0,
      wallRunning ? WAR_WALL_RUN_SPEED : 0,
    );
    player.movementCredit = Math.min(
      MAX_MOVEMENT_CREDIT,
      player.movementCredit + movementSpeed * deltaSeconds,
    );

    const knockbackBeforeState = player.knockbackVelocity ?? [0, 0, 0];
    const suppressVoluntaryMovement =
      Math.hypot(knockbackBeforeState[0], knockbackBeforeState[2]) > 0.1;
    this.integrateKnockback(player, physicsDeltaSeconds);
    const jumpRequested = wasGrounded &&
      requested[1] > WAR_FLOOR_Y + 0.04 &&
      requestedVelocityY > 2.5;
    const wallJumpRequested = wasWallRunning &&
      requestedVelocityY > Math.max(
        4.5,
        (Number(player.verticalVelocity) || 0) + 2,
      );
    wallRunning = this.integrateVerticalMotion(player, physicsDeltaSeconds, now, {
      jumpRequested,
      wallJumpRequested,
      wallRunning,
    });
    player.lastPhysicsAt = Math.max(physicsAt, now);

    const movementOrigin = copyVector(player.position);
    const requestedHorizontalDistance = Math.hypot(
      requested[0] - movementOrigin[0],
      requested[2] - movementOrigin[2],
    );
    let acceptedDistance = 0;
    if (
      !suppressVoluntaryMovement &&
      requestedHorizontalDistance <= player.movementCredit
    ) {
      const accepted = moveWarBody(player.position, [
        requested[0],
        player.position[1],
        requested[2],
      ]);
      acceptedDistance = Math.hypot(
        accepted[0] - movementOrigin[0],
        accepted[2] - movementOrigin[2],
      );
      player.position = accepted;
      player.movementCredit = Math.max(0, player.movementCredit - acceptedDistance);
    }
    player.acceptedHorizontalSpeed = deltaSeconds > 0
      ? clamp(acceptedDistance / deltaSeconds, 0, movementSpeed)
      : 0;
    const acceptedVelocityX = deltaSeconds > 0
      ? (player.position[0] - movementOrigin[0]) / deltaSeconds
      : 0;
    const acceptedVelocityZ = deltaSeconds > 0
      ? (player.position[2] - movementOrigin[2]) / deltaSeconds
      : 0;
    const knockbackVelocity = player.knockbackVelocity ?? [0, 0, 0];
    player.velocity = [
      acceptedVelocityX + knockbackVelocity[0],
      player.verticalVelocity,
      acceptedVelocityZ + knockbackVelocity[2],
    ];
    if (Number.isFinite(message.yaw)) player.yaw = clamp(message.yaw, -Math.PI * 32, Math.PI * 32);
    if (Number.isFinite(message.pitch)) player.pitch = clamp(message.pitch, -1.5, 1.5);
    const focusedSpeed = Math.max(
      player.acceptedHorizontalSpeed,
      Math.hypot(knockbackVelocity[0], knockbackVelocity[2]),
    );
    player.focused = Boolean(message.focused) &&
      player.grounded &&
      !sliding &&
      !wallRunning &&
      focusedSpeed <= definition.speed * WAR_FOCUS_SPEED_SCALE +
        WAR_FOCUS_SPEED_TOLERANCE;
    player.sliding = sliding && player.grounded;
    if (player.grounded) {
      player.wallRunStartedAt = 0;
      player.wallRunning = false;
    } else {
      player.wallRunning = wallRunning && hasWarWallContact(player.position);
    }
    player.rtt = clamp(Number(session.measuredRtt) || 0, 0, 800);
    player.lastSequence = sequence;
    player.lastStateAt = now;
    this.recordHistory(player, now);
    return true;
  }

  recordHistory(player, now) {
    const sample = { at: now, position: copyVector(player.position) };
    const latest = player.history[player.history.length - 1];
    if (latest?.at === now) player.history[player.history.length - 1] = sample;
    else player.history.push(sample);
    while (
      player.history.length > 2 &&
      player.history[0].at < now - MAX_HISTORY_MS
    ) {
      player.history.shift();
    }
  }

  rewindPosition(player, targetTime) {
    if (!player.history.length) return copyVector(player.position);
    if (targetTime >= player.history[player.history.length - 1].at) {
      return copyVector(player.position);
    }
    if (targetTime <= player.history[0].at) {
      return copyVector(player.history[0].position);
    }
    let before = player.history[0];
    let after = player.history[player.history.length - 1];
    for (let index = 1; index < player.history.length; index += 1) {
      if (player.history[index].at >= targetTime) {
        before = player.history[index - 1];
        after = player.history[index];
        break;
      }
    }
    const duration = Math.max(1, after.at - before.at);
    const amount = clamp((targetTime - before.at) / duration, 0, 1);
    return [
      before.position[0] + (after.position[0] - before.position[0]) * amount,
      before.position[1] + (after.position[1] - before.position[1]) * amount,
      before.position[2] + (after.position[2] - before.position[2]) * amount,
    ];
  }

  handleShot(session, message, now = Date.now()) {
    const shooter = this.playerForSession(session);
    if (
      !shooter ||
      !shooter.human ||
      !shooter.connected ||
      shooter.dead ||
      this.phase === 'result'
    ) {
      return false;
    }
    const definition = WAR_CLASSES[shooter.classId];
    this.finishReload(shooter, now);
    if (shooter.reloadEndsAt !== Infinity) return false;
    if (definition.usesAmmo && shooter.ammo <= 0) {
      this.startReload(shooter, now);
      return false;
    }
    if (now - shooter.lastAttackAt < definition.attackMs) return false;
    const shotId = Number(message?.shotId);
    if (
      !Number.isSafeInteger(shotId) ||
      shotId <= shooter.lastShotId ||
      shotId > shooter.lastShotId + MAX_MESSAGES_AHEAD
    ) {
      return false;
    }
    if (!isFiniteVector(message?.direction)) return false;
    const direction = normalize(message.direction);
    if (!direction) return false;
    const yaw = Number.isFinite(message.yaw) ? message.yaw : shooter.yaw;
    const pitch = Number.isFinite(message.pitch) ? message.pitch : shooter.pitch;
    if (dot(direction, directionFromAngles(yaw, pitch)) < 0.985) return false;

    shooter.yaw = clamp(yaw, -Math.PI * 32, Math.PI * 32);
    shooter.pitch = clamp(pitch, -1.5, 1.5);
    shooter.lastShotId = shotId;
    shooter.lastAttackAt = now;
    shooter.attackSequence += 1;
    if (definition.usesAmmo) shooter.ammo = Math.max(0, shooter.ammo - 1);
    const result = shooter.classId === 'greatsword'
      ? this.performGreatswordAttack(shooter, direction, now)
      : this.performRangedAttack(shooter, direction, now, shotId);
    this.broadcast({
      type: 'war_event',
      event: 'attack',
      shooter: shooter.slot,
      shotId,
      classId: shooter.classId,
      attackSequence: shooter.attackSequence,
      ...result,
    }, null, { volatile: true });
    return true;
  }

  startReload(player, now = Date.now()) {
    if (!player || player.dead) return false;
    const definition = WAR_CLASSES[player.classId];
    if (
      !definition.usesAmmo ||
      definition.reloadMs <= 0 ||
      player.reloadEndsAt !== Infinity ||
      player.ammo >= definition.ammo ||
      player.reserve <= 0
    ) {
      return false;
    }
    player.reloadEndsAt = now + definition.reloadMs;
    return true;
  }

  finishReload(player, now = Date.now()) {
    if (!player || player.reloadEndsAt === Infinity || now < player.reloadEndsAt) {
      return false;
    }
    const definition = WAR_CLASSES[player.classId];
    const transfer = Math.min(
      Math.max(0, definition.ammo - player.ammo),
      Math.max(0, player.reserve),
    );
    player.ammo += transfer;
    player.reserve -= transfer;
    player.reloadEndsAt = Infinity;
    return transfer > 0;
  }

  performRangedAttack(
    shooter,
    direction,
    now,
    attackId = shooter.attackSequence,
    damageScale = 1,
  ) {
    const definition = WAR_CLASSES[shooter.classId];
    const origin = [
      shooter.position[0],
      shooter.position[1] + (
        shooter.sliding ? WAR_SLIDING_EYE_HEIGHT : WAR_STANDING_EYE_HEIGHT
      ),
      shooter.position[2],
    ];
    if (definition.projectile) {
      const projectile = {
        id: this.nextProjectileId++,
        owner: shooter.slot,
        team: shooter.team,
        classId: shooter.classId,
        position: copyVector(origin),
        velocity: direction.map((component) =>
          component * definition.projectileSpeed),
        remaining: definition.range,
        updatedAt: now,
        damageScale,
      };
      this.projectiles.push(projectile);
      return {
        origin: roundVector(origin),
        direction: roundVector(direction, 1_000),
        hitPoint: null,
        hit: false,
        projectile: this.projectileSnapshot(projectile),
      };
    }
    const rewoundTargets = shooter.human && shooter.rtt > 0
      ? this.players.filter((target) => target.team !== shooter.team && !target.dead)
      : [];
    const rewindAt = now - clamp(shooter.rtt * 0.5, 0, 200);
    for (const target of rewoundTargets) {
      target.rewoundPosition = this.rewindPosition(target, rewindAt);
    }
    const spread = shooter.focused
      ? definition.focusSpread
      : definition.spread * (
        1 + clamp(Math.hypot(shooter.velocity[0], shooter.velocity[2]) / 12, 0, 0.3)
      ) * (shooter.grounded ? 1 : 1.42);
    const spreadSlot = shooter.bot ? shooter.teamSlot : shooter.slot;
    const seed = (
      this.seed ^
      Math.imul(spreadSlot + 3, 7_919) ^
      Math.imul(Number(attackId) || 0, 2_654_435_761)
    ) >>> 0;
    const traces = spreadDirections(
      direction,
      Number(spread) || 0,
      Number(definition.pellets) || 1,
      seed,
    );
    const pendingHits = new Map();
    const tracePoints = [];
    let closestTrace = null;
    try {
      for (const pelletDirection of traces) {
        const trace = traceWarCombatants({
          origin,
          direction: pelletDirection,
          range: definition.range,
          team: shooter.team,
          combatants: this.players,
        });
        tracePoints.push(roundVector(trace.point));
        if (!trace.target) continue;
        const falloff = shooter.classId === 'ember'
          ? clamp(1.15 - trace.distance / 38, 0.32, 1)
          : 1;
        const pelletDamage = definition.damage * damageScale * falloff * (
          trace.headshot ? definition.headMultiplier : 1
        );
        const entry = pendingHits.get(trace.target) ?? {
          target: trace.target,
          damage: 0,
          hitCount: 0,
          headshot: false,
          closest: trace,
        };
        entry.damage += pelletDamage;
        entry.hitCount += 1;
        entry.headshot ||= trace.headshot;
        if (trace.distance < entry.closest.distance) entry.closest = trace;
        pendingHits.set(trace.target, entry);
        if (!closestTrace || trace.distance < closestTrace.distance) closestTrace = trace;
      }
    } finally {
      for (const target of rewoundTargets) delete target.rewoundPosition;
    }
    const hits = [];
    for (const entry of pendingHits.values()) {
      const damage = this.applyDamage(entry.target, entry.damage, shooter, now);
      if (damage <= 0) continue;
      hits.push({
        target: entry.target.slot,
        damage: rounded(damage, 10),
        health: rounded(entry.target.health, 10),
        hitCount: entry.hitCount,
        headshot: entry.headshot,
      });
    }
    const totalDamage = hits.reduce((total, hit) => total + hit.damage, 0);
    const primaryHit = closestTrace
      ? hits.find((hit) => hit.target === closestTrace.target.slot) ?? null
      : null;
    return {
      origin: roundVector(origin),
      direction: roundVector(direction, 1_000),
      traces: tracePoints,
      hitPoint: closestTrace
        ? roundVector(closestTrace.point)
        : tracePoints[0] ?? roundVector(origin),
      hit: hits.length > 0,
      hitCount: hits.reduce((total, hit) => total + hit.hitCount, 0),
      headshot: hits.some((hit) => hit.headshot),
      hits,
      target: primaryHit?.target ?? null,
      damage: rounded(totalDamage, 10),
      targetHealth: primaryHit?.health ?? null,
    };
  }

  projectileSnapshot(projectile) {
    return {
      id: projectile.id,
      owner: projectile.owner,
      team: projectile.team,
      classId: projectile.classId,
      position: roundVector(projectile.position),
      velocity: roundVector(projectile.velocity),
    };
  }

  updateProjectiles(now) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      const definition = WAR_CLASSES[projectile.classId];
      const deltaSeconds = clamp((now - projectile.updatedAt) / 1_000, 0, 0.2);
      projectile.updatedAt = now;
      const speed = Math.hypot(...projectile.velocity);
      if (speed <= 0.001 || projectile.remaining <= 0) {
        this.explodeWarProjectile(index, projectile.position, now);
        continue;
      }
      const direction = projectile.velocity.map((component) => component / speed);
      const step = Math.min(projectile.remaining, speed * deltaSeconds);
      const world = firstWarWorldHit(projectile.position, direction, step);
      const trace = traceWarCombatants({
        origin: projectile.position,
        direction,
        range: step,
        team: projectile.team,
        combatants: this.players,
      });
      if (trace.target || world.hit) {
        const point = trace.target && trace.distance <= world.distance
          ? trace.point
          : world.point;
        this.explodeWarProjectile(index, point, now);
        continue;
      }
      projectile.position = trace.point;
      projectile.remaining -= step;
    }
  }

  explodeWarProjectile(index, position, now) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (!projectile) return;
    const definition = WAR_CLASSES[projectile.classId];
    const damage = [];
    for (const target of this.players) {
      if (target.dead) continue;
      if (target.team === projectile.team && target.slot !== projectile.owner) continue;
      if (target.human && target.connected) this.advancePassiveMotion(target, now);
      const center = [target.position[0], target.position[1] + 0.9, target.position[2]];
      const distance = Math.sqrt(distanceSquared(position, center));
      if (distance >= definition.splashRadius) continue;
      const direction = normalize([
        center[0] - position[0],
        center[1] - position[1],
        center[2] - position[2],
      ]) ?? [0, 1, 0];
      const world = firstWarWorldHit(
        addScaled(position, direction, 0.15),
        direction,
        distance,
      );
      if (world.hit && world.distance < distance - 0.22 && distance >= 1.6) continue;
      const falloff = 1 - distance / definition.splashRadius;
      const ownerScale = target.slot === projectile.owner ? 0.5 : 1;
      const applied = this.applyDamage(
        target,
        definition.damage * (projectile.damageScale ?? 1) * falloff * ownerScale,
        this.players[projectile.owner],
        now,
      );
      if (applied <= 0) continue;
      const impulse = direction.map((component) => component * 7.5 * falloff);
      impulse[1] = Math.max(3.8 * falloff, impulse[1]);
      if (!target.dead) {
        const knockback = target.knockbackVelocity ?? [0, 0, 0];
        target.knockbackVelocity = [
          knockback[0] + impulse[0],
          0,
          knockback[2] + impulse[2],
        ];
        target.verticalVelocity = clamp(
          (Number(target.verticalVelocity) || 0) + impulse[1],
          -12,
          12,
        );
        target.velocity = [
          target.velocity[0] + impulse[0],
          target.verticalVelocity,
          target.velocity[2] + impulse[2],
        ];
        target.focused = false;
      }
      damage.push({
        player: target.slot,
        amount: rounded(applied, 10),
        health: rounded(target.health, 10),
        impulse: roundVector(impulse),
      });
    }
    for (const entry of damage) {
      const target = this.players[entry.player];
      if (!target?.human || !target.connected) continue;
      this.send(target, {
        type: 'war_event',
        event: 'impulse',
        projectileId: projectile.id,
        player: target.slot,
        impulse: entry.impulse,
      });
    }
    this.broadcast({
      type: 'war_event',
      event: 'projectile_explode',
      projectileId: projectile.id,
      owner: projectile.owner,
      position: roundVector(position),
      radius: definition.splashRadius,
      damage: damage.map(({ impulse: _impulse, ...entry }) => entry),
    }, null, { volatile: true });
  }

  performGreatswordAttack(shooter, direction, now, damageScale = 1) {
    const definition = WAR_CLASSES.greatsword;
    const forward = normalize([direction[0], 0, direction[2]]) ?? [0, 0, -1];
    const maximumDistanceSquared = definition.range * definition.range;
    const candidates = [];
    for (const target of this.players) {
      if (target.team === shooter.team || target.dead) continue;
      const offset = [
        target.position[0] - shooter.position[0],
        0,
        target.position[2] - shooter.position[2],
      ];
      const squared = offset[0] * offset[0] + offset[2] * offset[2];
      if (squared > maximumDistanceSquared || squared < 0.0001) continue;
      const targetDirection = normalize(offset);
      if (!targetDirection || dot(forward, targetDirection) < Math.cos(GREAT_SWORD_HALF_ARC)) continue;
      if (!hasWarLineOfSight(shooter, target)) continue;
      candidates.push({ target, squared });
    }
    candidates.sort((first, second) => first.squared - second.squared);
    const hits = [];
    for (const { target } of candidates.slice(0, GREAT_SWORD_MAX_TARGETS)) {
      const damage = this.applyDamage(
        target,
        definition.damage * damageScale,
        shooter,
        now,
      );
      if (damage <= 0) continue;
      hits.push({
        target: target.slot,
        damage: rounded(damage, 10),
        health: rounded(target.health, 10),
      });
    }
    return {
      origin: roundVector([shooter.position[0], shooter.position[1] + 1, shooter.position[2]]),
      direction: roundVector(forward, 1_000),
      hit: hits.length > 0,
      hits,
      damage: rounded(hits.reduce((total, hit) => total + hit.damage, 0), 10),
    };
  }

  recordDamageContribution(target, attacker, damage, now) {
    if (
      !attacker ||
      attacker === target ||
      attacker.team === target.team ||
      damage <= 0
    ) return;
    const previous = target.damageContributors.get(attacker.slot);
    target.damageContributors.set(attacker.slot, {
      at: now,
      damage: (previous?.damage ?? 0) + damage,
    });
  }

  awardAssists(target, killer, now) {
    const assistingSlots = [];
    for (const [slot, contribution] of target.damageContributors) {
      const contributor = this.players[slot];
      if (
        slot === killer?.slot ||
        !contributor ||
        contributor.team === target.team ||
        now - contribution.at > this.rules.assistWindowMs
      ) continue;
      contributor.assists += 1;
      assistingSlots.push(slot);
    }
    target.damageContributors.clear();
    return assistingSlots.sort((first, second) => first - second);
  }

  finishTeamDeathmatch(winner, now) {
    if (
      this.warMode !== WAR_MODE_TEAM_DEATHMATCH ||
      this.matchEndSent ||
      winner == null
    ) return false;
    this.phase = 'result';
    this.winner = winner;
    this.resultReason = 'kills';
    this.matchEndSent = true;
    this.destroyAt = now + this.rules.destroyAfterMs;
    this.broadcast({
      type: 'war_event',
      event: 'match_end',
      warMode: this.warMode,
      winner,
      reason: this.resultReason,
      scores: [...this.teamScores],
    });
    this.broadcastSnapshot(now);
    return true;
  }

  maybeFinishTeamDeathmatch(now) {
    if (
      this.warMode !== WAR_MODE_TEAM_DEATHMATCH ||
      this.matchEndSent
    ) return false;
    const contenders = [0, 1].filter(
      (team) => this.teamScores[team] >= this.rules.scoreToWin,
    );
    if (!contenders.length) return false;
    const winner = contenders.length === 1
      ? contenders[0]
      : (
        (hashUnit(this.seed, this.botTick, 0, 97) < 0.5 ? 0 : 1) ^
        this.teamSideSwap
      );
    return this.finishTeamDeathmatch(winner, now);
  }

  applyDamage(target, requestedDamage, attacker, now) {
    if (
      !target ||
      target.dead ||
      (target.team === attacker?.team && target !== attacker) ||
      this.phase === 'result'
    ) {
      return 0;
    }
    const dropInScale = (
      !this.pendingBotDamage &&
      target.human &&
      target.connected &&
      now < (target.damageProtectionUntil ?? 0)
    ) ? HUMAN_DROP_IN_DAMAGE_SCALE : 1;
    const damage = Math.min(
      target.health,
      Math.max(0, requestedDamage) * dropInScale,
    );
    if (damage <= 0) return 0;
    if (this.pendingBotDamage) {
      this.pendingBotDamage.push({ target, damage, attacker, now });
      return damage;
    }
    target.health = Math.max(0, target.health - damage);
    this.recordDamageContribution(target, attacker, damage, now);
    if (target.health > 0) return damage;

    target.dead = true;
    target.deathAt = now;
    target.respawnAt = now + this.rules.respawnMs;
    target.velocity = [0, 0, 0];
    target.acceptedHorizontalSpeed = 0;
    target.verticalVelocity = 0;
    target.knockbackVelocity = [0, 0, 0];
    target.lastPhysicsAt = now;
    target.deaths += 1;
    const enemyKill = Boolean(
      attacker && attacker !== target && attacker.team !== target.team,
    );
    if (enemyKill) attacker.kills += 1;
    const assists = this.awardAssists(target, enemyKill ? attacker : null, now);
    let reachedTeamDeathmatchLimit = false;
    if (enemyKill && this.warMode === WAR_MODE_TEAM_DEATHMATCH) {
      this.teamScores[attacker.team] = Math.min(
        this.rules.scoreToWin,
        this.teamScores[attacker.team] + 1,
      );
      if (this.teamScores[attacker.team] >= this.rules.scoreToWin) {
        reachedTeamDeathmatchLimit = true;
      }
    }
    this.broadcast({
      type: 'war_event',
      event: 'death',
      warMode: this.warMode,
      player: target.slot,
      attacker: enemyKill ? attacker.slot : null,
      assists,
      scores: this.warMode === WAR_MODE_TEAM_DEATHMATCH
        ? [...this.teamScores]
        : undefined,
      respawnMs: this.rules.respawnMs,
    });
    if (reachedTeamDeathmatchLimit && !this.deferTeamDeathmatchEnd) {
      this.maybeFinishTeamDeathmatch(now);
    }
    return damage;
  }

  respawn(player, now, announce = true) {
    if (player.pendingClassId !== player.classId) {
      this.setClass(player, player.pendingClassId, false);
    }
    const definition = WAR_CLASSES[player.classId];
    const physicalTeam = player.team ^ this.teamSideSwap;
    player.position = warSpawnForSlot(physicalTeam, player.teamSlot);
    player.velocity = [0, 0, 0];
    player.yaw = warSpawnYaw(physicalTeam);
    player.pitch = 0;
    player.focused = false;
    player.grounded = true;
    player.sliding = false;
    player.slideInputHeld = false;
    player.slideEndsAt = 0;
    player.slideCooldownUntil = 0;
    player.wallRunning = false;
    player.wallRunStartedAt = 0;
    player.acceptedHorizontalSpeed = 0;
    player.verticalVelocity = 0;
    player.knockbackVelocity = [0, 0, 0];
    player.airborneSince = 0;
    player.rtt = 0;
    player.maxHealth = definition.health;
    player.health = definition.health;
    player.ammo = definition.ammo;
    player.reserve = definition.reserve;
    player.reloadEndsAt = Infinity;
    player.dead = false;
    player.deathAt = Infinity;
    player.respawnAt = Infinity;
    player.damageContributors.clear();
    player.lastStateAt = now;
    player.lastPhysicsAt = now;
    player.movementCredit = MAX_MOVEMENT_CREDIT;
    player.history = [{ at: now, position: copyVector(player.position) }];
    player.lastAttackAt = now;
    player.botTargetSlot = null;
    player.botTargetRefreshAt = 0;
    player.botPath = [];
    player.botPathIndex = 0;
    player.botPathGoal = null;
    player.botStuckTicks = 0;
    player.botRecoveryUntil = 0;
    player.botRecoveryRepathAt = 0;
    player.botLastProgressAt = now;
    player.botLastProgressPosition = copyVector(player.position);
    player.botDodgeUntil = 0;
    player.botNextDodgeAt = now + BOT_DODGE_MIN_MS +
      hashUnit(this.seed, player.teamSlot, this.botTick, 60) *
        BOT_DODGE_VARIANCE_MS;
    if (announce && player.human && player.connected) {
      this.broadcast({
        type: 'war_event',
        event: 'respawn',
        player: player.slot,
        classId: player.classId,
      });
    }
  }

  updateRespawns(now) {
    for (const player of this.players) {
      this.finishReload(player, now);
      if (player.dead && now >= player.respawnAt) this.respawn(player, now);
    }
  }

  botDestination(player) {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const angle = player.teamSlot * goldenAngle;
    const ring = 2.2 + (player.teamSlot % 4) * 1.75;
    return [
      Math.cos(angle) * ring,
      0.02,
      Math.sin(angle) * ring *
        ((player.team ^ this.teamSideSwap) === 0 ? 1 : -1),
    ];
  }

  botDecisionPosition(player) {
    return this.botDecisionPositions?.[player.slot] ?? player.position;
  }

  botHasLineOfSight(source, target) {
    if (!this.botDecisionPositions) return hasWarLineOfSight(source, target);
    return hasWarLineOfSight(
      { position: this.botDecisionPosition(source) },
      { position: this.botDecisionPosition(target) },
    );
  }

  botWaypoint(player, destination, forceRepath = false) {
    const pathGoal = player.botPathGoal;
    const goalChanged = !pathGoal || distanceSquared(pathGoal, destination) > 1;
    if (
      !forceRepath &&
      !goalChanged &&
      this.botNavigator.segmentIsWalkable(player.position, destination)
    ) {
      player.botPath = [];
      player.botPathIndex = 0;
      return destination;
    }
    if (
      forceRepath ||
      goalChanged ||
      !Array.isArray(player.botPath) ||
      player.botPathIndex >= player.botPath.length
    ) {
      player.botPath = this.botNavigator.findPath(player.position, destination);
      player.botPathIndex = 0;
      player.botPathGoal = copyVector(destination);
    }
    while (
      player.botPathIndex < player.botPath.length - 1 &&
      distanceSquared(player.position, player.botPath[player.botPathIndex]) < 1.45
    ) {
      player.botPathIndex += 1;
    }
    for (
      let index = player.botPath.length - 1;
      index > player.botPathIndex;
      index -= 1
    ) {
      if (!this.botNavigator.segmentIsWalkable(player.position, player.botPath[index])) {
        continue;
      }
      player.botPathIndex = index;
      break;
    }
    return player.botPath[player.botPathIndex] ?? destination;
  }

  selectBotTarget(player, range, now = this.updatedAt) {
    const rangeSquared = range * range;
    const playerPosition = this.botDecisionPosition(player);
    const validTarget = (candidate) => Boolean(
      candidate &&
      candidate.team !== player.team &&
      !candidate.dead &&
      distanceSquared(
        playerPosition,
        this.botDecisionPosition(candidate),
      ) < rangeSquared &&
      this.botHasLineOfSight(player, candidate)
    );
    const current = this.players[player.botTargetSlot];
    if (now < player.botTargetRefreshAt && validTarget(current)) return current;

    const preferredSlot = player.team === 0
      ? WAR_TEAM_SIZE + (player.teamSlot ^ 1)
      : player.teamSlot ^ 1;
    const preferred = this.players[preferredSlot];
    let target = validTarget(preferred) ? preferred : null;
    let nearestScore = target
      ? distanceSquared(playerPosition, this.botDecisionPosition(target)) * 0.72
      : rangeSquared;
    for (const candidate of this.players) {
      if (!validTarget(candidate)) continue;
      const affinity = candidate.teamSlot === (player.teamSlot ^ 1) ? 0.72 : 1;
      const score = distanceSquared(
        playerPosition,
        this.botDecisionPosition(candidate),
      ) * affinity;
      if (
        score > nearestScore ||
        (score === nearestScore && target && candidate.slot > target.slot)
      ) continue;
      target = candidate;
      nearestScore = score;
    }
    player.botTargetSlot = target?.slot ?? preferredSlot;
    player.botTargetRefreshAt = now + 320 +
      hashUnit(this.seed, player.teamSlot, this.botTick, 70) * 260;
    return target;
  }

  updateBotMovement(player, deltaSeconds, now = this.updatedAt) {
    player.lastPhysicsAt = Math.max(Number(player.lastPhysicsAt) || now, now);
    this.integrateKnockback(player, deltaSeconds);
    const knockback = player.knockbackVelocity ?? [0, 0, 0];
    const knockbackSpeed = Math.hypot(knockback[0], knockback[2]);
    const controlScale = clamp(1 - knockbackSpeed / 4, 0, 1);
    const definition = WAR_CLASSES[player.classId];
    const strategicDestination = this.botDestination(player);
    const engagementRange = Math.min(
      46,
      Math.max(12, definition.range * (player.classId === 'greatsword' ? 2.1 : 0.72)),
    );
    const target = this.selectBotTarget(player, engagementRange, now);
    const stuckAtStart = player.botStuckTicks >= BOT_STUCK_REPATH_TICKS;
    if (stuckAtStart) {
      player.botRecoveryUntil = Math.max(
        player.botRecoveryUntil,
        now + BOT_RECOVERY_MIN_MS,
      );
    }
    let recovering = now < player.botRecoveryUntil;

    if (target && !recovering && now >= player.botNextDodgeAt) {
      player.botDodgeCount += 1;
      player.botDodgeSign = hashUnit(
        this.seed,
        player.teamSlot,
        player.botDodgeCount,
        71,
      ) < 0.5 ? -1 : 1;
      player.botDodgeUntil = now + BOT_DODGE_DURATION_MIN_MS +
        hashUnit(this.seed, player.teamSlot, player.botDodgeCount, 72) *
          BOT_DODGE_DURATION_VARIANCE_MS;
      player.botNextDodgeAt = now + BOT_DODGE_MIN_MS +
        hashUnit(this.seed, player.teamSlot, player.botDodgeCount, 73) *
          BOT_DODGE_VARIANCE_MS;
    }
    const dodgeActive = target && !recovering && now < player.botDodgeUntil;
    const jumpRequested = Boolean(
      player.grounded &&
      (
        player.botStuckTicks >= BOT_STUCK_JUMP_TICKS ||
        (
          dodgeActive &&
          hashUnit(this.seed, player.teamSlot, player.botDodgeCount, 74) < 0.58
        )
      )
    );
    if (jumpRequested) player.botJumpCount += 1;
    this.integrateVerticalMotion(player, deltaSeconds, now, { jumpRequested });

    const forceRecoveryRepath = stuckAtStart && now >= player.botRecoveryRepathAt;
    if (forceRecoveryRepath) {
      player.botRecoveryRepathAt = now + BOT_RECOVERY_REPATH_MS;
    }
    let movementTarget = this.botWaypoint(
      player,
      strategicDestination,
      forceRecoveryRepath,
    );
    let offsetX = movementTarget[0] - player.position[0];
    let offsetZ = movementTarget[2] - player.position[2];
    let distance = Math.hypot(offsetX, offsetZ);
    let directionX = distance > 0.001 ? offsetX / distance : 0;
    let directionZ = distance > 0.001 ? offsetZ / distance : 0;
    let speedScale = 0.92;

    if (target && !recovering) {
      const targetPosition = this.botDecisionPosition(target);
      const targetX = targetPosition[0] - player.position[0];
      const targetZ = targetPosition[2] - player.position[2];
      const targetDistance = Math.max(0.001, Math.hypot(targetX, targetZ));
      const towardX = targetX / targetDistance;
      const towardZ = targetZ / targetDistance;
      const baseStrafeSign = player.botDodgeSign *
        ((player.team ^ this.teamSideSwap) === 0 ? 1 : -1);
      const strafeX = -towardZ * baseStrafeSign;
      const strafeZ = towardX * baseStrafeSign;
      const idealRange = player.classId === 'greatsword'
        ? 2.5
        : player.classId === 'knives'
          ? 12
          : player.classId === 'ember'
            ? 10
            : clamp(definition.range * 0.3, 14, 28);
      const rangeError = clamp((targetDistance - idealRange) / Math.max(3, idealRange), -1, 1);
      const radialWeight = Math.abs(rangeError) < 0.13 ? 0.08 : rangeError;
      const strafeWeight = dodgeActive ? 1.5 : 0.58;
      const direction = normalize([
        towardX * radialWeight + strafeX * strafeWeight,
        0,
        towardZ * radialWeight + strafeZ * strafeWeight,
      ]);
      if (direction) {
        directionX = direction[0];
        directionZ = direction[2];
      }
      movementTarget = targetPosition;
      distance = targetDistance;
      speedScale = dodgeActive ? 1.08 : 0.78;
    }

    if (distance < 0.28 || controlScale <= 0.001) {
      if (recovering && distance < 0.28) {
        player.botStuckTicks = 0;
        player.botRecoveryUntil = 0;
      }
      player.acceptedHorizontalSpeed = 0;
      player.velocity = [
        knockback[0],
        player.verticalVelocity,
        knockback[2],
      ];
      return;
    }
    let speed = definition.speed * speedScale;
    let stride = Math.min(distance, speed * controlScale * deltaSeconds);
    const movementOrigin = copyVector(player.position);
    let requested = [
      player.position[0] + directionX * stride,
      player.position[1],
      player.position[2] + directionZ * stride,
    ];
    let moved = moveWarBody(player.position, requested);
    let movedDistance = Math.sqrt(distanceSquared(moved, player.position));
    let minimumProgress = Math.max(0.025, stride * 0.16);
    if (movedDistance < minimumProgress && (target || recovering)) {
      recovering = true;
      player.botRecoveryUntil = Math.max(
        player.botRecoveryUntil,
        now + BOT_RECOVERY_MIN_MS,
      );
      const forceRepath = now >= player.botRecoveryRepathAt;
      if (forceRepath) player.botRecoveryRepathAt = now + BOT_RECOVERY_REPATH_MS;
      const recovery = this.botWaypoint(
        player,
        strategicDestination,
        forceRepath,
      );
      offsetX = recovery[0] - player.position[0];
      offsetZ = recovery[2] - player.position[2];
      const recoveryDistance = Math.hypot(offsetX, offsetZ);
      if (recoveryDistance > 0.001) {
        directionX = offsetX / recoveryDistance;
        directionZ = offsetZ / recoveryDistance;
      }
      const recoverySpeed = definition.speed * 0.92;
      const recoveryStride = Math.min(
        recoveryDistance,
        recoverySpeed * controlScale * deltaSeconds,
      );
      requested = [
        player.position[0] + directionX * recoveryStride,
        player.position[1],
        player.position[2] + directionZ * recoveryStride,
      ];
      const recoveryMove = moveWarBody(player.position, requested);
      const recoveryMovedDistance = Math.sqrt(
        distanceSquared(recoveryMove, player.position),
      );
      if (recoveryMovedDistance > movedDistance) {
        moved = recoveryMove;
        movedDistance = recoveryMovedDistance;
        speed = recoverySpeed;
        stride = recoveryStride;
        minimumProgress = Math.max(0.025, stride * 0.16);
      }
    }
    if (movedDistance < 0.01) {
      const turn = hashUnit(this.seed, player.teamSlot, this.botTick, 75) < 0.5 ? -1 : 1;
      [directionX, directionZ] = [-directionZ * turn, directionX * turn];
      requested = [
        player.position[0] + directionX * stride,
        player.position[1],
        player.position[2] + directionZ * stride,
      ];
      moved = moveWarBody(player.position, requested);
      movedDistance = Math.sqrt(distanceSquared(moved, player.position));
    }
    player.position = moved;
    const acceptedDistance = Math.hypot(
      player.position[0] - movementOrigin[0],
      player.position[2] - movementOrigin[2],
    );
    if (acceptedDistance < minimumProgress) {
      player.botStuckTicks += 1;
      if (player.botStuckTicks >= BOT_STUCK_REPATH_TICKS) {
        player.botRecoveryUntil = Math.max(
          player.botRecoveryUntil,
          now + BOT_RECOVERY_MIN_MS,
        );
      }
    } else {
      player.botStuckTicks = 0;
      player.botLastProgressAt = now;
      player.botLastProgressPosition = copyVector(player.position);
    }
    player.acceptedHorizontalSpeed = deltaSeconds > 0
      ? acceptedDistance / deltaSeconds
      : 0;
    player.velocity = [
      directionX * speed * controlScale + knockback[0],
      player.verticalVelocity,
      directionZ * speed * controlScale + knockback[2],
    ];
    if (target) {
      const targetPosition = this.botDecisionPosition(target);
      const aimX = targetPosition[0] - player.position[0];
      const aimZ = targetPosition[2] - player.position[2];
      player.yaw = Math.atan2(-aimX, -aimZ);
    } else {
      player.yaw = Math.atan2(-directionX, -directionZ);
    }
    player.focused = false;
    player.sliding = Boolean(
      dodgeActive && !recovering && player.grounded && speed > 6.2,
    );
  }

  nearestBotTarget(player, range) {
    return this.selectBotTarget(player, range, this.updatedAt);
  }

  botAim(player, target, definition) {
    const targetVelocity = target.velocity ?? [0, 0, 0];
    const distance = Math.sqrt(distanceSquared(player.position, target.position));
    const leadSeconds = definition.projectile
      ? Math.min(0.55, distance / Math.max(1, definition.projectileSpeed))
      : 0.08;
    const origin = [
      player.position[0],
      player.position[1] + WAR_STANDING_EYE_HEIGHT,
      player.position[2],
    ];
    const center = [
      target.position[0] + (Number(targetVelocity[0]) || 0) * leadSeconds,
      target.position[1] + 1 + (Number(targetVelocity[1]) || 0) * leadSeconds,
      target.position[2] + (Number(targetVelocity[2]) || 0) * leadSeconds,
    ];
    const intendedHit = hashUnit(
      this.seed,
      player.teamSlot,
      player.attackSequence,
      80,
    ) < clamp(
      player.botAccuracy - distance / Math.max(1, definition.range) * 0.12,
      0.28,
      0.55,
    );
    const base = normalize([
      center[0] - origin[0],
      center[1] - origin[1],
      center[2] - origin[2],
    ]) ?? [
      0,
      0,
      (player.team ^ this.teamSideSwap) === 0 ? -1 : 1,
    ];
    const right = normalize([-base[2], 0, base[0]]) ?? [1, 0, 0];
    const side = hashUnit(
      this.seed,
      player.teamSlot,
      player.attackSequence,
      81,
    ) < 0.5 ? -1 : 1;
    const horizontalMiss = intendedHit
      ? (hashUnit(this.seed, player.teamSlot, player.attackSequence, 82) - 0.5) * 0.34
      : side * (
        (definition.projectile ? definition.splashRadius + 2.4 : 1.05) +
        hashUnit(this.seed, player.teamSlot, player.attackSequence, 83) * 1.45
      );
    const verticalMiss = intendedHit
      ? (hashUnit(this.seed, player.teamSlot, player.attackSequence, 84) - 0.5) * 0.24
      : (hashUnit(this.seed, player.teamSlot, player.attackSequence, 85) - 0.5) * 2.1;
    return {
      direction: normalize([
        center[0] + right[0] * horizontalMiss - origin[0],
        center[1] + verticalMiss - origin[1],
        center[2] + right[2] * horizontalMiss - origin[2],
      ]) ?? base,
      intendedHit,
    };
  }

  updateBotAttack(player, now) {
    const definition = WAR_CLASSES[player.classId];
    this.finishReload(player, now);
    if (player.reloadEndsAt !== Infinity) return;
    if (definition.usesAmmo && player.ammo <= 0) {
      this.startReload(player, now);
      return;
    }
    const attackInterval = definition.attackMs * player.botCadenceScale;
    if (now - player.lastAttackAt < attackInterval) return;
    const target = this.selectBotTarget(player, definition.range, now);
    if (!target) return;
    player.lastAttackAt = now;
    player.attackSequence += 1;
    if (definition.usesAmmo) player.ammo = Math.max(0, player.ammo - 1);
    const offset = [
      target.position[0] - player.position[0],
      target.position[1] + 1 - (player.position[1] + WAR_STANDING_EYE_HEIGHT),
      target.position[2] - player.position[2],
    ];
    let result;
    let intendedHit;
    if (player.classId === 'greatsword') {
      intendedHit = hashUnit(
        this.seed,
        player.teamSlot,
        player.attackSequence,
        86,
      ) < player.botMeleeAccuracy;
      const base = normalize([offset[0], 0, offset[2]]) ?? [0, 0, -1];
      const missAngle = intendedHit ? 0 : (
        hashUnit(this.seed, player.teamSlot, player.attackSequence, 87) < 0.5
          ? -1.42
          : 1.42
      );
      const cosine = Math.cos(missAngle);
      const sine = Math.sin(missAngle);
      const direction = [
        base[0] * cosine - base[2] * sine,
        0,
        base[0] * sine + base[2] * cosine,
      ];
      result = this.performGreatswordAttack(
        player,
        direction,
        now,
        player.botDamageScale,
      );
    } else {
      const aim = this.botAim(player, target, definition);
      intendedHit = aim.intendedHit;
      result = this.performRangedAttack(
        player,
        aim.direction,
        now,
        player.attackSequence,
        player.botDamageScale,
      );
    }
    player.botShotAttempts = (player.botShotAttempts ?? 0) + 1;
    if (!intendedHit) {
      player.botDeliberateMisses = (player.botDeliberateMisses ?? 0) + 1;
    }
    player.yaw = Math.atan2(-offset[0], -offset[2]);
    const horizontal = Math.hypot(offset[0], offset[2]);
    player.pitch = Math.atan2(offset[1], Math.max(0.001, horizontal));
    const payload = {
      type: 'war_event',
      event: 'attack',
      shooter: player.slot,
      classId: player.classId,
      attackSequence: player.attackSequence,
      ...result,
    };
    if (this.pendingBotAttacks) this.pendingBotAttacks.push(payload);
    else this.broadcast(payload, null, { volatile: true });
  }

  resolvedBotAttack(payload, resolvedDamage) {
    if (!Array.isArray(payload.hits)) return payload;
    const hits = [];
    for (const hit of payload.hits) {
      const key = payload.shooter * WAR_COMBATANT_COUNT + hit.target;
      const damage = resolvedDamage.get(key) ?? 0;
      if (damage <= 0) continue;
      hits.push({
        ...hit,
        damage: rounded(damage, 10),
        health: rounded(this.players[hit.target]?.health ?? 0, 10),
      });
    }
    const resolved = {
      ...payload,
      hit: hits.length > 0,
      hits,
      damage: rounded(
        hits.reduce((total, hit) => total + hit.damage, 0),
        10,
      ),
    };
    if ('hitCount' in resolved) {
      resolved.hitCount = hits.reduce(
        (total, hit) => total + (Number(hit.hitCount) || 1),
        0,
      );
    }
    if ('headshot' in resolved) {
      resolved.headshot = hits.some((hit) => hit.headshot);
    }
    if ('target' in resolved) {
      const primary = hits.find((hit) => hit.target === payload.target) ?? hits[0];
      resolved.target = primary?.target ?? null;
      if ('targetHealth' in resolved) {
        resolved.targetHealth = primary?.health ?? null;
      }
    }
    return resolved;
  }

  objectiveOccupancy() {
    const occupancy = [0, 0];
    const center = WAR_MAP.objective.position;
    const radiusSquared = WAR_MAP.objective.radius * WAR_MAP.objective.radius;
    for (const player of this.players) {
      if (player.dead) continue;
      const x = player.position[0] - center[0];
      const z = player.position[2] - center[2];
      const y = Math.abs(player.position[1] - center[1]);
      if (y <= 3 && x * x + z * z <= radiusSquared) occupancy[player.team] += 1;
    }
    return occupancy;
  }

  runBotTick(now) {
    if (this.phase === 'result') return;
    this.botTick += 1;
    this.updateRespawns(now);
    for (const player of this.players) {
      if (!player.human || !player.connected || player.dead) continue;
      this.advancePassiveMotion(player, now);
    }
    // Every bot chooses movement from one frozen world state. Without this,
    // team 1 (the later slots) reacts to team 0's already-updated positions in
    // the same tick and receives a systematic pursuit/evasion advantage.
    this.botDecisionPositions = this.players.map((player) =>
      copyVector(player.position));
    try {
      for (const player of this.players) {
        if (!player.bot || player.dead) continue;
        this.updateBotMovement(player, this.botInterval / 1_000, now);
        this.recordHistory(player, now);
      }
    } finally {
      this.botDecisionPositions = null;
    }
    this.pendingBotDamage = [];
    this.pendingBotAttacks = [];
    this.deferTeamDeathmatchEnd = this.warMode === WAR_MODE_TEAM_DEATHMATCH;
    for (const player of this.players) {
      if (!player.bot || player.dead) continue;
      this.updateBotAttack(player, now);
    }
    const pendingDamage = this.pendingBotDamage;
    const pendingAttacks = this.pendingBotAttacks;
    this.pendingBotDamage = null;
    this.pendingBotAttacks = null;
    const resolvedDamage = new Map();
    for (const intent of pendingDamage) {
      const damage = this.applyDamage(
        intent.target,
        intent.damage,
        intent.attacker,
        intent.now,
      );
      if (damage <= 0 || !intent.attacker) continue;
      const key = intent.attacker.slot * WAR_COMBATANT_COUNT + intent.target.slot;
      resolvedDamage.set(key, (resolvedDamage.get(key) ?? 0) + damage);
    }
    for (const payload of pendingAttacks) {
      this.broadcast(
        this.resolvedBotAttack(payload, resolvedDamage),
        null,
        { volatile: true },
      );
    }
    this.updateProjectiles(now);
    this.deferTeamDeathmatchEnd = false;
    if (this.warMode === WAR_MODE_TEAM_DEATHMATCH) {
      this.maybeFinishTeamDeathmatch(now);
    }

    if (this.warMode !== WAR_MODE_CONTROL || this.phase === 'result') return;
    const occupancy = this.objectiveOccupancy();
    const control = this.control.update(now, occupancy);
    this.phase = control.phase;
    this.winner = control.winner;
    if (control.winner != null && !this.matchEndSent) {
      this.matchEndSent = true;
      this.resultReason = 'control';
      this.destroyAt = now + this.rules.destroyAfterMs;
      this.broadcast({
        type: 'war_event',
        event: 'match_end',
        warMode: this.warMode,
        winner: control.winner,
        reason: this.resultReason,
        scores: control.scores,
      });
      this.broadcastSnapshot(now);
    }
  }

  disconnect(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || !player.human || !player.connected) return false;
    player.connected = false;
    player.human = false;
    player.bot = true;
    player.reconnectUntil = now + this.rules.reconnectMs;
    this.broadcast({
      type: 'war_event',
      event: 'player_disconnected',
      player: player.slot,
    }, null, { volatile: true });
    if (this.connectedHumans().length === 0) {
      this.destroyAt = Math.min(this.destroyAt, now + this.rules.destroyAfterMs);
    }
    return true;
  }

  reconnect(session, now = Date.now()) {
    const player = this.playerForSession(session);
    const liveSocketMigration = Boolean(
      player?.connected &&
      player.human &&
      player.session === session,
    );
    const reservedReconnect = Boolean(
      player?.token && player.reconnectUntil >= now,
    );
    if (!player || (!liveSocketMigration && !reservedReconnect)) return false;
    const wasDisconnected = !player.connected || player.bot;
    player.session = session;
    player.name = String(session.name ?? player.name).slice(0, 18);
    player.connected = true;
    player.human = true;
    player.bot = false;
    player.reconnectUntil = 0;
    player.lastStateAt = now;
    player.lastPhysicsAt = now;
    player.movementCredit = MAX_MOVEMENT_CREDIT;
    player.acceptedHorizontalSpeed = 0;
    session.room = this;
    session.slot = player.slot;
    session.team = player.team;
    this.destroyAt = this.phase === 'result'
      ? now + this.rules.destroyAfterMs
      : Infinity;
    this.sendFound(player, true, now);
    if (wasDisconnected) {
      this.broadcast({
        type: 'war_event',
        event: 'player_reconnected',
        player: player.slot,
      }, player, { volatile: true });
    }
    return true;
  }

  leave(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player) return false;
    if (player.session?.room === this) {
      player.session.room = null;
      player.session.slot = null;
      player.session.team = null;
    }
    player.session = null;
    player.token = null;
    player.connected = false;
    player.human = false;
    player.bot = true;
    player.reconnectUntil = 0;
    player.name = `Bot ${player.teamSlot + 1}`;
    this.broadcast({
      type: 'war_event',
      event: 'player_left',
      player: player.slot,
    }, null, { volatile: true });
    if (this.connectedHumans().length === 0) {
      this.destroyAt = Math.min(this.destroyAt, now + this.rules.destroyAfterMs);
    }
    return true;
  }

  snapshot(now = Date.now()) {
    const control = this.control
      ? this.control.snapshot(now, this.objectiveOccupancy())
      : null;
    const teamScores = control
      ? control.scores
      : this.teamScores.map((score) => Math.round(score));
    return {
      serverTime: now,
      mode: this.mode,
      warMode: this.warMode,
      mapId: WAR_MAP.id,
      seed: this.seed,
      phase: this.phase,
      control,
      teamScores,
      scoreToWin: this.rules.scoreToWin,
      combatants: this.players.map((player) => ({
        id: player.id,
        team: player.team,
        human: player.human && player.connected,
        name: player.name,
        classId: player.classId,
        position: roundVector(player.position),
        velocity: roundVector(player.velocity),
        yaw: rounded(player.yaw, 1_000),
        pitch: rounded(player.pitch, 1_000),
        health: rounded(player.health, 10),
        maxHealth: player.maxHealth,
        ammo: player.ammo,
        reserve: player.reserve,
        usesAmmo: WAR_CLASSES[player.classId].usesAmmo,
        reloading: player.reloadEndsAt !== Infinity,
        reloadRemaining: player.reloadEndsAt === Infinity
          ? 0
          : Math.max(0, Math.round(player.reloadEndsAt - now)),
        dead: player.dead,
        respawnRemaining: player.dead ? Math.max(0, Math.round(player.respawnAt - now)) : 0,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        attackSequence: player.attackSequence,
        ack: player.human ? player.lastSequence : 0,
        shotAck: player.human ? player.lastShotId : 0,
      })),
      pickups: [],
      projectiles: this.projectiles.map((projectile) =>
        this.projectileSnapshot(projectile)),
      winner: this.winner,
      resultReason: this.resultReason,
    };
  }

  createSnapshot(now = Date.now()) {
    return this.snapshot(now);
  }

  broadcastSnapshot(now = Date.now()) {
    while (this.snapshotAt <= now) this.snapshotAt += this.snapshotInterval;
    const payload = {
      type: 'war_snapshot',
      roomId: this.id,
      state: this.snapshot(now),
    };
    const encoded = JSON.stringify(payload);
    for (const player of this.players) {
      if (!player.human || !player.connected) continue;
      if (player.session?.sendEncoded) {
        player.session.sendEncoded(encoded, { volatile: true });
      } else {
        player.session?.send?.(payload);
      }
    }
  }

  update(now = Date.now()) {
    this.updatedAt = now;
    this.clearExpiredReservations(now);
    this.updateRespawns(now);
    let steps = 0;
    while (
      this.nextBotAt <= now &&
      steps < MAX_BOT_CATCHUP_STEPS &&
      this.phase !== 'result'
    ) {
      this.runBotTick(this.nextBotAt);
      this.nextBotAt += this.botInterval;
      steps += 1;
    }
    if (this.nextBotAt <= now) this.nextBotAt = now + this.botInterval;
    if (now >= this.snapshotAt && this.phase !== 'result') {
      this.broadcastSnapshot(now);
    }
  }

  shouldDestroy(now = Date.now()) {
    return now >= this.destroyAt;
  }

  getSummary() {
    const connectedPlayers = this.connectedHumans().length;
    return {
      id: this.id,
      code: this.code,
      privateMatch: this.privateMatch,
      mode: this.mode,
      warMode: this.warMode,
      phase: this.phase,
      ageSeconds: Math.round((Date.now() - this.createdAt) / 1_000),
      connectedPlayers,
      humanPlayers: connectedPlayers,
      botPlayers: WAR_COMBATANT_COUNT - connectedPlayers,
      teamHumans: [0, 1].map((team) =>
        this.players.filter((player) =>
          player.team === team && player.human && player.connected
        ).length
      ),
    };
  }
}

export const WAR_ROOM_LIMITS = Object.freeze({
  combatants: WAR_COMBATANT_COUNT,
  teamSize: WAR_TEAM_SIZE,
  botTickRate: WAR_RULES.botTickRate,
  snapshotRate: WAR_RULES.snapshotRate,
  maxBotCatchupSteps: MAX_BOT_CATCHUP_STEPS,
});
