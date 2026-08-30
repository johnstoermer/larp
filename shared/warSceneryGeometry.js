// Fixed photographic cutouts are planes, not full 3D carts, tents, or huts.
// Eight centimetres keeps the authoritative wall robust for ray/sweep tests
// while remaining visually faithful to the rendered plane.
export const FIXED_PHOTO_PROP_PLANE_DEPTH = 0.08;
export const FIXED_PHOTO_PROP_QUARTER_TURN = Math.PI / 2;

export function quantizeFixedPhotoPropYaw(yaw = 0) {
  const numericYaw = Number.isFinite(yaw) ? yaw : 0;
  const quantized = Math.round(
    numericYaw / FIXED_PHOTO_PROP_QUARTER_TURN,
  ) * FIXED_PHOTO_PROP_QUARTER_TURN;
  return Object.is(quantized, -0) ? 0 : quantized;
}

export function rotatedFootprintExtents(width, depth, yaw = 0) {
  const cosine = Math.abs(Math.cos(yaw));
  const sine = Math.abs(Math.sin(yaw));
  return [
    cosine * width + sine * depth,
    sine * width + cosine * depth,
  ];
}

export function rotatedFootprintBounds(
  position,
  width,
  depth,
  collisionHeight,
  yaw = 0,
) {
  const [extentX, extentZ] = rotatedFootprintExtents(width, depth, yaw);
  return [
    position[0] - extentX / 2,
    position[1],
    position[2] - extentZ / 2,
    position[0] + extentX / 2,
    position[1] + collisionHeight,
    position[2] + extentZ / 2,
  ];
}

export function fixedPhotoPropCollisionBounds(
  position,
  width,
  collisionHeight,
  yaw = 0,
) {
  const fixedYaw = quantizeFixedPhotoPropYaw(yaw);
  return rotatedFootprintBounds(
    position,
    width,
    FIXED_PHOTO_PROP_PLANE_DEPTH,
    collisionHeight,
    fixedYaw,
  );
}
