import { randomUUID } from 'node:crypto';
import {
  MAPS,
  MATCH_RULES,
  SNAPSHOT_RATE,
  WEAPONS,
  clamp,
  createMapOrder,
  createPickupState,
} from './config.js';
import {
  addScaled,
  bodyIntersectsWorld,
  bodySweepIntersectsWorld,
  clampPositionToMap,
  directionFromAngles,
  distanceSquared,
  dot,
  firstWorldHit,
  isFiniteVector,
  normalize,
  raySphereDistance,
  spreadDirections,
  tracePlayer,
} from './geometry.js';

const MAX_HISTORY_MS = 1100;
const MAX_STATE_SPEED = 18;
const MAX_MOVEMENT_CREDIT = 1.5;
const MAX_MESSAGES_AHEAD = 2048;
const KILL_CREDIT_WINDOW_MS = 10_000;

function copyVector(vector) {
  return [vector[0], vector[1], vector[2]];
}

function roundVector(vector) {
  return vector.map((value) => Math.round(value * 1000) / 1000);
}

function safeAngle(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? clamp(value, minimum, maximum) : fallback;
}

function shortestAngleDifference(start, end) {
  return Math.atan2(Math.sin(end - start), Math.cos(end - start));
}

function createPlayer(session, slot, mapIndex) {
  const map = MAPS[mapIndex];
  return {
    slot,
    session,
    token: session.token,
    name: session.name,
    connected: true,
    ready: false,
    position: copyVector(map.spawns[slot]),
    velocity: [0, 0, 0],
    yaw: map.yaws[slot],
    pitch: 0,
    health: 100,
    dead: false,
    deathAt: Infinity,
    deathCredited: false,
    lastAttackerSlot: null,
    lastDamageAt: -Infinity,
    kills: 0,
    deaths: 0,
    assists: 0,
    weapon: 'knives',
    ammo: WEAPONS.knives.ammo,
    reserve: WEAPONS.knives.reserve,
    reloadEndsAt: Infinity,
    grounded: false,
    sliding: false,
    wallRunning: false,
    focused: false,
    lastStateAt: 0,
    movementCredit: MAX_MOVEMENT_CREDIT,
    lastShotAt: -Infinity,
    lastSequence: 0,
    lastShotId: 0,
    rtt: 0,
    history: [],
    rematch: false,
  };
}

export class Room {
  constructor({
    sessions,
    code = null,
    privateMatch = false,
    rules = MATCH_RULES,
    now = Date.now(),
  }) {
    if (!Array.isArray(sessions) || sessions.length !== 2) {
      throw new Error('A room requires exactly two sessions.');
    }
    this.id = randomUUID();
    this.code = code;
    this.privateMatch = privateMatch;
    this.rules = { ...MATCH_RULES, ...rules };
    this.createdAt = now;
    this.updatedAt = now;
    this.destroyAt = Infinity;
    this.seed = (Math.floor(Math.random() * 0xffffffff) ^ now) >>> 0;
    this.mapOrder = createMapOrder(this.seed);
    this.roundNumber = 1;
    this.takeNumber = 1;
    this.rounds = [0, 0];
    this.takes = [0, 0];
    this.mapIndex = this.mapOrder[0];
    this.mapSeed = this.seed + 1009;
    this.pickups = [];
    this.projectiles = [];
    this.projectileSequence = 0;
    this.pendingResolutionAt = Infinity;
    this.phase = 'loading';
    this.phaseEndsAt = now + this.rules.loadTimeoutMs;
    this.overtime = false;
    this.nextOvertimeAt = Infinity;
    this.snapshotAt = now;
    this.snapshotInterval = 1000 / SNAPSHOT_RATE;
    this.pausedPhase = null;
    this.pausedRemaining = 0;
    this.disconnectDeadline = Infinity;
    this.winner = null;
    this.resultReason = null;
    this.players = sessions.map((session, slot) =>
      createPlayer(session, slot, this.mapIndex),
    );

    for (const player of this.players) {
      player.session.room = this;
      player.session.slot = player.slot;
    }
    this.prepareRound(now);
    this.broadcastMatchFound(false);
  }

  send(player, payload) {
    player?.session?.send(payload);
  }

  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const player of this.players) {
      if (player?.session?.sendEncoded) player.session.sendEncoded(encoded);
      else player?.session?.send(payload);
    }
  }

  opponentOf(player) {
    return this.players[player.slot === 0 ? 1 : 0];
  }

  playerForSession(session) {
    if (!session) return null;
    return this.players.find((player) => player.token === session.token) ?? null;
  }

  broadcastMatchFound(resumed) {
    for (const player of this.players) {
      const opponent = this.opponentOf(player);
      this.send(player, {
        type: 'match_found',
        roomId: this.id,
        code: this.code,
        privateMatch: this.privateMatch,
        slot: player.slot,
        opponent: opponent.name,
        seed: this.seed,
        mapOrder: this.mapOrder,
        resumed,
        snapshot: this.createSnapshot(Date.now()),
      });
    }
  }

  prepareRound(now) {
    this.mapIndex =
      this.mapOrder[(this.roundNumber - 1) % this.mapOrder.length];
    this.mapSeed = this.seed + this.roundNumber * 1009;
    this.takes = [0, 0];
    this.takeNumber = 1;
    this.phase = 'loading';
    this.phaseEndsAt = now + this.rules.loadTimeoutMs;
    this.overtime = false;
    this.projectiles.length = 0;
    for (const player of this.players) player.ready = false;
    this.resetTake(now);
    this.broadcast({
      type: 'event',
      event: 'round_loading',
      roundNumber: this.roundNumber,
      mapIndex: this.mapIndex,
      mapSeed: this.mapSeed,
      pickups: this.pickups,
    });
  }

  resetTake(now) {
    this.pickups = createPickupState(this.mapIndex, this.mapSeed);
    this.projectiles.length = 0;
    const map = MAPS[this.mapIndex];
    for (const player of this.players) {
      const spawnSlot = (player.slot + this.roundNumber - 1) % 2;
      player.position = copyVector(map.spawns[spawnSlot]);
      player.velocity = [0, 0, 0];
      player.yaw = map.yaws[spawnSlot];
      player.pitch = 0;
      player.health = 100;
      player.dead = false;
      player.deathAt = Infinity;
      player.deathCredited = false;
      player.lastAttackerSlot = null;
      player.lastDamageAt = -Infinity;
      player.weapon = 'knives';
      player.ammo = WEAPONS.knives.ammo;
      player.reserve = WEAPONS.knives.reserve;
      player.reloadEndsAt = Infinity;
      player.grounded = false;
      player.sliding = false;
      player.wallRunning = false;
      player.focused = false;
      player.lastShotAt = -Infinity;
      player.lastStateAt = now;
      player.movementCredit = MAX_MOVEMENT_CREDIT;
      player.history = [{ at: now, position: copyVector(player.position) }];
    }
  }

  handleReady(session, message, now = Date.now()) {
    const player = this.playerForSession(session);
    if (
      !player ||
      this.phase !== 'loading' ||
      Number(message.roundNumber) !== this.roundNumber
    ) {
      return;
    }
    player.ready = true;
    if (this.players.every((entry) => entry.ready && entry.connected)) {
      this.startRoundIntro(now);
    }
  }

  startRoundIntro(now) {
    if (this.phase !== 'loading') return;
    this.phase = 'roundIntro';
    this.phaseEndsAt = now + this.rules.roundIntroMs;
    this.broadcastPhase(now);
  }

  startCountdown(now) {
    this.resetTake(now);
    this.phase = 'countdown';
    this.phaseEndsAt = now + this.rules.countdownMs;
    this.overtime = false;
    this.broadcastPhase(now);
  }

  startPlaying(now) {
    this.phase = 'playing';
    this.phaseEndsAt = now + this.rules.takeMs;
    this.overtime = false;
    this.nextOvertimeAt = Infinity;
    this.broadcastPhase(now);
  }

  finishTake(winnerSlot, now, reason = 'elimination') {
    if (this.phase !== 'playing') return;
    if (winnerSlot === 0 || winnerSlot === 1) this.takes[winnerSlot] += 1;
    this.phase = 'takeEnd';
    this.pendingResolutionAt = Infinity;
    this.phaseEndsAt = now + this.rules.takeEndMs;
    this.projectiles.length = 0;
    this.broadcast({
      type: 'event',
      event: 'take_end',
      winner: winnerSlot,
      reason,
      takes: [...this.takes],
      takeNumber: this.takeNumber,
    });
    this.broadcastSnapshot(now);
  }

  finishRound(now) {
    const winner = this.takes[0] >= this.rules.takesToWin ? 0 : 1;
    this.rounds[winner] += 1;
    this.phase = 'roundEnd';
    this.phaseEndsAt = now + this.rules.roundEndMs;
    this.broadcast({
      type: 'event',
      event: 'round_end',
      winner,
      rounds: [...this.rounds],
      roundNumber: this.roundNumber,
    });
    this.broadcastSnapshot(now);
  }

  finishMatch(winner, now, reason = 'score') {
    if (this.phase === 'result') return;
    this.winner = winner;
    this.resultReason = reason;
    this.phase = 'result';
    this.phaseEndsAt = Infinity;
    this.projectiles.length = 0;
    this.destroyAt = now + 10 * 60_000;
    this.broadcast({
      type: 'event',
      event: 'match_end',
      winner,
      reason,
      rounds: [...this.rounds],
    });
    this.broadcastSnapshot(now);
  }

  requestRematch(session, now = Date.now()) {
    if (this.phase !== 'result') return;
    const player = this.playerForSession(session);
    if (!player) return;
    player.rematch = true;
    this.broadcast({
      type: 'event',
      event: 'rematch_status',
      ready: this.players.map((entry) => entry.rematch),
    });
    if (
      this.players.every((entry) => entry.connected && entry.rematch)
    ) {
      this.seed = (Math.floor(Math.random() * 0xffffffff) ^ now) >>> 0;
      this.mapOrder = createMapOrder(this.seed);
      this.roundNumber = 1;
      this.takeNumber = 1;
      this.rounds = [0, 0];
      this.takes = [0, 0];
      this.winner = null;
      this.resultReason = null;
      this.destroyAt = Infinity;
      for (const entry of this.players) {
        entry.rematch = false;
        entry.kills = 0;
        entry.deaths = 0;
        entry.assists = 0;
      }
      this.prepareRound(now);
      this.broadcastMatchFound(false);
    }
  }

  handleState(session, message, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || !player.connected || !isFiniteVector(message.position)) return;
    const sequence = Number(message.sequence);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= player.lastSequence ||
      sequence > player.lastSequence + MAX_MESSAGES_AHEAD
    ) {
      return;
    }

    const candidate = clampPositionToMap(this.mapIndex, message.position);
    const deltaSeconds = clamp((now - player.lastStateAt) / 1000, 0, 0.25);
    player.movementCredit = Math.min(
      MAX_MOVEMENT_CREDIT,
      player.movementCredit + MAX_STATE_SPEED * deltaSeconds,
    );
    const movedDistance = Math.sqrt(distanceSquared(candidate, player.position));
    const sliding = Boolean(message.sliding);
    if (
      movedDistance <= player.movementCredit &&
      !bodyIntersectsWorld(this.mapIndex, candidate, sliding) &&
      (movedDistance <= 1 ||
        !bodySweepIntersectsWorld(
          this.mapIndex,
          player.position,
          candidate,
          sliding,
        ))
    ) {
      player.position = candidate;
      player.movementCredit = Math.max(
        0,
        player.movementCredit - movedDistance,
      );
    }

    if (isFiniteVector(message.velocity)) {
      player.velocity = message.velocity.map((value) =>
        clamp(value, -MAX_STATE_SPEED * 1.35, MAX_STATE_SPEED * 1.35),
      );
    }
    player.yaw = safeAngle(message.yaw, player.yaw, -Math.PI * 32, Math.PI * 32);
    player.pitch = safeAngle(message.pitch, player.pitch, -1.5, 1.5);
    player.grounded = Boolean(message.grounded);
    player.sliding = sliding;
    player.wallRunning = Boolean(message.wallRunning);
    player.focused = Boolean(message.focused);
    player.rtt = clamp(Number(session.measuredRtt) || 0, 0, 800);
    player.lastSequence = sequence;
    player.lastStateAt = now;
    player.history.push({ at: now, position: copyVector(player.position) });
    while (
      player.history.length > 2 &&
      player.history[0].at < now - MAX_HISTORY_MS
    ) {
      player.history.shift();
    }
    if (this.phase === 'playing' && player.position[1] < -8 && !player.dead) {
      player.health = 0;
      player.dead = true;
      player.deathAt = now;
      this.creditDeaths(now);
      this.finishTake(this.opponentOf(player).slot, now, 'fall');
    }
  }

  recordDamageSource(target, attackerSlot, damage, now) {
    if (
      damage <= 0 ||
      !Number.isInteger(attackerSlot) ||
      attackerSlot === target.slot ||
      !this.players[attackerSlot]
    ) return;
    target.lastAttackerSlot = attackerSlot;
    target.lastDamageAt = now;
  }

  creditDeaths(now) {
    for (const player of this.players) {
      if (!player.dead || player.deathCredited) continue;
      player.deathCredited = true;
      player.deaths += 1;
      const attacker = this.players[player.lastAttackerSlot];
      if (
        attacker &&
        attacker !== player &&
        now - player.lastDamageAt <= KILL_CREDIT_WINDOW_MS
      ) {
        attacker.kills += 1;
      }
    }
  }

  rewindPosition(player, targetTime) {
    if (!player.history.length) return copyVector(player.position);
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
    const withinTradeWindow =
      shooter?.dead && now <= this.pendingResolutionAt;
    if (
      !shooter ||
      this.phase !== 'playing' ||
      (shooter.dead && !withinTradeWindow)
    ) {
      return;
    }
    const definition = WEAPONS[shooter.weapon];
    if (!definition || Number.isFinite(shooter.reloadEndsAt)) return;
    if (definition.usesAmmo !== false && shooter.ammo <= 0) {
      this.handleReload(session, now);
      return;
    }
    if (now - shooter.lastShotAt < definition.interval * 880) return;

    const shotId = Number(message.shotId);
    if (
      !Number.isSafeInteger(shotId) ||
      shotId <= shooter.lastShotId ||
      shotId > shooter.lastShotId + MAX_MESSAGES_AHEAD
    ) {
      return;
    }
    if (!isFiniteVector(message?.direction)) return;
    const requestedDirection = normalize(message.direction);
    if (!requestedDirection) return;
    const yaw = safeAngle(message.yaw, shooter.yaw, -Math.PI * 32, Math.PI * 32);
    const pitch = safeAngle(message.pitch, shooter.pitch, -1.5, 1.5);
    const expectedDirection = directionFromAngles(yaw, pitch);
    if (dot(requestedDirection, expectedDirection) < 0.995) return;

    shooter.yaw = yaw;
    shooter.pitch = pitch;
    shooter.lastShotId = shotId;
    shooter.lastShotAt = now;
    if (definition.usesAmmo !== false) {
      shooter.ammo = Math.max(0, shooter.ammo - 1);
    }
    const eyeHeight = shooter.sliding ? 0.92 : 1.61;
    const origin = [
      shooter.position[0],
      shooter.position[1] + eyeHeight,
      shooter.position[2],
    ];
    const spread =
      shooter.focused
        ? definition.focusSpread
        : definition.spread *
          (shooter.grounded ? 1 : 1.42) *
          (1 + clamp(Math.hypot(shooter.velocity[0], shooter.velocity[2]) / 12, 0, 0.3));
    const seed =
      (this.seed ^
        Math.imul(this.roundNumber + 1, 1009) ^
        Math.imul(shooter.slot + 3, 7919) ^
        Math.imul(shotId, 2654435761)) >>>
      0;

    if (definition.projectile) {
      const projectile = {
        id: ++this.projectileSequence,
        shotId,
        owner: shooter.slot,
        position: addScaled(origin, requestedDirection, 0.58),
        direction: requestedDirection,
        velocity: requestedDirection.map(
          (component) => component * definition.projectileSpeed,
        ),
        life: 4.2,
        weapon: shooter.weapon,
      };
      this.projectiles.push(projectile);
      this.broadcast({
        type: 'event',
        event: 'shot',
        shooter: shooter.slot,
        shotId,
        weapon: shooter.weapon,
        ammo: shooter.ammo,
        reserve: shooter.reserve,
        origin: roundVector(origin),
        direction: roundVector(requestedDirection),
        projectile: {
          id: projectile.id,
          position: roundVector(projectile.position),
          velocity: roundVector(projectile.velocity),
        },
      });
      return;
    }

    const target = this.opponentOf(shooter);
    target.rewoundPosition = this.rewindPosition(
      target,
      now - clamp(shooter.rtt * 0.5, 0, 200),
    );
    const directions = spreadDirections(
      requestedDirection,
      spread,
      definition.pellets,
      seed,
    );
    const traces = [];
    let totalDamage = 0;
    let hitCount = 0;
    let headshot = false;
    let closestHit = null;
    for (const direction of directions) {
      const result = tracePlayer(
        this.mapIndex,
        origin,
        direction,
        target,
        definition.range,
      );
      traces.push(roundVector(result.point));
      if (!result.target) continue;
      const falloff =
        shooter.weapon === 'ember'
          ? clamp(1.15 - result.distance / 38, 0.32, 1)
          : 1;
      totalDamage +=
        definition.damage *
        falloff *
        (result.headshot ? definition.headMultiplier : 1);
      hitCount += 1;
      headshot ||= result.headshot;
      if (!closestHit || result.distance < closestHit.distance) closestHit = result;
    }
    delete target.rewoundPosition;

    const appliedDamage = Math.min(target.health, totalDamage);
    if (appliedDamage > 0) {
      target.health = Math.max(0, target.health - appliedDamage);
      this.recordDamageSource(target, shooter.slot, appliedDamage, now);
      if (target.health <= 0) {
        target.dead = true;
        target.deathAt = now;
      }
    }
    this.broadcast({
      type: 'event',
      event: 'shot',
      shooter: shooter.slot,
      shotId,
      weapon: shooter.weapon,
      ammo: shooter.ammo,
      reserve: shooter.reserve,
      origin: roundVector(origin),
      direction: roundVector(requestedDirection),
      traces,
      hit: hitCount > 0,
      hitCount,
      headshot,
      damage: Math.round(appliedDamage * 10) / 10,
      hitPoint: closestHit ? roundVector(closestHit.point) : null,
      target: hitCount > 0 ? target.slot : null,
      targetHealth: Math.round(target.health * 10) / 10,
    });

    if (target.dead) {
      this.pendingResolutionAt = Math.min(this.pendingResolutionAt, now + 55);
    }
  }

  handlePickup(session, message, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || this.phase !== 'playing' || player.dead) return;
    const pickupId = Number(message.pickupId);
    const pickup = this.pickups[pickupId];
    if (
      !pickup ||
      !pickup.active ||
      distanceSquared(player.position, pickup.position) > 1.85 * 1.85
    ) {
      return;
    }
    pickup.active = false;
    player.weapon = pickup.type;
    player.ammo = WEAPONS[pickup.type].ammo;
    player.reserve = WEAPONS[pickup.type].reserve;
    player.reloadEndsAt = Infinity;
    player.lastShotAt = -Infinity;
    this.broadcast({
      type: 'event',
      event: 'pickup',
      player: player.slot,
      pickupId,
      weapon: pickup.type,
      ammo: player.ammo,
      reserve: player.reserve,
      at: now,
    });
  }

  handleDiscard(session) {
    const player = this.playerForSession(session);
    if (!player || this.phase !== 'playing' || player.weapon === 'knives') return;
    player.weapon = 'knives';
    player.ammo = WEAPONS.knives.ammo;
    player.reserve = WEAPONS.knives.reserve;
    player.reloadEndsAt = Infinity;
    player.lastShotAt = -Infinity;
    this.broadcast({
      type: 'event',
      event: 'discard',
      player: player.slot,
      weapon: player.weapon,
      ammo: player.ammo,
      reserve: player.reserve,
    });
  }

  handleReload(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || this.phase !== 'playing' || player.dead) return;
    const definition = WEAPONS[player.weapon];
    if (
      !definition ||
      definition.usesAmmo === false ||
      Number.isFinite(player.reloadEndsAt) ||
      player.ammo >= definition.ammo ||
      player.reserve <= 0
    ) {
      return;
    }
    player.reloadEndsAt = now + definition.reloadMs;
    this.broadcast({
      type: 'event',
      event: 'reload_start',
      player: player.slot,
      weapon: player.weapon,
      duration: definition.reloadMs,
    });
  }

  finishReload(player, now) {
    if (!player || !Number.isFinite(player.reloadEndsAt)) return false;
    if (player.dead) {
      player.reloadEndsAt = Infinity;
      return false;
    }
    if (now < player.reloadEndsAt) return false;
    const definition = WEAPONS[player.weapon];
    const needed = Math.max(0, definition.ammo - player.ammo);
    const loaded = Math.min(needed, player.reserve);
    player.ammo += loaded;
    player.reserve -= loaded;
    player.reloadEndsAt = Infinity;
    this.broadcast({
      type: 'event',
      event: 'reload_complete',
      player: player.slot,
      weapon: player.weapon,
      ammo: player.ammo,
      reserve: player.reserve,
    });
    return true;
  }

  updateReloads(now) {
    for (const player of this.players) this.finishReload(player, now);
  }

  explodeProjectile(projectile, position, now) {
    const definition = WEAPONS[projectile.weapon];
    const damage = [];
    for (const player of this.players) {
      if (player.dead) continue;
      const center = [
        player.position[0],
        player.position[1] + 0.9,
        player.position[2],
      ];
      const distance = Math.sqrt(distanceSquared(center, position));
      if (distance >= definition.splashRadius) continue;
      const direction = normalize([
        center[0] - position[0],
        center[1] - position[1],
        center[2] - position[2],
      ]) ?? [0, 1, 0];
      const world = firstWorldHit(
        this.mapIndex,
        addScaled(position, direction, 0.15),
        direction,
        distance,
      );
      if (world.hit && world.distance < distance - 0.22 && distance >= 1.6) continue;
      const falloff = 1 - clamp(distance / definition.splashRadius, 0, 1);
      const ownerScale = player.slot === projectile.owner ? 0.5 : 1;
      const amount = Math.min(
        player.health,
        definition.damage * falloff * ownerScale,
      );
      if (amount <= 0) continue;
      player.health = Math.max(0, player.health - amount);
      this.recordDamageSource(player, projectile.owner, amount, now);
      if (player.health <= 0) player.dead = true;
      const impulse = direction.map((component) => component * 7.5 * falloff);
      impulse[1] = Math.max(3.8 * falloff, impulse[1]);
      player.velocity = player.velocity.map(
        (component, index) => component + impulse[index],
      );
      damage.push({
        player: player.slot,
        amount: Math.round(amount * 10) / 10,
        health: Math.round(player.health * 10) / 10,
        impulse: roundVector(impulse),
      });
    }
    this.broadcast({
      type: 'event',
      event: 'explosion',
      projectileId: projectile.id,
      owner: projectile.owner,
      position: roundVector(position),
      radius: definition.splashRadius,
      damage,
    });
    this.resolveDeaths(now, projectile.owner);
  }

  updateProjectiles(deltaSeconds, now) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= deltaSeconds;
      const distance = Math.hypot(...projectile.velocity) * deltaSeconds;
      const direction = projectile.direction;
      const world = firstWorldHit(
        this.mapIndex,
        projectile.position,
        direction,
        distance + 0.14,
      );
      const target = this.players[projectile.owner === 0 ? 1 : 0];
      const targetDistance = target.dead
        ? null
        : raySphereDistance(
            projectile.position,
            direction,
            [
              target.position[0],
              target.position[1] + 0.9,
              target.position[2],
            ],
            0.66,
          );
      const hitTarget =
        targetDistance != null && targetDistance <= distance + 0.2;
      if (world.hit || hitTarget || projectile.life <= 0) {
        const hitDistance = hitTarget
          ? Math.min(targetDistance, world.distance)
          : world.distance;
        const position =
          projectile.life <= 0 && !world.hit && !hitTarget
            ? projectile.position
            : addScaled(projectile.position, direction, hitDistance);
        this.projectiles.splice(index, 1);
        this.explodeProjectile(projectile, position, now);
        continue;
      }
      projectile.position = addScaled(
        projectile.position,
        projectile.velocity,
        deltaSeconds,
      );
    }
  }

  resolveDeaths(now, preferredWinner = null) {
    this.pendingResolutionAt = Infinity;
    this.creditDeaths(now);
    const dead = this.players.map((player) => player.dead);
    if (dead[0] && dead[1]) this.finishTake(null, now, 'mutual');
    else if (dead[0]) this.finishTake(1, now);
    else if (dead[1]) this.finishTake(0, now);
    else if (preferredWinner != null && this.phase === 'playing') {
      this.broadcastSnapshot(now);
    }
  }

  applyOvertime(now) {
    for (const player of this.players) {
      if (player.dead) continue;
      player.health = Math.max(0, player.health - this.rules.overtimeDamage);
      if (player.health <= 0) player.dead = true;
    }
    this.broadcast({
      type: 'event',
      event: 'overtime_damage',
      health: this.players.map((player) => player.health),
    });
    this.resolveDeaths(now);
  }

  broadcastPhase(now) {
    this.broadcast({
      type: 'event',
      event: 'phase',
      phase: this.phase,
      remaining: Math.max(0, this.phaseEndsAt - now),
      roundNumber: this.roundNumber,
      takeNumber: this.takeNumber,
      mapIndex: this.mapIndex,
    });
    this.broadcastSnapshot(now);
  }

  disconnect(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player || !player.connected) return;
    player.connected = false;
    if (this.phase === 'result') {
      this.destroyAt = Math.min(this.destroyAt, now + 30_000);
      this.broadcastSnapshot(now);
      return;
    }
    if (this.phase !== 'reconnecting') {
      this.pausedPhase = this.phase;
      this.pausedRemaining = Number.isFinite(this.phaseEndsAt)
        ? Math.max(0, this.phaseEndsAt - now)
        : 0;
      this.phase = 'reconnecting';
      this.disconnectDeadline = now + this.rules.reconnectMs;
      this.phaseEndsAt = this.disconnectDeadline;
    }
    this.broadcast({
      type: 'event',
      event: 'opponent_disconnected',
      player: player.slot,
      reconnectMs: this.rules.reconnectMs,
    });
    this.broadcastSnapshot(now);
  }

  reconnect(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player) return false;
    player.session = session;
    player.name = session.name;
    player.connected = true;
    session.room = this;
    session.slot = player.slot;
    this.send(player, {
      type: 'match_found',
      roomId: this.id,
      code: this.code,
      privateMatch: this.privateMatch,
      slot: player.slot,
      opponent: this.opponentOf(player).name,
      seed: this.seed,
      mapOrder: this.mapOrder,
      resumed: true,
      snapshot: this.createSnapshot(now),
    });
    if (
      this.phase === 'reconnecting' &&
      this.players.every((entry) => entry.connected)
    ) {
      this.phase = this.pausedPhase ?? 'playing';
      this.phaseEndsAt = Number.isFinite(this.pausedRemaining)
        ? now + this.pausedRemaining
        : Infinity;
      this.pausedPhase = null;
      this.disconnectDeadline = Infinity;
      this.broadcast({
        type: 'event',
        event: 'opponent_reconnected',
        player: player.slot,
      });
      this.broadcastPhase(now);
    }
    return true;
  }

  leave(session, now = Date.now()) {
    const player = this.playerForSession(session);
    if (!player) return;
    player.connected = false;
    player.session.room = null;
    const opponent = this.opponentOf(player);
    if (opponent.connected) {
      this.rounds[opponent.slot] = this.rules.roundsToWin;
      this.finishMatch(opponent.slot, now, 'forfeit');
    } else {
      this.destroyAt = now;
    }
  }

  createSnapshot(now = Date.now()) {
    const remaining = Number.isFinite(this.phaseEndsAt)
      ? Math.max(0, this.phaseEndsAt - now)
      : 0;
    return {
      serverTime: now,
      phase: this.phase,
      remaining,
      overtime: this.overtime,
      roundNumber: this.roundNumber,
      takeNumber: this.takeNumber,
      rounds: [...this.rounds],
      takes: [...this.takes],
      mapIndex: this.mapIndex,
      mapSeed: this.mapSeed,
      pickups: this.pickups.map((pickup) => ({
        id: pickup.id,
        type: pickup.type,
        active: pickup.active,
      })),
      players: this.players.map((player) => ({
        slot: player.slot,
        name: player.name,
        connected: player.connected,
        ready: player.ready,
        position: roundVector(player.position),
        velocity: roundVector(player.velocity),
        yaw: Math.round(player.yaw * 10_000) / 10_000,
        pitch: Math.round(player.pitch * 10_000) / 10_000,
        health: Math.round(player.health * 10) / 10,
        dead: player.dead,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        weapon: player.weapon,
        ammo: player.ammo,
        reserve: player.reserve,
        reloading: Number.isFinite(player.reloadEndsAt),
        reloadRemaining: Number.isFinite(player.reloadEndsAt)
          ? Math.max(0, player.reloadEndsAt - now)
          : 0,
        grounded: player.grounded,
        sliding: player.sliding,
        wallRunning: player.wallRunning,
        focused: player.focused,
        ack: player.lastSequence,
      })),
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        owner: projectile.owner,
        weapon: projectile.weapon,
        position: roundVector(projectile.position),
        velocity: roundVector(projectile.velocity),
      })),
      winner: this.winner,
      resultReason: this.resultReason,
    };
  }

  broadcastSnapshot(now = Date.now()) {
    while (this.snapshotAt <= now) {
      this.snapshotAt += this.snapshotInterval;
    }
    const payload = {
      type: 'snapshot',
      roomId: this.id,
      state: this.createSnapshot(now),
    };
    const encoded = JSON.stringify(payload);
    for (const player of this.players) {
      if (player?.session?.sendEncoded) {
        player.session.sendEncoded(encoded, { volatile: true });
      } else {
        player?.session?.send(payload);
      }
    }
  }

  update(now = Date.now()) {
    const deltaSeconds = clamp((now - this.updatedAt) / 1000, 0, 0.1);
    this.updatedAt = now;

    if (this.phase === 'reconnecting') {
      if (now >= this.disconnectDeadline) {
        const connected = this.players.find((player) => player.connected);
        if (connected) {
          this.rounds[connected.slot] = this.rules.roundsToWin;
          this.finishMatch(connected.slot, now, 'disconnect');
        } else {
          this.destroyAt = now;
        }
      }
    } else if (this.phase === 'loading' && now >= this.phaseEndsAt) {
      this.startRoundIntro(now);
    } else if (this.phase === 'roundIntro' && now >= this.phaseEndsAt) {
      this.startCountdown(now);
    } else if (this.phase === 'countdown' && now >= this.phaseEndsAt) {
      this.startPlaying(now);
    } else if (this.phase === 'playing') {
      this.updateReloads(now);
      this.updateProjectiles(deltaSeconds, now);
      if (now >= this.pendingResolutionAt) this.resolveDeaths(now);
      if (!this.overtime && now >= this.phaseEndsAt) {
        this.overtime = true;
        this.phaseEndsAt = Infinity;
        this.nextOvertimeAt = now + this.rules.overtimeIntervalMs;
        this.broadcast({
          type: 'event',
          event: 'overtime',
        });
      }
      if (this.overtime && now >= this.nextOvertimeAt) {
        this.nextOvertimeAt += this.rules.overtimeIntervalMs;
        this.applyOvertime(now);
      }
    } else if (this.phase === 'takeEnd' && now >= this.phaseEndsAt) {
      if (this.takes.some((value) => value >= this.rules.takesToWin)) {
        this.finishRound(now);
      } else {
        this.takeNumber += 1;
        this.startCountdown(now);
      }
    } else if (this.phase === 'roundEnd' && now >= this.phaseEndsAt) {
      const winner = this.rounds.findIndex(
        (value) => value >= this.rules.roundsToWin,
      );
      if (winner >= 0) {
        this.finishMatch(winner, now);
      } else {
        this.roundNumber += 1;
        this.prepareRound(now);
      }
    }

    if (now >= this.snapshotAt && this.phase !== 'result') {
      this.broadcastSnapshot(now);
    }
  }

  shouldDestroy(now = Date.now()) {
    return now >= this.destroyAt;
  }

  getSummary() {
    return {
      id: this.id,
      code: this.code,
      privateMatch: this.privateMatch,
      phase: this.phase,
      ageSeconds: Math.round((Date.now() - this.createdAt) / 1000),
      connectedPlayers: this.players.filter((player) => player.connected).length,
    };
  }
}

export function angleDelta(start, end) {
  return shortestAngleDifference(start, end);
}
