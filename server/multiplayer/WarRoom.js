import { randomUUID } from 'node:crypto';
import {
  WAR_CLASSES,
  WAR_CLASS_IDS,
  WAR_COMBATANT_COUNT,
  WAR_MAP,
  WAR_RULES,
  WAR_TEAM_COUNT,
  WAR_TEAM_SIZE,
  normalizeWarClass,
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
    lastStateAt: now,
    lastPhysicsAt: now,
    movementCredit: MAX_MOVEMENT_CREDIT,
    lastSequence: 0,
    lastShotId: 0,
    lastAttackAt:
      now - hashUnit(seed, globalSlot, 0, 11) * definition.attackMs,
    attackSequence: 0,
    kills: 0,
    deaths: 0,
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
  } = {}) {
    if (!Array.isArray(sessions) || sessions.length > WAR_COMBATANT_COUNT) {
      throw new Error(`A War room accepts at most ${WAR_COMBATANT_COUNT} sessions.`);
    }
    this.id = randomUUID();
    this.mode = 'war';
    this.code = null;
    this.privateMatch = false;
    this.rules = Object.freeze({ ...WAR_RULES, ...rules });
    this.seed = seed >>> 0;
    this.createdAt = now;
    this.updatedAt = now;
    this.destroyAt = Infinity;
    this.phase = 'locked';
    this.winner = null;
    this.resultReason = null;
    this.matchEndSent = false;
    this.joinSequence = 0;
    this.botTick = 0;
    this.botInterval = 1_000 / this.rules.botTickRate;
    this.nextBotAt = now + this.botInterval;
    this.snapshotInterval = 1_000 / this.rules.snapshotRate;
    this.snapshotAt = now + this.snapshotInterval;
    this.players = Array.from(
      { length: WAR_COMBATANT_COUNT },
      (_, slot) => createCombatant(slot, now, this.seed),
    );
    this.projectiles = [];
    this.nextProjectileId = 1;
    this.pendingBotDamage = null;
    this.control = new WarControl({ now, rules: this.rules });

    sessions.forEach((entry, index) => {
      const normalized = sessionEntry(entry);
      this.addSession(
        normalized.session,
        classIds[index] ?? normalized.classId,
        now,
      );
    });
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
    return this.players.find(
      (player) => player.team === team && player.bot && !player.token,
    ) ?? null;
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

  addSession(session, requestedClass, now = Date.now()) {
    if (!session || this.phase === 'result') return null;
    const existing = this.playerForSession(session);
    if (existing) return this.reconnect(session, now) ? existing : null;
    const team = this.chooseJoinTeam(now);
    const player = this.eligibleBotForTeam(team, now);
    if (!player) return null;

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
    this.respawn(player, now, false);
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
    // A completed War room is replaced instead of resetting its 80 stable slots.
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

  performRangedAttack(shooter, direction, now, attackId = shooter.attackSequence) {
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
    const seed = (
      this.seed ^
      Math.imul(shooter.slot + 3, 7_919) ^
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
        const pelletDamage = definition.damage * falloff * (
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
        definition.damage * falloff * ownerScale,
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

  performGreatswordAttack(shooter, direction, now) {
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
      const damage = this.applyDamage(target, definition.damage, shooter, now);
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

  applyDamage(target, requestedDamage, attacker, now) {
    if (
      !target ||
      target.dead ||
      (target.team === attacker?.team && target !== attacker) ||
      this.phase === 'result'
    ) {
      return 0;
    }
    const damage = Math.min(target.health, Math.max(0, requestedDamage));
    if (damage <= 0) return 0;
    if (this.pendingBotDamage) {
      this.pendingBotDamage.push({ target, damage, attacker, now });
      return damage;
    }
    target.health = Math.max(0, target.health - damage);
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
    if (attacker) attacker.kills += 1;
    this.broadcast({
      type: 'war_event',
      event: 'death',
      player: target.slot,
      attacker: attacker?.slot ?? null,
      respawnMs: this.rules.respawnMs,
    });
    return damage;
  }

  respawn(player, now, announce = true) {
    if (player.pendingClassId !== player.classId) {
      this.setClass(player, player.pendingClassId, false);
    }
    const definition = WAR_CLASSES[player.classId];
    player.position = warSpawnForSlot(player.team, player.teamSlot);
    player.velocity = [0, 0, 0];
    player.yaw = warSpawnYaw(player.team);
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
    player.lastStateAt = now;
    player.lastPhysicsAt = now;
    player.movementCredit = MAX_MOVEMENT_CREDIT;
    player.history = [{ at: now, position: copyVector(player.position) }];
    player.lastAttackAt = now;
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
      Math.sin(angle) * ring * (player.team === 0 ? 1 : -1),
    ];
  }

  updateBotMovement(player, deltaSeconds, now = this.updatedAt) {
    player.lastPhysicsAt = Math.max(Number(player.lastPhysicsAt) || now, now);
    this.integrateKnockback(player, deltaSeconds);
    this.integrateVerticalMotion(player, deltaSeconds, now);
    const knockback = player.knockbackVelocity ?? [0, 0, 0];
    const knockbackSpeed = Math.hypot(knockback[0], knockback[2]);
    const controlScale = clamp(1 - knockbackSpeed / 4, 0, 1);
    const destination = this.botDestination(player);
    const offsetX = destination[0] - player.position[0];
    const offsetZ = destination[2] - player.position[2];
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance < 0.28 || controlScale <= 0.001) {
      player.acceptedHorizontalSpeed = 0;
      player.velocity = [
        knockback[0],
        player.verticalVelocity,
        knockback[2],
      ];
      return;
    }
    const speed = WAR_CLASSES[player.classId].speed;
    let directionX = offsetX / distance;
    let directionZ = offsetZ / distance;
    const stride = Math.min(distance, speed * controlScale * deltaSeconds);
    const movementOrigin = copyVector(player.position);
    let requested = [
      player.position[0] + directionX * stride,
      player.position[1],
      player.position[2] + directionZ * stride,
    ];
    let moved = moveWarBody(player.position, requested);
    if (distanceSquared(moved, player.position) < 0.0001) {
      const turn = hashUnit(this.seed, player.slot, this.botTick, 31) < 0.5 ? -1 : 1;
      [directionX, directionZ] = [-directionZ * turn, directionX * turn];
      requested = [
        player.position[0] + directionX * stride,
        player.position[1],
        player.position[2] + directionZ * stride,
      ];
      moved = moveWarBody(player.position, requested);
    }
    player.position = moved;
    const acceptedDistance = Math.hypot(
      player.position[0] - movementOrigin[0],
      player.position[2] - movementOrigin[2],
    );
    player.acceptedHorizontalSpeed = deltaSeconds > 0
      ? acceptedDistance / deltaSeconds
      : 0;
    player.velocity = [
      directionX * speed * controlScale + knockback[0],
      player.verticalVelocity,
      directionZ * speed * controlScale + knockback[2],
    ];
    player.yaw = Math.atan2(-directionX, -directionZ);
  }

  nearestBotTarget(player, range) {
    const rangeSquared = range * range;
    let target = null;
    let nearest = rangeSquared;
    for (const candidate of this.players) {
      if (candidate.team === player.team || candidate.dead) continue;
      const squared = distanceSquared(player.position, candidate.position);
      if (squared >= nearest || !hasWarLineOfSight(player, candidate)) continue;
      target = candidate;
      nearest = squared;
    }
    return target;
  }

  updateBotAttack(player, now) {
    const definition = WAR_CLASSES[player.classId];
    this.finishReload(player, now);
    if (player.reloadEndsAt !== Infinity) return;
    if (definition.usesAmmo && player.ammo <= 0) {
      this.startReload(player, now);
      return;
    }
    if (now - player.lastAttackAt < definition.attackMs) return;
    const target = this.nearestBotTarget(player, definition.range);
    if (!target) return;
    player.lastAttackAt = now;
    player.attackSequence += 1;
    if (definition.usesAmmo) player.ammo = Math.max(0, player.ammo - 1);
    const offset = [
      target.position[0] - player.position[0],
      target.position[1] - player.position[1],
      target.position[2] - player.position[2],
    ];
    player.yaw = Math.atan2(-offset[0], -offset[2]);
    const horizontal = Math.hypot(offset[0], offset[2]);
    player.pitch = Math.atan2(offset[1], Math.max(0.001, horizontal));
    if (definition.projectile) {
      const direction = normalize(offset);
      if (!direction) return;
      const result = this.performRangedAttack(
        player,
        direction,
        now,
        player.attackSequence,
      );
      this.broadcast({
        type: 'war_event',
        event: 'attack',
        shooter: player.slot,
        classId: player.classId,
        attackSequence: player.attackSequence,
        ...result,
      }, null, { volatile: true });
      return;
    }
    const hitChance = player.classId === 'greatsword'
      ? 1
      : clamp(0.86 - Math.sqrt(distanceSquared(player.position, target.position)) / definition.range * 0.25, 0.58, 0.86);
    if (hashUnit(this.seed, player.slot, this.botTick, player.attackSequence) > hitChance) return;
    if (player.classId === 'greatsword') {
      this.performGreatswordAttack(player, normalize(offset) ?? [0, 0, -1], now);
      return;
    }
    const direction = normalize(offset);
    if (direction) {
      this.performRangedAttack(player, direction, now, player.attackSequence);
    }
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
    for (const player of this.players) {
      if (!player.bot || player.dead) continue;
      this.updateBotMovement(player, this.botInterval / 1_000, now);
      this.recordHistory(player, now);
    }
    this.pendingBotDamage = [];
    for (const player of this.players) {
      if (!player.bot || player.dead) continue;
      this.updateBotAttack(player, now);
    }
    const pendingDamage = this.pendingBotDamage;
    this.pendingBotDamage = null;
    for (const intent of pendingDamage) {
      this.applyDamage(intent.target, intent.damage, intent.attacker, intent.now);
    }
    this.updateProjectiles(now);

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
    const occupancy = this.objectiveOccupancy();
    const control = this.control.snapshot(now, occupancy);
    return {
      serverTime: now,
      mode: this.mode,
      mapId: WAR_MAP.id,
      seed: this.seed,
      phase: this.phase,
      control,
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
