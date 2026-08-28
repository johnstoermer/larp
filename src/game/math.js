export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const lerp = (start, end, amount) => start + (end - start) * amount;

export const damp = (current, target, smoothing, delta) =>
  lerp(current, target, 1 - Math.exp(-smoothing * delta));

export const moveToward = (current, target, maxDelta) => {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
};

export const remap = (value, inMin, inMax, outMin, outMax) => {
  const amount = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, amount);
};

export const easeOutCubic = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

export const easeInOutCubic = (value) => {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export const seededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffle = (items, random = Math.random) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

export const formatTime = (seconds) => {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
};

export const circleLineIntersection = (origin, direction, center, radius) => {
  const offsetX = origin.x - center.x;
  const offsetZ = origin.z - center.z;
  const b = offsetX * direction.x + offsetZ * direction.z;
  const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const near = -b - Math.sqrt(discriminant);
  const far = -b + Math.sqrt(discriminant);
  if (far < 0) return null;
  return near >= 0 ? near : far;
};
