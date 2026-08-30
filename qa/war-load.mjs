import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../server/multiplayer/config.js';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const durationMs = Number(process.env.LARP_WAR_LOAD_DURATION || 4_000);
const clientCount = 80;
const classIds = [
  'knives',
  'shortbow',
  'ember',
  'crossbow',
  'greatsword',
  'lightning',
  'longbow',
  'fireball',
];
const wsUrl = new URL('/ws', baseUrl);
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

function directionFromYaw(yaw) {
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}

function createClient(index) {
  const requestedClass = classIds[index % classIds.length];
  const socket = new WebSocket(wsUrl);
  const state = {
    index,
    requestedClass,
    socket,
    matched: false,
    roomId: null,
    slot: null,
    team: null,
    sequence: 0,
    shotId: 0,
    position: [0, 0.02, 0],
    yaw: 0,
    snapshots: 0,
    latestSnapshot: null,
    errors: [],
    wireBytesStart: 0,
  };

  socket.on('open', () => {
    socket.send(JSON.stringify({
      type: 'hello',
      version: PROTOCOL_VERSION,
      name: `WAR LOAD ${String(index).padStart(2, '0')}`,
    }));
  });
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      state.errors.push(`JSON: ${error.message}`);
      return;
    }
    if (message.type === 'welcome') {
      socket.send(JSON.stringify({
        type: 'war_play',
        classId: requestedClass,
      }));
    } else if (message.type === 'war_found') {
      state.matched = true;
      state.roomId = message.roomId;
      state.slot = message.slot;
      state.team = message.team;
      const local = message.snapshot?.combatants?.find(
        (combatant) => combatant.id === state.slot,
      );
      if (!local) {
        state.errors.push('war_found omitted the local combatant');
        return;
      }
      state.position = [...local.position];
      state.yaw = local.yaw;
      if (local.classId !== requestedClass) {
        state.errors.push(`requested ${requestedClass}, received ${local.classId}`);
      }
    } else if (message.type === 'war_snapshot') {
      state.snapshots += 1;
      state.latestSnapshot = message.state;
      const local = message.state?.combatants?.find(
        (combatant) => combatant.id === state.slot,
      );
      if (local) {
        state.position = [...local.position];
        state.yaw = local.yaw;
      }
    } else if (message.type === 'error') {
      state.errors.push(message.code || message.message || 'server error');
    } else if (message.type === 'left_match') {
      state.left = true;
    }
  });
  socket.on('error', (error) => state.errors.push(error.message));
  return state;
}

const startedAt = performance.now();
const clients = Array.from({ length: clientCount }, (_, index) => createClient(index));
const matchDeadline = Date.now() + 15_000;
while (clients.some((client) => !client.matched) && Date.now() < matchDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

const matchedCount = clients.filter((client) => client.matched).length;
if (matchedCount !== clientCount) {
  for (const client of clients) client.socket.close(1000, 'LOAD_ABORTED');
  throw new Error(`Only ${matchedCount}/${clientCount} War clients joined.`);
}

for (const client of clients) {
  client.snapshots = 0;
  client.latestSnapshot = null;
  client.wireBytesStart = client.socket._socket?.bytesRead ?? 0;
}

const inputTimer = setInterval(() => {
  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.sequence += 1;
    client.socket.send(JSON.stringify({
      type: 'war_state',
      sequence: client.sequence,
      position: client.position,
      velocity: [0, 0, 0],
      yaw: client.yaw,
      pitch: 0,
      focused: false,
      rtt: 20,
    }));
  }
}, 50);

const shotTimer = setInterval(() => {
  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.shotId += 1;
    client.socket.send(JSON.stringify({
      type: 'war_shoot',
      shotId: client.shotId,
      direction: directionFromYaw(client.yaw),
      yaw: client.yaw,
      pitch: 0,
    }));
  }
}, 1_000);

await new Promise((resolve) => setTimeout(resolve, durationMs));
clearInterval(inputTimer);
clearInterval(shotTimer);

const status = await fetch(new URL('/api/status', baseUrl)).then((response) => response.json());
const representative = clients.find((client) => client.latestSnapshot)?.latestSnapshot;
const teamCounts = [0, 1].map(
  (team) => representative?.combatants?.filter((combatant) => combatant.team === team).length ?? 0,
);
const humanCount = representative?.combatants?.filter((combatant) => combatant.human).length ?? 0;
const selectedClassCounts = Object.fromEntries(classIds.map((classId) => [classId, 0]));
for (const combatant of representative?.combatants ?? []) {
  if (combatant.human && combatant.classId in selectedClassCounts) {
    selectedClassCounts[combatant.classId] += 1;
  }
}
const roomIds = new Set(clients.map((client) => client.roomId));
const wireBytes = clients.map((client) =>
  Math.max(0, (client.socket._socket?.bytesRead ?? 0) - client.wireBytesStart));
const report = {
  baseUrl,
  clientCount,
  durationMs,
  elapsedMs: Math.round(performance.now() - startedAt),
  roomCount: roomIds.size,
  teamCounts,
  humanCount,
  selectedClassCounts,
  snapshots: clients.reduce((total, client) => total + client.snapshots, 0),
  minimumSnapshots: Math.min(...clients.map((client) => client.snapshots)),
  maximumSnapshots: Math.max(...clients.map((client) => client.snapshots)),
  errors: clients.flatMap((client) => client.errors),
  compressionNegotiated: clients.every((client) =>
    client.socket.extensions.includes('permessage-deflate')),
  wireBytes: {
    total: wireBytes.reduce((total, bytes) => total + bytes, 0),
    averagePerClient: Math.round(
      wireBytes.reduce((total, bytes) => total + bytes, 0) / wireBytes.length,
    ),
    maximumPerClient: Math.max(...wireBytes),
    averageBytesPerSecondPerClient: Math.round(
      wireBytes.reduce((total, bytes) => total + bytes, 0) /
        wireBytes.length / (durationMs / 1_000),
    ),
  },
  status,
};

console.log(JSON.stringify(report, null, 2));
await writeFile(
  new URL('../artifacts/war-load-report.json', import.meta.url),
  JSON.stringify(report, null, 2),
);

for (const client of clients) {
  if (client.socket.readyState === WebSocket.OPEN) {
    client.socket.send(JSON.stringify({ type: 'leave' }));
  }
}
const leaveDeadline = Date.now() + 3_000;
while (clients.some((client) => !client.left) && Date.now() < leaveDeadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
for (const client of clients) client.socket.close(1000, 'WAR_LOAD_COMPLETE');

if (report.roomCount !== 1) throw new Error(`Expected one War room, found ${report.roomCount}.`);
if (teamCounts[0] !== 40 || teamCounts[1] !== 40) {
  throw new Error(`War team allocation regressed: ${JSON.stringify(teamCounts)}.`);
}
if (humanCount !== 80 || status.warHumans !== 80 || status.warRooms !== 1) {
  throw new Error(`War did not retain 80 live humans: ${JSON.stringify({ humanCount, status })}.`);
}
for (const classId of classIds) {
  if (selectedClassCounts[classId] !== 10) {
    throw new Error(`War class allocation regressed: ${JSON.stringify(selectedClassCounts)}.`);
  }
}
if (report.minimumSnapshots < Math.max(20, Math.floor(durationMs / 140))) {
  throw new Error(`War snapshot delivery fell behind: ${report.minimumSnapshots}.`);
}
if (report.errors.length) throw new Error(`War protocol errors: ${report.errors.join(', ')}`);
if (clients.some((client) => !client.left)) {
  throw new Error('War load clients did not leave cleanly before teardown.');
}
if (!report.compressionNegotiated) {
  throw new Error('War load clients did not negotiate WebSocket compression.');
}
if (report.wireBytes.averageBytesPerSecondPerClient > 80_000) {
  throw new Error(`War egress exceeded 80 KiB/s per client: ${JSON.stringify(report.wireBytes)}.`);
}
if (status.tickDriftMs > 12 || status.maxTickDriftMs > 100) {
  throw new Error(`War tick drift exceeded budget: ${JSON.stringify(status)}.`);
}
