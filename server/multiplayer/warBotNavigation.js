const DEFAULT_CELL_SIZE = 3;
const DEFAULT_BODY_RADIUS = 0.62;
const DEFAULT_OBSTACLE_CLEARANCE = 0.8;
const FLOOR_Y = 0.02;

const distanceSquared2d = (first, second) => {
  const x = first[0] - second[0];
  const z = first[2] - second[2];
  return x * x + z * z;
};

function horizontalObstacle(collider, bodyRadius) {
  if (!Array.isArray(collider) || collider.length < 6) return null;
  // Ignore the floor and geometry entirely above a standing combatant. Bounds
  // are enforced separately, so their thin outside walls need no special case.
  if (collider[4] <= FLOOR_Y + 0.04 || collider[1] >= 1.76) return null;
  return [
    collider[0] - bodyRadius,
    collider[2] - bodyRadius,
    collider[3] + bodyRadius,
    collider[5] + bodyRadius,
  ];
}

function segmentIntersectsAabb(start, end, bounds) {
  const directionX = end[0] - start[0];
  const directionZ = end[2] - start[2];
  let minimum = 0;
  let maximum = 1;
  for (const [origin, direction, lower, upper] of [
    [start[0], directionX, bounds[0], bounds[2]],
    [start[2], directionZ, bounds[1], bounds[3]],
  ]) {
    if (Math.abs(direction) < 1e-8) {
      if (origin > lower && origin < upper) continue;
      return false;
    }
    let near = (lower - origin) / direction;
    let far = (upper - origin) / direction;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return false;
  }
  return maximum > 0.001 && minimum < 0.999;
}

class MinHeap {
  constructor() {
    this.entries = [];
  }

  push(index, score) {
    const entry = { index, score };
    this.entries.push(entry);
    let child = this.entries.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      const parentEntry = this.entries[parent];
      if (
        parentEntry.score < score ||
        (parentEntry.score === score && parentEntry.index <= index)
      ) break;
      this.entries[child] = parentEntry;
      child = parent;
    }
    this.entries[child] = entry;
  }

  pop() {
    if (!this.entries.length) return null;
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!this.entries.length) return first;
    let parent = 0;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let child = left;
      if (
        right < this.entries.length &&
        (
          this.entries[right].score < this.entries[left].score ||
          (
            this.entries[right].score === this.entries[left].score &&
            this.entries[right].index < this.entries[left].index
          )
        )
      ) child = right;
      const childEntry = this.entries[child];
      if (
        childEntry.score > last.score ||
        (childEntry.score === last.score && childEntry.index >= last.index)
      ) break;
      this.entries[parent] = childEntry;
      parent = child;
    }
    this.entries[parent] = last;
    return first;
  }
}

export class WarBotNavigator {
  constructor(map, {
    cellSize = DEFAULT_CELL_SIZE,
    bodyRadius = DEFAULT_BODY_RADIUS,
    obstacleClearance = DEFAULT_OBSTACLE_CLEARANCE,
  } = {}) {
    this.map = map;
    this.cellSize = cellSize;
    this.bodyRadius = bodyRadius;
    this.minimumX = -map.bounds.x + bodyRadius;
    this.maximumX = map.bounds.x - bodyRadius;
    this.minimumZ = -map.bounds.z + bodyRadius;
    this.maximumZ = map.bounds.z - bodyRadius;
    this.columns = Math.floor((this.maximumX - this.minimumX) / cellSize) + 1;
    this.rows = Math.floor((this.maximumZ - this.minimumZ) / cellSize) + 1;
    this.obstacles = map.colliders
      // Give A* one extra step of breathing room beyond the physical body.
      // Fixed photo planes are intentionally thin, so a waypoint placed at
      // exact body clearance can otherwise produce a long axis-slide scrape
      // while the bot rounds the visible edge of a wide cutout.
      .map((collider) => horizontalObstacle(collider, obstacleClearance))
      .filter(Boolean);
    this.walkable = new Uint8Array(this.columns * this.rows);
    // A zero entry is unknown, one is traversable, and two is blocked. Thin
    // props can sit completely between two walkable grid centers, so endpoint
    // checks alone are not enough. Cache swept edges lazily for repeated A*.
    this.edgeStates = new Uint8Array(this.columns * this.rows * 8);
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const point = this.point(column, row);
        this.walkable[this.index(column, row)] = this.pointIsWalkable(point) ? 1 : 0;
      }
    }
  }

  index(column, row) {
    return row * this.columns + column;
  }

  cell(index) {
    return [index % this.columns, Math.floor(index / this.columns)];
  }

  point(column, row) {
    return [
      Math.min(this.maximumX, this.minimumX + column * this.cellSize),
      FLOOR_Y,
      Math.min(this.maximumZ, this.minimumZ + row * this.cellSize),
    ];
  }

  pointIsWalkable(point) {
    if (
      point[0] < this.minimumX || point[0] > this.maximumX ||
      point[2] < this.minimumZ || point[2] > this.maximumZ
    ) return false;
    return !this.obstacles.some((bounds) =>
      point[0] > bounds[0] && point[0] < bounds[2] &&
      point[2] > bounds[1] && point[2] < bounds[3]
    );
  }

  segmentIsWalkable(start, end) {
    return this.pointIsWalkable(start) &&
      this.pointIsWalkable(end) &&
      !this.obstacles.some((bounds) => segmentIntersectsAabb(start, end, bounds));
  }

  nearestCell(point) {
    const preferredColumn = Math.max(0, Math.min(
      this.columns - 1,
      Math.round((point[0] - this.minimumX) / this.cellSize),
    ));
    const preferredRow = Math.max(0, Math.min(
      this.rows - 1,
      Math.round((point[2] - this.minimumZ) / this.cellSize),
    ));
    const preferred = this.index(preferredColumn, preferredRow);
    if (this.walkable[preferred]) return preferred;

    const maximumRing = Math.max(this.columns, this.rows);
    for (let ring = 1; ring < maximumRing; ring += 1) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (let row = preferredRow - ring; row <= preferredRow + ring; row += 1) {
        for (let column = preferredColumn - ring; column <= preferredColumn + ring; column += 1) {
          if (
            column < 0 || column >= this.columns ||
            row < 0 || row >= this.rows ||
            (Math.abs(column - preferredColumn) !== ring &&
              Math.abs(row - preferredRow) !== ring)
          ) continue;
          const index = this.index(column, row);
          if (!this.walkable[index]) continue;
          const candidateDistance = distanceSquared2d(this.point(column, row), point);
          if (candidateDistance < nearestDistance) {
            nearest = index;
            nearestDistance = candidateDistance;
          }
        }
      }
      if (nearest != null) return nearest;
    }
    return null;
  }

  nearestWalkablePoint(point) {
    if (this.pointIsWalkable(point)) return [point[0], FLOOR_Y, point[2]];
    const cell = this.nearestCell(point);
    if (cell == null) return [point[0], FLOOR_Y, point[2]];
    const [column, row] = this.cell(cell);
    return this.point(column, row);
  }

  edgeIsWalkable(index, next, directionIndex) {
    const stateIndex = index * 8 + directionIndex;
    const cached = this.edgeStates[stateIndex];
    if (cached) return cached === 1;
    const [column, row] = this.cell(index);
    const [nextColumn, nextRow] = this.cell(next);
    const clear = this.segmentIsWalkable(
      this.point(column, row),
      this.point(nextColumn, nextRow),
    );
    this.edgeStates[stateIndex] = clear ? 1 : 2;
    const reverseDirection = [3, 2, 1, 0, 7, 6, 5, 4][directionIndex];
    this.edgeStates[next * 8 + reverseDirection] = clear ? 1 : 2;
    return clear;
  }

  findPath(start, requestedGoal) {
    const goal = this.nearestWalkablePoint(requestedGoal);
    if (this.segmentIsWalkable(start, goal)) return [goal];
    const startIndex = this.nearestCell(start);
    const goalIndex = this.nearestCell(goal);
    if (startIndex == null || goalIndex == null) return [goal];

    const total = this.columns * this.rows;
    const costs = new Float64Array(total);
    costs.fill(Infinity);
    const parents = new Int32Array(total);
    parents.fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();
    const [goalColumn, goalRow] = this.cell(goalIndex);
    costs[startIndex] = 0;
    heap.push(startIndex, 0);
    const neighbors = [
      [0, -1, 1], [-1, 0, 1], [1, 0, 1], [0, 1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
    ];

    while (heap.entries.length) {
      const current = heap.pop();
      if (!current || closed[current.index]) continue;
      if (current.index === goalIndex) break;
      closed[current.index] = 1;
      const [column, row] = this.cell(current.index);
      for (const [directionIndex, neighbor] of neighbors.entries()) {
        const [offsetColumn, offsetRow, travel] = neighbor;
        const nextColumn = column + offsetColumn;
        const nextRow = row + offsetRow;
        if (
          nextColumn < 0 || nextColumn >= this.columns ||
          nextRow < 0 || nextRow >= this.rows
        ) continue;
        const next = this.index(nextColumn, nextRow);
        if (!this.walkable[next] || closed[next]) continue;
        if (offsetColumn && offsetRow) {
          if (
            !this.walkable[this.index(column + offsetColumn, row)] ||
            !this.walkable[this.index(column, row + offsetRow)]
          ) continue;
        }
        if (!this.edgeIsWalkable(current.index, next, directionIndex)) continue;
        const nextCost = costs[current.index] + travel;
        if (nextCost >= costs[next] - 1e-8) continue;
        costs[next] = nextCost;
        parents[next] = current.index;
        const heuristic = Math.hypot(goalColumn - nextColumn, goalRow - nextRow);
        heap.push(next, nextCost + heuristic);
      }
    }

    if (goalIndex !== startIndex && parents[goalIndex] < 0) return [goal];
    const reversed = [];
    for (let cursor = goalIndex; cursor !== startIndex && cursor >= 0; cursor = parents[cursor]) {
      const [column, row] = this.cell(cursor);
      reversed.push(this.point(column, row));
    }
    reversed.reverse();
    if (!reversed.length) return [goal];
    reversed[reversed.length - 1] = goal;

    const smoothed = [];
    let anchor = start;
    let cursor = 0;
    while (cursor < reversed.length) {
      let furthest = cursor;
      for (let candidate = cursor + 1; candidate < reversed.length; candidate += 1) {
        if (!this.segmentIsWalkable(anchor, reversed[candidate])) break;
        furthest = candidate;
      }
      smoothed.push(reversed[furthest]);
      anchor = reversed[furthest];
      cursor = furthest + 1;
    }
    return smoothed;
  }
}

export function createWarBotNavigator(map, options) {
  return new WarBotNavigator(map, options);
}
