import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  SERVER_TICK_RATE,
  sanitizeName,
} from './config.js';
import { Room } from './Room.js';

const ROOM_ALPHABET = '346789ABCDEFGHJKMNPQRTUVWXY';
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 100;

function createRoomCode() {
  let result = '';
  for (let index = 0; index < 5; index += 1) {
    result += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return result;
}

function normalizeRoomCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}

export class MultiplayerHub {
  constructor(server, options = {}) {
    this.rooms = new Set();
    this.sessions = new Map();
    this.quickQueue = [];
    this.privateLobbies = new Map();
    this.bytesSent = 0;
    this.messagesReceived = 0;
    this.startedAt = Date.now();
    this.lastTickAt = this.startedAt;
    this.tickDrift = 0;
    this.maxTickDrift = 0;
    this.roomRules = options.roomRules;
    this.wss = new WebSocketServer({
      noServer: true,
      clientTracking: true,
      perMessageDeflate: false,
      maxPayload: MAX_MESSAGE_BYTES,
    });

    this.handleUpgrade = (request, socket, head) => {
      let pathname = '';
      try {
        pathname = new URL(request.url, 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (websocket) => {
        this.wss.emit('connection', websocket, request);
      });
    };
    server.on('upgrade', this.handleUpgrade);
    this.server = server;
    this.wss.on('connection', (socket) => this.attachSocket(socket));

    const tickDelay = Math.min(
      30,
      Math.max(8, Math.floor(1000 / SERVER_TICK_RATE)),
    );
    this.tickTimer = setInterval(() => this.update(), tickDelay);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 15_000);
  }

  attachSocket(socket) {
    socket.isAlive = true;
    socket.session = null;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    const helloTimeout = setTimeout(() => {
      if (!socket.session && socket.readyState === 1) socket.close(4000, 'HELLO_REQUIRED');
    }, 5000);

    socket.on('message', (raw, binary) => {
      if (binary || raw.length > MAX_MESSAGE_BYTES) {
        socket.close(4002, 'INVALID_MESSAGE');
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(4002, 'INVALID_MESSAGE');
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      if (!socket.session) {
        if (message.type !== 'hello') {
          socket.close(4000, 'HELLO_REQUIRED');
          return;
        }
        clearTimeout(helloTimeout);
        this.handleHello(socket, message);
        return;
      }
      if (!this.consumeRateLimit(socket.session)) return;
      this.messagesReceived += 1;
      this.handleMessage(socket.session, message);
    });
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      this.handleDisconnect(socket);
    });
    socket.on('error', () => {
      // The close handler owns cleanup.
    });
  }

  createSession(socket, token, name) {
    const session = {
      token,
      name,
      socket,
      connected: true,
      room: null,
      slot: null,
      queued: false,
      privateCode: null,
      disconnectedAt: 0,
      rateWindowAt: Date.now(),
      rateCount: 0,
      send: (payload) => this.send(session, payload),
      sendEncoded: (encoded) => this.sendEncoded(session, encoded),
    };
    socket.session = session;
    this.sessions.set(token, session);
    return session;
  }

  handleHello(socket, message) {
    if (Number(message.version) !== PROTOCOL_VERSION) {
      this.sendSocket(socket, {
        type: 'error',
        code: 'VERSION_MISMATCH',
        message: 'The game was updated. Reload before joining a match.',
        expectedVersion: PROTOCOL_VERSION,
      });
      socket.close(4003, 'VERSION_MISMATCH');
      return;
    }
    const requestedToken = String(message.token ?? '').slice(0, 80);
    const existing = requestedToken ? this.sessions.get(requestedToken) : null;
    const name = sanitizeName(message.name);
    let session;
    if (existing) {
      session = existing;
      const previousSocket = session.socket;
      session.socket = socket;
      session.connected = true;
      session.disconnectedAt = 0;
      session.name = name;
      session.rateWindowAt = Date.now();
      session.rateCount = 0;
      socket.session = session;
      if (previousSocket && previousSocket !== socket && previousSocket.readyState === 1) {
        previousSocket.close(4001, 'SESSION_MOVED');
      }
    } else {
      session = this.createSession(socket, randomUUID(), name);
    }
    this.send(session, {
      type: 'welcome',
      token: session.token,
      name: session.name,
      protocol: PROTOCOL_VERSION,
      serverTime: Date.now(),
      online: this.connectedCount,
    });
    if (session.room) session.room.reconnect(session);
  }

  consumeRateLimit(session) {
    const now = Date.now();
    if (now - session.rateWindowAt >= 1000) {
      session.rateWindowAt = now;
      session.rateCount = 0;
    }
    session.rateCount += 1;
    if (session.rateCount <= MAX_MESSAGES_PER_SECOND) return true;
    this.send(session, {
      type: 'error',
      code: 'RATE_LIMIT',
      message: 'Input rate exceeded.',
    });
    return false;
  }

  handleMessage(session, message) {
    const now = Date.now();
    if (message.type === 'ping') {
      this.send(session, {
        type: 'pong',
        sentAt: Number(message.sentAt) || 0,
        serverTime: now,
      });
      return;
    }
    if (message.type === 'quick_play') {
      this.joinQuickQueue(session);
      return;
    }
    if (message.type === 'create_private') {
      this.createPrivateLobby(session);
      return;
    }
    if (message.type === 'join_private') {
      this.joinPrivateLobby(session, message.code);
      return;
    }
    if (message.type === 'cancel_queue') {
      this.removeFromQueues(session);
      this.send(session, { type: 'queue_status', status: 'idle' });
      return;
    }
    if (message.type === 'leave') {
      this.leaveRoom(session, now);
      return;
    }
    if (!session.room) return;
    if (message.type === 'ready') session.room.handleReady(session, message, now);
    else if (message.type === 'state') session.room.handleState(session, message, now);
    else if (message.type === 'shoot') session.room.handleShot(session, message, now);
    else if (message.type === 'pickup') session.room.handlePickup(session, message, now);
    else if (message.type === 'reload') session.room.handleReload(session, now);
    else if (message.type === 'discard') session.room.handleDiscard(session);
    else if (message.type === 'rematch') session.room.requestRematch(session, now);
  }

  joinQuickQueue(session) {
    if (session.room) return;
    this.removeFromQueues(session);
    const opponentIndex = this.quickQueue.findIndex(
      (candidate) =>
        candidate !== session &&
        candidate.connected &&
        !candidate.room,
    );
    if (opponentIndex >= 0) {
      const [opponent] = this.quickQueue.splice(opponentIndex, 1);
      opponent.queued = false;
      session.queued = false;
      this.createRoom([opponent, session]);
      return;
    }
    session.queued = true;
    this.quickQueue.push(session);
    this.send(session, {
      type: 'queue_status',
      status: 'searching',
      position: this.quickQueue.length,
      online: this.connectedCount,
    });
  }

  createPrivateLobby(session) {
    if (session.room) return;
    this.removeFromQueues(session);
    let code;
    do {
      code = createRoomCode();
    } while (this.privateLobbies.has(code));
    session.privateCode = code;
    this.privateLobbies.set(code, session);
    this.send(session, {
      type: 'private_created',
      code,
      invitePath: `?room=${code}`,
    });
  }

  joinPrivateLobby(session, requestedCode) {
    if (session.room) return;
    const code = normalizeRoomCode(requestedCode);
    const host = this.privateLobbies.get(code);
    if (!host || !host.connected || host.room || host === session) {
      this.send(session, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'That room is no longer available.',
      });
      return;
    }
    this.removeFromQueues(session);
    this.privateLobbies.delete(code);
    host.privateCode = null;
    session.privateCode = null;
    this.createRoom([host, session], code, true);
  }

  createRoom(sessions, code = null, privateMatch = false) {
    const room = new Room({
      sessions,
      code,
      privateMatch,
      rules: this.roomRules,
    });
    this.rooms.add(room);
    return room;
  }

  removeFromQueues(session) {
    session.queued = false;
    this.quickQueue = this.quickQueue.filter((candidate) => candidate !== session);
    if (
      session.privateCode &&
      this.privateLobbies.get(session.privateCode) === session
    ) {
      this.privateLobbies.delete(session.privateCode);
    }
    session.privateCode = null;
  }

  leaveRoom(session, now = Date.now()) {
    this.removeFromQueues(session);
    if (session.room) {
      const room = session.room;
      room.leave(session, now);
      session.room = null;
      session.slot = null;
    }
    this.send(session, { type: 'left_match' });
  }

  handleDisconnect(socket) {
    const session = socket.session;
    if (!session || session.socket !== socket) return;
    session.connected = false;
    session.disconnectedAt = Date.now();
    session.socket = null;
    this.removeFromQueues(session);
    if (session.room) session.room.disconnect(session, session.disconnectedAt);
  }

  sendSocket(socket, payload) {
    if (socket.readyState !== 1) return false;
    const encoded = JSON.stringify(payload);
    return this.sendSocketEncoded(socket, encoded);
  }

  sendSocketEncoded(socket, encoded) {
    if (socket.readyState !== 1) return false;
    this.bytesSent += Buffer.byteLength(encoded);
    socket.send(encoded);
    return true;
  }

  send(session, payload) {
    if (!session?.socket) return false;
    return this.sendSocket(session.socket, payload);
  }

  sendEncoded(session, encoded) {
    if (!session?.socket) return false;
    return this.sendSocketEncoded(session.socket, encoded);
  }

  heartbeat() {
    for (const socket of this.wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }

  update(now = Date.now()) {
    const targetTickMs = 1000 / SERVER_TICK_RATE;
    const drift = Math.max(0, now - this.lastTickAt - targetTickMs);
    this.lastTickAt = now;
    this.tickDrift = this.tickDrift * 0.94 + drift * 0.06;
    this.maxTickDrift = Math.max(this.maxTickDrift * 0.999, drift);
    for (const room of this.rooms) {
      room.update(now);
      if (!room.shouldDestroy(now)) continue;
      this.rooms.delete(room);
      for (const player of room.players) {
        if (player.session?.room === room) {
          player.session.room = null;
          player.session.slot = null;
        }
      }
    }
    for (const [token, session] of this.sessions) {
      if (
        !session.connected &&
        !session.room &&
        now - session.disconnectedAt > 10 * 60_000
      ) {
        this.sessions.delete(token);
      }
    }
  }

  get connectedCount() {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.connected) count += 1;
    }
    return count;
  }

  getStats() {
    return {
      status: 'ok',
      protocol: PROTOCOL_VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      connections: this.connectedCount,
      queued: this.quickQueue.length,
      privateLobbies: this.privateLobbies.size,
      rooms: this.rooms.size,
      activeMatches: [...this.rooms].filter(
        (room) => !['result', 'reconnecting'].includes(room.phase),
      ).length,
      messagesReceived: this.messagesReceived,
      bytesSent: this.bytesSent,
      tickRate: SERVER_TICK_RATE,
      tickDriftMs: Math.round(this.tickDrift * 100) / 100,
      maxTickDriftMs: Math.round(this.maxTickDrift * 100) / 100,
    };
  }

  close() {
    clearInterval(this.tickTimer);
    clearInterval(this.heartbeatTimer);
    this.server.off('upgrade', this.handleUpgrade);
    for (const socket of this.wss.clients) socket.terminate();
    this.wss.close();
  }
}
