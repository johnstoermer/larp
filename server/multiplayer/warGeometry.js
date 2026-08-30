import { CHARACTER_HITBOX } from '../../shared/characterHitbox.js';
import { WAR_MAP } from '../../shared/warConfig.js';
import {
  addScaled,
  distanceSquared,
  normalize,
  rayAabbDistance,
  raySphereDistance,
} from './geometry.js';

const BODY_RADIUS = 0.45;
const BODY_HEIGHT = 1.76;
const FLOOR_Y = 0.02;
const MAX_Y = 8;
const CONTACT_EPSILON = 1e-7;

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

// rayAabbDistance reports zero both when a sweep enters a box at its surface
// and when it starts on that surface and travels away. Only the former should
// block movement. Tangential motion is also safe because the body remains in
// contact without crossing into the expanded collider.
function entersExpandedColliderFromContact(start, direction, expanded) {
  let touchesFace = false;
  let movesInward = false;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = expanded[axis];
    const maximum = expanded[axis + 3];
    if (Math.abs(start[axis] - minimum) <= CONTACT_EPSILON) {
      touchesFace = true;
      if (direction[axis] < -CONTACT_EPSILON) return false;
      if (direction[axis] > CONTACT_EPSILON) movesInward = true;
    }
    if (Math.abs(start[axis] - maximum) <= CONTACT_EPSILON) {
      touchesFace = true;
      if (direction[axis] > CONTACT_EPSILON) return false;
      if (direction[axis] < -CONTACT_EPSILON) movesInward = true;
    }
  }
  // Preserve the conservative behavior for an invalid start already inside a
  // collider; this exception is only for valid surface contact.
  return !touchesFace || movesInward;
}

export function clampWarPosition(position) {
  return [
    clamp(position[0], -WAR_MAP.bounds.x + BODY_RADIUS, WAR_MAP.bounds.x - BODY_RADIUS),
    clamp(position[1], FLOOR_Y, MAX_Y),
    clamp(position[2], -WAR_MAP.bounds.z + BODY_RADIUS, WAR_MAP.bounds.z - BODY_RADIUS),
  ];
}

export function warBodyIntersectsWorld(position) {
  for (const collider of WAR_MAP.colliders) {
    if (
      position[0] + BODY_RADIUS > collider[0] &&
      position[0] - BODY_RADIUS < collider[3] &&
      position[1] + BODY_HEIGHT > collider[1] + 0.025 &&
      position[1] + 0.025 < collider[4] &&
      position[2] + BODY_RADIUS > collider[2] &&
      position[2] - BODY_RADIUS < collider[5]
    ) {
      return true;
    }
  }
  return false;
}

export function warBodySweepIntersectsWorld(start, end) {
  const movement = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ];
  const distance = Math.hypot(...movement);
  if (distance < 0.001) return false;
  const direction = movement.map((component) => component / distance);
  for (const collider of WAR_MAP.colliders) {
    const expanded = [
      collider[0] - BODY_RADIUS,
      collider[1] - BODY_HEIGHT + 0.025,
      collider[2] - BODY_RADIUS,
      collider[3] + BODY_RADIUS,
      collider[4] - 0.025,
      collider[5] + BODY_RADIUS,
    ];
    const contact = rayAabbDistance(start, direction, expanded, distance);
    if (
      contact != null &&
      contact <= CONTACT_EPSILON &&
      !entersExpandedColliderFromContact(start, direction, expanded)
    ) continue;
    if (contact != null && contact < distance - 0.02) return true;
  }
  return false;
}

// Moves an upright player body through the War map. Axis fallbacks make bots and
// corrected client states slide along rectangular cover instead of entering it.
export function moveWarBody(start, requested) {
  const candidate = clampWarPosition(requested);
  if (
    !warBodyIntersectsWorld(candidate) &&
    !warBodySweepIntersectsWorld(start, candidate)
  ) {
    return candidate;
  }

  const alongX = clampWarPosition([candidate[0], start[1], start[2]]);
  if (
    !warBodyIntersectsWorld(alongX) &&
    !warBodySweepIntersectsWorld(start, alongX)
  ) {
    return alongX;
  }

  const alongZ = clampWarPosition([start[0], start[1], candidate[2]]);
  if (
    !warBodyIntersectsWorld(alongZ) &&
    !warBodySweepIntersectsWorld(start, alongZ)
  ) {
    return alongZ;
  }
  return [...start];
}

export function firstWarWorldHit(origin, direction, maxDistance) {
  let distance = maxDistance;
  let hit = false;
  for (const collider of WAR_MAP.colliders) {
    const candidate = rayAabbDistance(origin, direction, collider, distance);
    if (candidate == null || candidate >= distance) continue;
    distance = candidate;
    hit = true;
  }
  return {
    hit,
    distance,
    point: addScaled(origin, direction, distance),
  };
}

function combatantHit(origin, direction, combatant) {
  const position = combatant.rewoundPosition ?? combatant.position;
  const bodyDistance = raySphereDistance(
    origin,
    direction,
    [
      position[0],
      position[1] + CHARACTER_HITBOX.body.offsetY,
      position[2],
    ],
    CHARACTER_HITBOX.body.radius,
  );
  const headDistance = raySphereDistance(
    origin,
    direction,
    [
      position[0],
      position[1] + CHARACTER_HITBOX.head.offsetY,
      position[2],
    ],
    CHARACTER_HITBOX.head.radius,
  );
  if (bodyDistance == null && headDistance == null) return null;
  if (bodyDistance == null) return { distance: headDistance, headshot: true };
  if (headDistance == null) return { distance: bodyDistance, headshot: false };
  return headDistance < bodyDistance
    ? { distance: headDistance, headshot: true }
    : { distance: bodyDistance, headshot: false };
}

export function traceWarCombatants({
  origin,
  direction,
  range,
  team,
  combatants,
}) {
  const world = firstWarWorldHit(origin, direction, range);
  let target = null;
  let distance = world.distance;
  let headshot = false;
  for (const combatant of combatants) {
    if (combatant.team === team || combatant.dead) continue;
    const candidate = combatantHit(origin, direction, combatant);
    if (!candidate || candidate.distance >= distance) continue;
    target = combatant;
    distance = candidate.distance;
    headshot = candidate.headshot;
  }
  return {
    target,
    distance,
    headshot,
    point: addScaled(origin, direction, distance),
    worldHit: !target && world.hit,
  };
}

export function hasWarLineOfSight(source, target) {
  const origin = [source.position[0], source.position[1] + 1.25, source.position[2]];
  const center = [target.position[0], target.position[1] + 1, target.position[2]];
  const distance = Math.sqrt(distanceSquared(origin, center));
  const direction = normalize([
    center[0] - origin[0],
    center[1] - origin[1],
    center[2] - origin[2],
  ]);
  if (!direction) return true;
  const world = firstWarWorldHit(origin, direction, distance);
  return !world.hit || world.distance >= distance - BODY_RADIUS;
}

export { distanceSquared };
