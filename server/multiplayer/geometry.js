import { MAPS, clamp, seededRandom } from './config.js';

const EPSILON = 1e-7;

export function isFiniteVector(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component))
  );
}

export function addScaled(origin, direction, distance) {
  return [
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  ];
}

export function distanceSquared(a, b) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

export function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < EPSILON) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function directionFromAngles(yaw, pitch) {
  const horizontal = Math.cos(pitch);
  return [
    -Math.sin(yaw) * horizontal,
    Math.sin(pitch),
    -Math.cos(yaw) * horizontal,
  ];
}

export function raySphereDistance(origin, direction, center, radius) {
  const offset = [
    origin[0] - center[0],
    origin[1] - center[1],
    origin[2] - center[2],
  ];
  const b = dot(offset, direction);
  const c = dot(offset, offset) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const far = -b + root;
  if (far < 0) return null;
  return near >= 0 ? near : far;
}

export function rayAabbDistance(origin, direction, box, maxDistance = Infinity) {
  let near = 0;
  let far = maxDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = box[axis];
    const maximum = box[axis + 3];
    if (Math.abs(direction[axis]) < EPSILON) {
      if (origin[axis] < minimum || origin[axis] > maximum) return null;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (minimum - origin[axis]) * inverse;
    let second = (maximum - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}

export function firstWorldHit(mapIndex, origin, direction, maxDistance) {
  let distance = maxDistance;
  let hit = false;
  for (const collider of MAPS[mapIndex].colliders) {
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

export function bodyIntersectsWorld(mapIndex, position, sliding = false) {
  const radius = 0.4;
  const height = sliding ? 1.12 : 1.76;
  for (const collider of MAPS[mapIndex].colliders) {
    if (
      position[0] + radius > collider[0] &&
      position[0] - radius < collider[3] &&
      position[1] + height > collider[1] + 0.025 &&
      position[1] + 0.025 < collider[4] &&
      position[2] + radius > collider[2] &&
      position[2] - radius < collider[5]
    ) {
      return true;
    }
  }
  return false;
}

export function bodySweepIntersectsWorld(
  mapIndex,
  start,
  end,
  sliding = false,
) {
  const movement = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ];
  const distance = Math.hypot(...movement);
  if (distance < 0.001) return false;
  const direction = movement.map((component) => component / distance);
  const radius = 0.4;
  const height = sliding ? 1.12 : 1.76;
  for (const collider of MAPS[mapIndex].colliders) {
    const expanded = [
      collider[0] - radius,
      collider[1] - height + 0.025,
      collider[2] - radius,
      collider[3] + radius,
      collider[4] - 0.025,
      collider[5] + radius,
    ];
    const contact = rayAabbDistance(start, direction, expanded, distance);
    if (contact != null && contact < distance - 0.02) return true;
  }
  return false;
}

export function spreadDirections(baseDirection, spread, count, seed) {
  if (spread <= 0) return Array.from({ length: count }, () => baseDirection);
  const random = seededRandom(seed);
  let right = normalize([baseDirection[2], 0, -baseDirection[0]]);
  if (!right) right = [1, 0, 0];
  const up = normalize([
    right[1] * baseDirection[2] - right[2] * baseDirection[1],
    right[2] * baseDirection[0] - right[0] * baseDirection[2],
    right[0] * baseDirection[1] - right[1] * baseDirection[0],
  ]);
  const directions = [];
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * spread;
    directions.push(
      normalize([
        baseDirection[0] +
          right[0] * Math.cos(angle) * radius +
          up[0] * Math.sin(angle) * radius,
        baseDirection[1] +
          right[1] * Math.cos(angle) * radius +
          up[1] * Math.sin(angle) * radius,
        baseDirection[2] +
          right[2] * Math.cos(angle) * radius +
          up[2] * Math.sin(angle) * radius,
      ]),
    );
  }
  return directions;
}

export function tracePlayer(mapIndex, origin, direction, target, range) {
  const world = firstWorldHit(mapIndex, origin, direction, range);
  if (!target || target.dead) return { ...world, target: false, headshot: false };
  const rewound = target.rewoundPosition ?? target.position;
  const headCenter = [rewound[0], rewound[1] + 1.57, rewound[2]];
  const bodyCenter = [rewound[0], rewound[1] + 0.9, rewound[2]];
  const headDistance = raySphereDistance(origin, direction, headCenter, 0.32);
  const bodyDistance = raySphereDistance(origin, direction, bodyCenter, 0.57);
  let distance = null;
  let headshot = false;
  if (headDistance != null && headDistance < world.distance) {
    distance = headDistance;
    headshot = true;
  }
  if (
    bodyDistance != null &&
    bodyDistance < world.distance &&
    (distance == null || bodyDistance < distance)
  ) {
    distance = bodyDistance;
    headshot = false;
  }
  if (distance == null) return { ...world, target: false, headshot: false };
  return {
    hit: true,
    target: true,
    headshot,
    distance,
    point: addScaled(origin, direction, distance),
  };
}

export function clampPositionToMap(mapIndex, position) {
  const bounds = MAPS[mapIndex].bounds - 0.45;
  return [
    clamp(position[0], -bounds, bounds),
    clamp(position[1], -9, 8),
    clamp(position[2], -bounds, bounds),
  ];
}
