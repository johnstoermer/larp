import assert from 'node:assert/strict';
import test from 'node:test';
import { MultiplayerHub } from '../server/multiplayer/Hub.js';
import { PROTOCOL_VERSION } from '../server/multiplayer/config.js';
import { Game } from '../src/game/Game.js';
import {
  NetworkClient,
  PENDING_LEAVE_KEY,
  PROTOCOL_VERSION as CLIENT_PROTOCOL_VERSION,
  welcomeInvalidatesResume,
} from '../src/game/NetworkClient.js';

function installStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      },
    },
  });
  return values;
}

function createHelloHub() {
  const hub = Object.create(MultiplayerHub.prototype);
  hub.sessions = new Map();
  hub.newSessionAdmissions = new Map();
  hub.send = (session, payload) => {
    session.messages ??= [];
    session.messages.push(payload);
    return true;
  };
  hub.sendSocket = (clientSocket, payload) => {
    clientSocket.sent ??= [];
    clientSocket.sent.push(payload);
    return true;
  };
  return hub;
}

function socket(readyState = 1, extensions = 'permessage-deflate') {
  return {
    readyState,
    extensions,
    session: null,
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

test('client and server advertise the same multiplayer protocol', () => {
  assert.equal(PROTOCOL_VERSION, 6);
  assert.equal(CLIENT_PROTOCOL_VERSION, PROTOCOL_VERSION);
});

test('hello rejects the previous protocol before creating a session', () => {
  const hub = createHelloHub();
  const clientSocket = socket();

  MultiplayerHub.prototype.handleHello.call(hub, clientSocket, {
    type: 'hello',
    version: PROTOCOL_VERSION - 1,
    name: 'Old client',
  });

  assert.equal(clientSocket.session, null);
  assert.equal(clientSocket.sent.at(-1).code, 'VERSION_MISMATCH');
  assert.equal(clientSocket.sent.at(-1).expectedVersion, PROTOCOL_VERSION);
  assert.deepEqual(clientSocket.closed, {
    code: 4003,
    reason: 'VERSION_MISMATCH',
  });
});

test('hello explicitly rejects a stale resume token with no room', () => {
  const hub = createHelloHub();
  const clientSocket = socket();

  MultiplayerHub.prototype.handleHello.call(hub, clientSocket, {
    type: 'hello',
    version: PROTOCOL_VERSION,
    token: 'missing-session',
    name: 'Player',
  });

  assert.ok(clientSocket.session);
  assert.equal(clientSocket.session.room, null);
  assert.equal(
    clientSocket.session.messages.find((message) => message.type === 'welcome')
      ?.activeMatch,
    false,
  );
  assert.deepEqual(clientSocket.session.messages.at(-1), {
    type: 'resume_status',
    active: false,
  });
});

test('hello reports a failed room reconnect and clears stale room references', () => {
  const hub = createHelloHub();
  const staleRoom = { reconnect: () => false };
  const session = {
    token: 'stale-room',
    name: 'Player',
    socket: socket(3),
    connected: false,
    room: staleRoom,
    slot: 14,
    team: 1,
    disconnectedAt: Date.now(),
    rateWindowAt: 0,
    rateCount: 0,
  };
  hub.sessions.set(session.token, session);

  MultiplayerHub.prototype.handleHello.call(hub, socket(), {
    type: 'hello',
    version: PROTOCOL_VERSION,
    token: session.token,
    name: 'Player',
  });

  assert.equal(
    session.messages.find((message) => message.type === 'welcome')?.activeMatch,
    true,
  );
  assert.deepEqual(session.messages.at(-1), {
    type: 'resume_status',
    active: false,
  });
  assert.equal(session.room, null);
  assert.equal(session.slot, null);
  assert.equal(session.team, null);
});

test('hello preserves a valid active match reconnect', () => {
  const hub = createHelloHub();
  let reconnects = 0;
  const room = {
    reconnect() {
      reconnects += 1;
      return true;
    },
  };
  const session = {
    token: 'live-room',
    name: 'Player',
    socket: socket(3),
    connected: false,
    room,
    slot: 4,
    team: 0,
    disconnectedAt: Date.now(),
    rateWindowAt: 0,
    rateCount: 0,
  };
  hub.sessions.set(session.token, session);

  MultiplayerHub.prototype.handleHello.call(hub, socket(), {
    type: 'hello',
    version: PROTOCOL_VERSION,
    token: session.token,
    name: 'Player',
  });

  assert.equal(reconnects, 1);
  assert.equal(session.room, room);
  assert.deepEqual(session.messages.at(-1), {
    type: 'resume_status',
    active: true,
  });
});

test('War reconnect rejects an uncompressed migration without moving the session', () => {
  const hub = createHelloHub();
  let reconnects = 0;
  const previousSocket = socket(1);
  const room = {
    mode: 'war',
    reconnect() {
      reconnects += 1;
      return true;
    },
  };
  const session = {
    token: 'compressed-war',
    name: 'Player',
    socket: previousSocket,
    connected: true,
    room,
    rateWindowAt: 0,
    rateCount: 0,
  };
  previousSocket.session = session;
  hub.sessions.set(session.token, session);
  const uncompressed = socket(1, '');

  MultiplayerHub.prototype.handleHello.call(hub, uncompressed, {
    type: 'hello',
    version: PROTOCOL_VERSION,
    token: session.token,
    name: 'Player',
  });

  assert.equal(session.socket, previousSocket);
  assert.equal(reconnects, 0);
  assert.equal(uncompressed.sent.at(-1).code, 'WAR_COMPRESSION_REQUIRED');
  assert.deepEqual(uncompressed.closed, {
    code: 4004,
    reason: 'WAR_COMPRESSION_REQUIRED',
  });
});

test('repeated token migration is rejected without resetting the session limiter', () => {
  const hub = createHelloHub();
  const previousSocket = socket(1);
  const session = {
    token: 'migration-rate',
    name: 'Player',
    socket: previousSocket,
    connected: true,
    room: null,
    rateWindowAt: Date.now(),
    rateCount: 73,
    nextSocketMigrationAt: Date.now() + 5_000,
  };
  previousSocket.session = session;
  hub.sessions.set(session.token, session);
  const replacement = socket();

  MultiplayerHub.prototype.handleHello.call(hub, replacement, {
    type: 'hello',
    version: PROTOCOL_VERSION,
    token: session.token,
    name: 'Player',
  });

  assert.equal(session.socket, previousSocket);
  assert.equal(session.rateCount, 73);
  assert.equal(replacement.sent.at(-1).code, 'RECONNECT_RATE');
  assert.deepEqual(replacement.closed, { code: 4009, reason: 'RECONNECT_RATE' });
});

test('NetworkClient clears stale restore state and emits one recovery event', () => {
  const storage = installStorage({ 'larp-active-match': '1' });
  const client = new NetworkClient();
  client.startPing = () => {};
  let recoveries = 0;
  client.addEventListener('resume_unavailable', () => {
    recoveries += 1;
  });

  client.handleMessage(JSON.stringify({
    type: 'welcome',
    token: 'fresh-token',
    name: 'Player',
    online: 1,
    activeMatch: false,
  }));
  client.handleMessage(JSON.stringify({
    type: 'resume_status',
    active: false,
  }));

  assert.equal(client.resumeRequested, false);
  assert.equal(client.inMatch, false);
  assert.equal(storage.has('larp-active-match'), false);
  assert.equal(recoveries, 1);
  assert.equal(welcomeInvalidatesResume({ activeMatch: false }, true), true);
  assert.equal(welcomeInvalidatesResume({ activeMatch: true }, true), false);
  assert.equal(welcomeInvalidatesResume({}, true), false);
});

test('offline leave intent survives reconnect and suppresses restored match events', () => {
  const storage = installStorage({ 'larp-active-match': '1' });
  const client = new NetworkClient();
  client.inMatch = true;
  client.startPing = () => {};
  client.send = () => false;
  let restoredMatches = 0;
  client.addEventListener('war_found', () => {
    restoredMatches += 1;
  });

  assert.equal(client.leave(), false);
  assert.equal(client.inMatch, false);
  assert.equal(client.resumeRequested, false);
  assert.equal(client.pendingLeave, true);
  assert.equal(client.closeAfterLeave, true);
  assert.equal(storage.has('larp-active-match'), false);
  assert.equal(storage.get(PENDING_LEAVE_KEY), '1');

  const sent = [];
  let closes = 0;
  client.close = () => {
    closes += 1;
  };
  client.send = (message) => {
    sent.push(message);
    return true;
  };
  client.handleMessage(JSON.stringify({
    type: 'welcome',
    token: 'resumed-token',
    name: 'Player',
    online: 1,
    activeMatch: true,
  }));
  client.handleMessage(JSON.stringify({
    type: 'war_found',
    roomId: 'old-room',
  }));

  assert.deepEqual(sent, [{ type: 'leave' }]);
  assert.equal(restoredMatches, 0);
  assert.equal(client.inMatch, false);
  assert.equal(client.pendingLeave, true);

  client.handleMessage(JSON.stringify({ type: 'left_match' }));
  assert.equal(client.pendingLeave, false);
  assert.equal(storage.has(PENDING_LEAVE_KEY), false);
  assert.equal(closes, 1, 'an acknowledged title return releases its idle socket');
});

test('starting a new queue during leave acknowledgement keeps the socket alive', () => {
  installStorage();
  const sent = [];
  const client = new NetworkClient();
  client.send = (message) => {
    sent.push(message);
    return true;
  };
  let closes = 0;
  client.close = () => {
    closes += 1;
  };

  client.leave();
  client.warPlay('greatsword');
  client.handleMessage(JSON.stringify({ type: 'left_match' }));

  assert.deepEqual(sent, [
    { type: 'leave' },
    { type: 'war_play', classId: 'greatsword', warMode: 'control' },
  ]);
  assert.equal(closes, 0);
  assert.equal(client.pendingLeave, false);
});

test('cancelling a lobby releases its otherwise idle socket', () => {
  installStorage();
  const sent = [];
  const client = new NetworkClient();
  client.send = (message) => {
    sent.push(message);
    return true;
  };
  let closes = 0;
  client.close = () => {
    closes += 1;
  };

  assert.equal(client.cancelQueue(), true);
  assert.deepEqual(sent, [{ type: 'cancel_queue' }]);
  assert.equal(closes, 1);
});

test('next-spawn class selection synchronizes both selects and sends once', () => {
  const storage = installStorage();
  const messages = [];
  const game = {
    ui: {
      warClass: { value: 'shortbow' },
      warRespawnClass: { value: 'shortbow' },
    },
    matchType: 'war',
    network: {
      inMatch: true,
      send(message) {
        messages.push(message);
      },
    },
  };

  const classId = Game.prototype.selectWarNextClass.call(
    game,
    'greatsword',
    true,
  );

  assert.equal(classId, 'greatsword');
  assert.equal(game.ui.warClass.value, 'greatsword');
  assert.equal(game.ui.warRespawnClass.value, 'greatsword');
  assert.equal(storage.get('larp-war-class'), 'greatsword');
  assert.deepEqual(messages, [{ type: 'war_select_class', classId: 'greatsword' }]);
});
