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
