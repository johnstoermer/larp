import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ADMISSION_RECORDS,
  MAX_ARENA_ROOMS,
  MAX_NEW_SESSIONS_PER_MINUTE,
  MAX_SESSION_RECORDS,
  MAX_WAR_ROOMS,
  MultiplayerHub,
  allowedWebSocketOrigin,
} from '../server/multiplayer/Hub.js';
import { WarRoom } from '../server/multiplayer/WarRoom.js';

function createHub() {
  const hub = Object.create(MultiplayerHub.prototype);
  hub.rooms = new Set();
  hub.quickQueue = [];
  hub.privateLobbies = new Map();
  hub.warRules = { unlockMs: 0 };
  hub.sessions = new Map();
  hub.newSessionAdmissions = new Map();
  hub.messagesReceived = 0;
  hub.send = (session, payload) => {
    session.messages.push(payload);
    return true;
  };
  return hub;
}

function createSession(index) {
  const messages = [];
  return {
    token: `war-${index}`,
    name: `Player ${index}`,
    room: null,
    slot: null,
    team: null,
    queued: false,
    privateCode: null,
    connected: true,
    compression: true,
    messages,
    send(payload) {
      messages.push(payload);
      return true;
    },
    sendEncoded(encoded) {
      messages.push(JSON.parse(encoded));
      return true;
    },
  };
}

test('war_play joins one additive War room without entering the Arena queue', () => {
  const hub = createHub();
  const sessions = Array.from({ length: 5 }, (_, index) => createSession(index));
  sessions.forEach((session, index) => {
    MultiplayerHub.prototype.handleMessage.call(hub, session, {
      type: 'war_play',
      classId: index % 2 ? 'greatsword' : 'lightning',
    });
  });

  assert.equal(hub.rooms.size, 1);
  assert.equal(hub.quickQueue.length, 0);
  const room = [...hub.rooms][0];
  assert.ok(room instanceof WarRoom);
  assert.equal(room.mode, 'war');
  assert.deepEqual(room.getSummary().teamHumans, [3, 2]);
  assert.ok(sessions.every((session) => session.room === room));
  assert.ok(sessions.every((session) =>
    session.messages.some((message) => message.type === 'war_found')
  ));
});

test('mode-scoped War input routes to War handlers and generic Arena input is ignored', () => {
  const hub = createHub();
  const session = createSession(1);
  hub.joinWar(session, 'shortbow', 1_000);
  const room = session.room;
  const player = room.playerForSession(session);
  const spawn = [...player.position];

  MultiplayerHub.prototype.handleMessage.call(hub, session, {
    type: 'state',
    sequence: 1,
    position: [spawn[0] + 0.2, spawn[1], spawn[2]],
    velocity: [1, 0, 0],
  });
  assert.equal(player.lastSequence, 0, 'Arena state must not enter a War room');

  MultiplayerHub.prototype.handleMessage.call(hub, session, {
    type: 'war_state',
    sequence: 1,
    position: [spawn[0] + 0.2, spawn[1], spawn[2]],
    velocity: [1, 0, 0],
    yaw: 0,
    pitch: 0,
  });
  assert.equal(player.lastSequence, 1);

  MultiplayerHub.prototype.handleMessage.call(hub, session, {
    type: 'war_select_class',
    classId: 'greatsword',
  });
  assert.equal(player.pendingClassId, 'greatsword');
});

test('leaving War frees the human slot and preserves the 80-bot room body', () => {
  const hub = createHub();
  const session = createSession(2);
  hub.joinWar(session, 'crossbow', 2_000);
  const room = session.room;
  assert.equal(room.connectedHumans().length, 1);

  hub.leaveRoom(session, 2_100);
  assert.equal(session.room, null);
  assert.equal(session.slot, null);
  assert.equal(session.team, null);
  assert.equal(room.connectedHumans().length, 0);
  assert.equal(room.players.length, 80);
  assert.ok(session.messages.some((message) => message.type === 'left_match'));
});

test('leaving War hands the live wounded combatant to a bot without healing it', () => {
  const hub = createHub();
  const session = createSession(3);
  hub.joinWar(session, 'crossbow', 2_200);
  const room = session.room;
  const player = room.playerForSession(session);
  player.health = 1;
  player.ammo = 2;
  player.position = [17, 0.02, -9];

  hub.leaveRoom(session, 2_300);

  assert.equal(player.bot, true);
  assert.equal(player.classId, 'crossbow');
  assert.equal(player.health, 1);
  assert.equal(player.ammo, 2);
  assert.deepEqual(player.position, [17, 0.02, -9]);
});

test('one full War room rejects overflow instead of allocating another 80-bot room', () => {
  const hub = createHub();
  const room = new WarRoom({ now: 2_500, seed: 73 });
  for (let index = 0; index < 80; index += 1) {
    assert.ok(room.addSession(createSession(100 + index), 'shortbow', 2_501 + index));
  }
  hub.rooms.add(room);
  const overflow = createSession(999);

  hub.joinWar(overflow, 'greatsword', 3_000);

  assert.equal(MAX_WAR_ROOMS, 1);
  assert.equal(hub.rooms.size, 1);
  assert.equal(overflow.room, null);
  assert.equal(overflow.messages.at(-1).code, 'WAR_CAPACITY');
});

test('War requires compression and rate-limits voluntary re-entry', () => {
  const hub = createHub();
  const uncompressed = createSession(800);
  uncompressed.compression = false;
  hub.joinWar(uncompressed, 'shortbow', 4_000);
  assert.equal(uncompressed.room, null);
  assert.equal(uncompressed.messages.at(-1).code, 'WAR_COMPRESSION_REQUIRED');

  const session = createSession(801);
  hub.joinWar(session, 'shortbow', 4_100);
  const room = session.room;
  assert.ok(room);
  hub.leaveRoom(session, 4_200);
  assert.equal(session.room, null);
  hub.joinWar(session, 'shortbow', 4_201);
  assert.equal(session.room, null);
  assert.equal(session.messages.at(-1).code, 'WAR_REJOIN_DELAY');
  hub.joinWar(session, 'shortbow', 12_200);
  assert.equal(session.room, room);
});

test('a completed War room does not block the next match', () => {
  const hub = createHub();
  const completed = new WarRoom({ now: 13_000, seed: 80 });
  completed.phase = 'result';
  completed.winner = 0;
  hub.rooms.add(completed);
  const session = createSession(802);

  hub.joinWar(session, 'greatsword', 13_100);

  assert.ok(session.room);
  assert.notEqual(session.room, completed);
  assert.equal(session.room.phase, 'locked');
  assert.equal([...hub.rooms].filter((room) => room.phase !== 'result').length, 1);
});

test('rate limiting rejects before parse, warns once, and closes a sustained flood', () => {
  const hub = createHub();
  let closes = 0;
  const session = createSession(9);
  session.rateWindowAt = Date.now();
  session.rateCount = 0;
  session.socket = {
    close(code, reason) {
      closes += 1;
      assert.equal(code, 4008);
      assert.equal(reason, 'RATE_LIMIT');
    },
  };

  for (let index = 0; index < 100; index += 1) {
    assert.equal(hub.consumeRateLimit(session), true);
  }
  for (let index = 100; index < 199; index += 1) {
    assert.equal(hub.consumeRateLimit(session), false);
  }
  assert.equal(
    session.messages.filter((message) => message.code === 'RATE_LIMIT').length,
    1,
  );
  assert.equal(closes, 0);
  assert.equal(hub.consumeRateLimit(session), false);
  assert.equal(closes, 1);
});

test('WebSocket origins and retained sessions have hard admission bounds', () => {
  assert.equal(allowedWebSocketOrigin('https://herm.cool'), true);
  assert.equal(allowedWebSocketOrigin('https://play.herm.cool'), true);
  assert.equal(allowedWebSocketOrigin('https://evil.example'), false);
  assert.equal(allowedWebSocketOrigin('not a url'), false);

  const hub = createHub();
  for (let index = 0; index < MAX_SESSION_RECORDS; index += 1) {
    hub.sessions.set(`retained-${index}`, {
      connected: false,
      room: { id: index },
      disconnectedAt: 0,
    });
  }
  const clientSocket = {
    extensions: 'permessage-deflate',
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
  hub.sendSocket = (target, payload) => {
    target.sent = payload;
    return true;
  };

  const created = hub.createSession(clientSocket, 'overflow', 'Overflow');
  assert.equal(created, null);
  assert.equal(hub.sessions.size, MAX_SESSION_RECORDS);
  assert.equal(clientSocket.sent.code, 'SERVER_CAPACITY');
  assert.deepEqual(clientSocket.closed, { code: 1013, reason: 'SERVER_CAPACITY' });
});

test('production new-session admission records and per-address churn stay bounded', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const hub = createHub();
    for (let index = 0; index < MAX_ADMISSION_RECORDS; index += 1) {
      hub.newSessionAdmissions.set(`198.51.100.${index}`, {
        startedAt: 10_000,
        count: 1,
      });
    }
    assert.equal(hub.admitNewSession('203.0.113.1', 10_001), false);
    assert.equal(hub.newSessionAdmissions.size, MAX_ADMISSION_RECORDS);

    hub.newSessionAdmissions.clear();
    for (let index = 0; index < MAX_NEW_SESSIONS_PER_MINUTE; index += 1) {
      assert.equal(hub.admitNewSession('203.0.113.2', 20_000 + index), true);
    }
    assert.equal(hub.admitNewSession('203.0.113.2', 20_999), false);
    hub.pruneSessions(80_001);
    assert.equal(hub.newSessionAdmissions.size, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Arena room creation stops at its process resource ceiling', () => {
  const hub = createHub();
  for (let index = 0; index < MAX_ARENA_ROOMS; index += 1) {
    hub.rooms.add({ mode: 'arena', id: `arena-${index}` });
  }
  const first = createSession(910);
  const second = createSession(911);
  assert.equal(hub.createRoom([first, second]), null);
  assert.equal(first.messages.at(-1).code, 'ARENA_CAPACITY');
  assert.equal(second.messages.at(-1).code, 'ARENA_CAPACITY');
});
