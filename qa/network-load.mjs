import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const clientCount = Number(process.env.LARP_LOAD_CLIENTS || 24);
const durationMs = Number(process.env.LARP_LOAD_DURATION || 5000);
const wsUrl = new URL('/ws', baseUrl);
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

function createClient(index) {
  const socket = new WebSocket(wsUrl);
  const state = {
    index,
    socket,
    token: '',
    slot: null,
    roomId: null,
    matched: false,
    snapshots: 0,
    sequence: 0,
    position: [0, 0.02, 0],
    yaw: 0,
    errors: [],
  };
  socket.on('open', () => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        version: 4,
        name: `LOAD ${String(index).padStart(2, '0')}`,
      }),
    );
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'welcome') {
      state.token = message.token;
      socket.send(JSON.stringify({ type: 'quick_play' }));
    } else if (message.type === 'match_found') {
      state.matched = true;
      state.slot = message.slot;
      state.roomId = message.roomId;
      const player = message.snapshot.players[message.slot];
      state.position = [...player.position];
      state.yaw = player.yaw;
      socket.send(
        JSON.stringify({
          type: 'ready',
          roundNumber: message.snapshot.roundNumber,
        }),
      );
    } else if (message.type === 'snapshot') {
      state.snapshots += 1;
      const player = message.state.players[state.slot];
      if (player) {
        state.position = [...player.position];
        state.yaw = player.yaw;
      }
    } else if (message.type === 'error') {
      state.errors.push(message.code);
    }
  });
  socket.on('error', (error) => state.errors.push(error.message));
  return state;
}

const startedAt = performance.now();
const clients = Array.from({ length: clientCount }, (_, index) =>
  createClient(index),
);
const matchDeadline = Date.now() + 12_000;
while (
  clients.some((client) => !client.matched) &&
  Date.now() < matchDeadline
) {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
if (clients.some((client) => !client.matched)) {
  throw new Error(
    `Only ${clients.filter((client) => client.matched).length}/${clientCount} clients matched.`,
  );
}

const inputTimer = setInterval(() => {
  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    client.sequence += 1;
    client.socket.send(
      JSON.stringify({
        type: 'state',
        sequence: client.sequence,
        position: client.position,
        velocity: [0, 0, 0],
        yaw: client.yaw,
        pitch: 0,
        grounded: true,
        sliding: false,
        wallRunning: false,
        focused: false,
        rtt: 20,
      }),
    );
  }
}, 1000 / 30);

await new Promise((resolve) => setTimeout(resolve, durationMs));
clearInterval(inputTimer);
const status = await fetch(new URL('/api/status', baseUrl)).then((response) =>
  response.json(),
);
const finishedAt = performance.now();
const report = {
  baseUrl,
  clientCount,
  roomCount: new Set(clients.map((client) => client.roomId)).size,
  durationMs: Math.round(finishedAt - startedAt),
  snapshots: clients.reduce((total, client) => total + client.snapshots, 0),
  minimumSnapshots: Math.min(...clients.map((client) => client.snapshots)),
  errors: clients.flatMap((client) => client.errors),
  status,
};
console.log(JSON.stringify(report, null, 2));
await writeFile(
  new URL('../artifacts/network-load-report.json', import.meta.url),
  JSON.stringify(report, null, 2),
);

for (const client of clients) client.socket.close(1000, 'LOAD_COMPLETE');
if (report.roomCount !== clientCount / 2) {
  throw new Error(`Expected ${clientCount / 2} rooms, found ${report.roomCount}.`);
}
if (report.minimumSnapshots < Math.max(20, durationMs / 100)) {
  throw new Error(`Snapshot delivery fell behind: ${report.minimumSnapshots}.`);
}
if (report.errors.length) throw new Error(`Protocol errors: ${report.errors.join(', ')}`);
if (status.tickDriftMs > 10 || status.maxTickDriftMs > 80) {
  throw new Error(`Server tick drift exceeded budget: ${JSON.stringify(status)}`);
}
