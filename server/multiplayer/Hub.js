import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  SERVER_TICK_RATE,
  sanitizeName,
} from './config.js';
import { Room } from './Room.js';
import { WarRoom } from './WarRoom.js';
import {
  ARENA_2V2_COMBATANT_COUNT,
  ARENA_2V2_MODE,
  arena2v2TeamForSlot,
} from '../../shared/arena2v2Config.js';
import {
  WAR_MODE_CONTROL,
  WAR_MODE_IDS,
  WAR_RULES,
  normalizeWarMode,
} from '../../shared/warConfig.js';

const ROOM_ALPHABET = '346789ABCDEFGHJKMNPQRTUVWXY';
const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_SECOND = 100;
const MAX_REALTIME_BUFFERED_BYTES = 16_384;
const MAX_CONNECTIONS = 120;
const MAX_CONNECTIONS_PER_IP = 32;
const MAX_ADMISSION_RECORDS = 2_048;
const MAX_NEW_SESSIONS_PER_MINUTE = 40;
const MAX_SESSION_RECORDS = 512;
const MAX_ARENA_ROOMS = 40;
const MAX_WAR_ROOMS_PER_MODE = 1;
const MAX_WAR_ROOMS = MAX_WAR_ROOMS_PER_MODE * WAR_MODE_IDS.length;
const IDLE_SESSION_TTL_MS = 30_000;
const WAR_REJOIN_COOLDOWN_MS = WAR_RULES.respawnMs;

function allowedWebSocketOrigin(origin) {
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const configured = String(process.env.LARP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes(parsed.origin)) return true;
  if (parsed.hostname === 'herm.cool' || parsed.hostname.endsWith('.herm.cool')) return true;
  if (parsed.hostname === 'hermcool-larp.fly.dev') return true;
  if (process.env.NODE_ENV !== 'production') {
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  }
  return false;
}

function clientAddress(request) {
  const flyAddress = request?.headers?.['fly-client-ip'];
  if (typeof flyAddress === 'string' && flyAddress) return flyAddress;
  const forwarded = request?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return request?.socket?.remoteAddress || 'unknown';
}

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

function createArena2v2BotSession(slot) {
  return {
    token: `arena-bot-${randomUUID()}`,
    name: `Bot ${slot + 1}`,
    bot: true,
    room: null,
    slot,
    team: arena2v2TeamForSlot(slot),
    connected: false,
    send() {},
    sendEncoded() {},
  };
}

export class MultiplayerHub {
  constructor(server, options = {}) {
    this.rooms = new Set();
    this.sessions = new Map();
    this.ipConnections = new Map();
    this.newSessionAdmissions = new Map();
    this.quickQueue = [];
    this.privateLobbies = new Map();
    this.bytesSent = 0;
    this.messagesReceived = 0;
    this.realtimeMessagesDropped = 0;
    this.startedAt = Date.now();
    this.lastTickAt = this.startedAt;
    this.tickDrift = 0;
    this.maxTickDrift = 0;
    this.roomRules = options.roomRules;
    this.warRules = options.warRules;
    this.wss = new WebSocketServer({
      noServer: true,
      clientTracking: true,
      perMessageDeflate: {
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
        serverMaxWindowBits: false,
        concurrencyLimit: 10,
        threshold: 1_024,
        zlibDeflateOptions: { level: 1, memLevel: 7 },
      },
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
      if (!allowedWebSocketOrigin(request.headers.origin)) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (websocket) => {
        this.wss.emit('connection', websocket, request);
      });
    };
    server.on('upgrade', this.handleUpgrade);
    this.server = server;
    this.wss.on('connection', (socket, request) => {
      if (this.wss.clients.size > MAX_CONNECTIONS) {
        socket.close(1013, 'SERVER_CAPACITY');
        return;
      }
      const address = clientAddress(request);
      const addressCount = this.ipConnections.get(address) ?? 0;
      if (
        process.env.NODE_ENV === 'production' &&
        addressCount >= MAX_CONNECTIONS_PER_IP
      ) {
        socket.close(1008, 'IP_CAPACITY');
        return;
      }
      this.ipConnections.set(address, addressCount + 1);
      socket.clientAddress = address;
      socket.once('close', () => {
        const remaining = (this.ipConnections.get(address) ?? 1) - 1;
        if (remaining > 0) this.ipConnections.set(address, remaining);
        else this.ipConnections.delete(address);
      });
      this.attachSocket(socket);
    });

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
      if (socket.session && Number.isFinite(socket.lastPingAt)) {
        const sample = Math.max(0, Date.now() - socket.lastPingAt);
        const previous = Number(socket.session.measuredRtt) || 0;
        socket.session.measuredRtt = previous > 0
          ? Math.round((previous * 0.7 + sample * 0.3) * 10) / 10
          : sample;
        socket.lastPingAt = null;
      }
    });
    const helloTimeout = setTimeout(() => {
      if (!socket.session && socket.readyState === 1) socket.close(4000, 'HELLO_REQUIRED');
    }, 5000);

    socket.on('message', (raw, binary) => {
      if (binary || raw.length > MAX_MESSAGE_BYTES) {
        socket.close(4002, 'INVALID_MESSAGE');
        return;
      }
      if (socket.session && !this.consumeRateLimit(socket.session)) return;
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
    this.pruneSessions(Date.now(), true);
    if (this.sessions.size >= MAX_SESSION_RECORDS) {
      this.sendSocket(socket, {
        type: 'error',
        code: 'SERVER_CAPACITY',
        message: 'The match service is at capacity.',
      });
      socket.close(1013, 'SERVER_CAPACITY');
      return null;
    }
    const session = {
      token,
      name,
      socket,
      connected: true,
      room: null,
      slot: null,
      team: null,
      queued: false,
      privateCode: null,
      disconnectedAt: 0,
      measuredRtt: 0,
      compression: String(socket.extensions ?? '').includes('permessage-deflate'),
      warJoinedAt: 0,
      warRejoinAfter: 0,
      nextSocketMigrationAt: 0,
      rateWindowAt: Date.now(),
      rateCount: 0,
      send: (payload) => this.send(session, payload),
      sendEncoded: (encoded, options) =>
        this.sendEncoded(session, encoded, options),
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
    const socketCompression = String(socket.extensions ?? '').includes('permessage-deflate');
    if (existing?.room?.mode === 'war' && !socketCompression) {
      this.sendSocket(socket, {
        type: 'error',
        code: 'WAR_COMPRESSION_REQUIRED',
        message: 'War requires WebSocket compression.',
      });
      socket.close(4004, 'WAR_COMPRESSION_REQUIRED');
      return;
    }
    const helloNow = Date.now();
    if (existing && helloNow < (existing.nextSocketMigrationAt || 0)) {
      this.sendSocket(socket, {
        type: 'error',
        code: 'RECONNECT_RATE',
        message: 'Reconnect is already in progress.',
      });
      socket.close(4009, 'RECONNECT_RATE');
      return;
    }
    let session;
    if (existing) {
      session = existing;
      const previousSocket = session.socket;
      session.socket = socket;
      session.connected = true;
      session.disconnectedAt = 0;
      session.name = name;
      if (helloNow - session.rateWindowAt >= 1_000) {
        session.rateWindowAt = helloNow;
        session.rateCount = 0;
      }
      session.compression = socketCompression;
      session.nextSocketMigrationAt = helloNow + 2_000;
      socket.session = session;
      if (previousSocket && previousSocket !== socket && previousSocket.readyState === 1) {
        previousSocket.close(4001, 'SESSION_MOVED');
      }
    } else {
      if (!this.admitNewSession(socket.clientAddress, helloNow)) {
        this.sendSocket(socket, {
          type: 'error',
          code: 'SESSION_RATE',
          message: 'Too many new sessions. Try again shortly.',
        });
        socket.close(4008, 'SESSION_RATE');
        return;
      }
      session = this.createSession(socket, randomUUID(), name);
      if (!session) return;
    }
    const activeMatch = Boolean(session.room);
    this.send(session, {
      type: 'welcome',
      token: session.token,
      name: session.name,
      protocol: PROTOCOL_VERSION,
      serverTime: Date.now(),
      online: this.connectedCount,
      activeMatch,
    });
    const resumed = activeMatch
      ? Boolean(session.room.reconnect(session))
      : false;
    if (!resumed) {
      session.room = null;
      session.slot = null;
      session.team = null;
    }
    this.send(session, { type: 'resume_status', active: resumed });
    if (socket.readyState === 1 && typeof socket.ping === 'function') {
      socket.lastPingAt = Date.now();
      socket.ping();
    }
  }

  consumeRateLimit(session) {
    const now = Date.now();
    if (now - session.rateWindowAt >= 1000) {
      session.rateWindowAt = now;
      session.rateCount = 0;
    }
    session.rateCount += 1;
    if (session.rateCount <= MAX_MESSAGES_PER_SECOND) return true;
    if (session.rateCount === MAX_MESSAGES_PER_SECOND + 1) {
      this.send(session, {
        type: 'error',
        code: 'RATE_LIMIT',
        message: 'Input rate exceeded.',
      });
    }
    if (session.rateCount >= MAX_MESSAGES_PER_SECOND * 2) {
      session.socket?.close?.(4008, 'RATE_LIMIT');
    }
    return false;
  }

  pruneSessions(now = Date.now(), force = false) {
    for (const [token, session] of this.sessions) {
      if (session.connected || session.room) continue;
      const expired = now - session.disconnectedAt > IDLE_SESSION_TTL_MS;
      if (!expired && !(force && this.sessions.size >= MAX_SESSION_RECORDS)) continue;
      this.sessions.delete(token);
      if (force && this.sessions.size < MAX_SESSION_RECORDS) break;
    }
    for (const [address, record] of this.newSessionAdmissions) {
      if (now - record.startedAt >= 60_000) this.newSessionAdmissions.delete(address);
    }
  }

  admitNewSession(address = 'unknown', now = Date.now()) {
    if (process.env.NODE_ENV !== 'production') return true;
    const current = this.newSessionAdmissions.get(address);
    if (!current && this.newSessionAdmissions.size >= MAX_ADMISSION_RECORDS) return false;
    const record = !current || now - current.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : current;
    if (record.count >= MAX_NEW_SESSIONS_PER_MINUTE) return false;
    record.count += 1;
    this.newSessionAdmissions.set(address, record);
    return true;
  }

  handleMessage(session, message) {
    const now = Date.now();
    if (message.type === 'ping') {
      this.send(session, {
        type: 'pong',
        sequence: Number.isSafeInteger(message.sequence) ? message.sequence : 0,
        sentAt: Number(message.sentAt) || 0,
        serverTime: now,
      });
      return;
    }
    if (message.type === 'quick_play') {
      this.joinQuickQueue(session);
      return;
    }
    if (message.type === 'arena_2v2_play') {
      this.joinArena2v2(session, now);
      return;
    }
    if (message.type === 'war_play') {
      this.joinWar(
        session,
        message.classId,
        now,
        message.warMode ?? message.variant ?? WAR_MODE_CONTROL,
      );
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
    if (session.room.mode === 'war') {
      if (message.type === 'war_state') {
        session.room.handleState(session, message, now);
      } else if (message.type === 'war_shoot') {
        session.room.handleShot(session, message, now);
      } else if (
        message.type === 'war_select_class' ||
        message.type === 'war_class'
      ) {
        session.room.handleSelectClass(session, message, now);
      } else if (message.type === 'war_reload') {
        session.room.handleReload(session, now);
      }
      return;
    }
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

  joinArena2v2(session, now = Date.now()) {
    if (session.room) return;
    this.removeFromQueues(session);
    let room = [...this.rooms].find((candidate) =>
      candidate.mode === ARENA_2V2_MODE && candidate.canJoin(now)
    );
    if (!room) {
      const arenaRoomCount = [...this.rooms].filter(
        (candidate) => candidate.mode !== 'war',
      ).length;
      if (arenaRoomCount >= MAX_ARENA_ROOMS) {
        this.send(session, {
          type: 'error',
          code: 'ARENA_CAPACITY',
          message: 'Arena is at capacity. Try again shortly.',
        });
        return;
      }
      const sessions = [session];
      for (let slot = 1; slot < ARENA_2V2_COMBATANT_COUNT; slot += 1) {
        sessions.push(createArena2v2BotSession(slot));
      }
      room = new Room({
        sessions,
        teamMode: true,
        rules: this.roomRules,
        now,
      });
      this.rooms.add(room);
      return;
    }
    if (!room.addSession(session, now)) {
      this.send(session, {
        type: 'error',
        code: 'ARENA_FULL',
        message: 'Arena 2v2 is full. Try again.',
      });
    }
  }

  joinWar(
    session,
    classId,
    now = Date.now(),
    requestedWarMode = WAR_MODE_CONTROL,
  ) {
    if (session.room) return;
    this.removeFromQueues(session);
    if (!session.compression) {
      this.send(session, {
        type: 'error',
        code: 'WAR_COMPRESSION_REQUIRED',
        message: 'War requires WebSocket compression.',
      });
      return;
    }
    if (now < (session.warRejoinAfter || 0)) {
      this.send(session, {
        type: 'error',
        code: 'WAR_REJOIN_DELAY',
        message: 'Wait for the respawn interval before rejoining War.',
      });
      return;
    }
    const warMode = normalizeWarMode(requestedWarMode);
    let room = [...this.rooms].find(
      (candidate) =>
        candidate.mode === 'war' &&
        candidate.warMode === warMode &&
        candidate.canJoin(now),
    );
    if (!room) {
      const warRoomCount = [...this.rooms].filter(
        (candidate) =>
          candidate.mode === 'war' &&
          candidate.warMode === warMode &&
          candidate.phase !== 'result',
      ).length;
      if (warRoomCount >= MAX_WAR_ROOMS_PER_MODE) {
        this.send(session, {
          type: 'error',
          code: 'WAR_CAPACITY',
          message: 'War is at capacity. Try again shortly.',
        });
        return;
      }
      room = new WarRoom({ rules: this.warRules, now, warMode });
      this.rooms.add(room);
    }
    const player = room.addSession(session, classId, now);
    if (player) {
      session.warJoinedAt = now;
      session.warRejoinAfter = 0;
      return;
    }
    if (room.connectedHumans().length === 0) this.rooms.delete(room);
    this.send(session, {
      type: 'error',
      code: 'WAR_FULL',
      message: 'War is full. Try again.',
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
    const arenaRoomCount = [...this.rooms].filter(
      (candidate) => candidate.mode !== 'war',
    ).length;
    if (arenaRoomCount >= MAX_ARENA_ROOMS) {
      for (const session of sessions) {
        this.send(session, {
          type: 'error',
          code: 'ARENA_CAPACITY',
          message: 'Arena is at capacity. Try again shortly.',
        });
      }
      return null;
    }
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
      const activeWar = room.mode === 'war' && room.phase !== 'result';
      room.leave(session, now);
      if (activeWar) session.warRejoinAfter = now + WAR_REJOIN_COOLDOWN_MS;
      else if (room.mode === 'war') session.warRejoinAfter = 0;
      session.room = null;
      session.slot = null;
      session.team = null;
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

  sendSocketEncoded(socket, encoded, { volatile = false } = {}) {
    if (socket.readyState !== 1) return false;
    if (volatile && socket.bufferedAmount > MAX_REALTIME_BUFFERED_BYTES) {
      this.realtimeMessagesDropped += 1;
      return false;
    }
    this.bytesSent += Buffer.byteLength(encoded);
    socket.send(encoded);
    return true;
  }

  send(session, payload) {
    if (!session?.socket) return false;
    return this.sendSocket(session.socket, payload);
  }

  sendEncoded(session, encoded, options) {
    if (!session?.socket) return false;
    return this.sendSocketEncoded(session.socket, encoded, options);
  }

  heartbeat() {
    for (const socket of this.wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.lastPingAt = Date.now();
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
          player.session.team = null;
        }
      }
    }
    this.pruneSessions(now);
  }

  get connectedCount() {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.connected) count += 1;
    }
    return count;
  }

  getStats() {
    const rooms = [...this.rooms];
    const warRooms = rooms.filter((room) => room.mode === 'war');
    const arenaRooms = rooms.filter((room) => room.mode !== 'war');
    const arena2v2Rooms = rooms.filter((room) => room.mode === ARENA_2V2_MODE);
    return {
      status: 'ok',
      protocol: PROTOCOL_VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      connections: this.connectedCount,
      queued: this.quickQueue.length,
      privateLobbies: this.privateLobbies.size,
      rooms: this.rooms.size,
      arenaRooms: arenaRooms.length,
      arena2v2Rooms: arena2v2Rooms.length,
      arena2v2Humans: arena2v2Rooms.reduce(
        (total, room) => total + room.connectedHumans().length,
        0,
      ),
      warRooms: warRooms.length,
      warRoomsByMode: Object.fromEntries(WAR_MODE_IDS.map((warMode) => [
        warMode,
        warRooms.filter((room) => room.warMode === warMode).length,
      ])),
      warHumans: warRooms.reduce(
        (total, room) => total + room.connectedHumans().length,
        0,
      ),
      activeMatches: rooms.filter(
        (room) => !['result', 'reconnecting'].includes(room.phase),
      ).length,
      messagesReceived: this.messagesReceived,
      realtimeMessagesDropped: this.realtimeMessagesDropped,
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

export {
  MAX_ADMISSION_RECORDS,
  MAX_ARENA_ROOMS,
  MAX_CONNECTIONS,
  MAX_NEW_SESSIONS_PER_MINUTE,
  MAX_REALTIME_BUFFERED_BYTES,
  MAX_SESSION_RECORDS,
  MAX_WAR_ROOMS,
  MAX_WAR_ROOMS_PER_MODE,
  allowedWebSocketOrigin,
};
