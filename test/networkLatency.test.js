import test from 'node:test';
import assert from 'node:assert/strict';
import { LatencyTracker, median } from '../src/game/LatencyTracker.js';
import {
  MAX_REALTIME_BUFFERED_BYTES as CLIENT_BUFFER_LIMIT,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  shouldDropRealtimeMessage,
} from '../src/game/NetworkClient.js';
import {
  MAX_REALTIME_BUFFERED_BYTES as SERVER_BUFFER_LIMIT,
  MultiplayerHub,
} from '../server/multiplayer/Hub.js';
import { SNAPSHOT_RATE } from '../server/multiplayer/config.js';

test('latency tracker reports a robust measured RTT without hiding a slow route', () => {
  const tracker = new LatencyTracker(7);
  for (const sample of [398, 405, 392, 410, 401]) tracker.add(sample);
  assert.equal(tracker.rtt, 401);
  assert.equal(tracker.jitter, 4);

  tracker.reset();
  for (const sample of [18, 17, 850, 19, 16]) tracker.add(sample);
  assert.equal(tracker.rtt, 18);
  assert.equal(tracker.jitter, 1);
  assert.equal(median([10, 14]), 12);
});

test('latency tracker rejects invalid samples and keeps its last estimate', () => {
  const tracker = new LatencyTracker();
  tracker.add(24);
  assert.deepEqual(tracker.add(Number.NaN), {
    rtt: 24,
    jitter: 0,
    sample: null,
  });
  assert.equal(tracker.add(-5).rtt, 24);
});

test('realtime backpressure budgets stay bounded below event traffic limits', () => {
  assert.ok(CLIENT_BUFFER_LIMIT >= 4096);
  assert.ok(SERVER_BUFFER_LIMIT >= CLIENT_BUFFER_LIMIT);
  assert.ok(SERVER_BUFFER_LIMIT <= 64 * 1024);
  assert.ok(PING_INTERVAL_MS >= 500);
  assert.ok(PING_TIMEOUT_MS > PING_INTERVAL_MS);
  assert.equal(SNAPSHOT_RATE, 30);
  assert.equal(
    shouldDropRealtimeMessage(
      { type: 'state' },
      CLIENT_BUFFER_LIMIT + 1,
    ),
    true,
  );
  assert.equal(
    shouldDropRealtimeMessage(
      { type: 'shoot' },
      CLIENT_BUFFER_LIMIT + 1,
    ),
    false,
  );
});

test('server drops only volatile snapshots when its socket is backpressured', () => {
  const hub = Object.create(MultiplayerHub.prototype);
  hub.bytesSent = 0;
  hub.realtimeMessagesDropped = 0;
  const sent = [];
  const socket = {
    readyState: 1,
    bufferedAmount: SERVER_BUFFER_LIMIT + 1,
    send(encoded) {
      sent.push(encoded);
    },
  };

  assert.equal(
    hub.sendSocketEncoded(socket, '{"type":"snapshot"}', { volatile: true }),
    false,
  );
  assert.equal(sent.length, 0);
  assert.equal(hub.realtimeMessagesDropped, 1);

  assert.equal(
    hub.sendSocketEncoded(socket, '{"type":"event"}', { volatile: false }),
    true,
  );
  assert.deepEqual(sent, ['{"type":"event"}']);
  assert.equal(hub.bytesSent, Buffer.byteLength('{"type":"event"}'));
});

test('ping response preserves the outstanding sequence for exact matching', () => {
  const hub = Object.create(MultiplayerHub.prototype);
  let response = null;
  hub.send = (_session, payload) => {
    response = payload;
  };
  MultiplayerHub.prototype.handleMessage.call(
    hub,
    {},
    { type: 'ping', sequence: 17, sentAt: 812.5 },
  );
  assert.deepEqual({ ...response, serverTime: 0 }, {
    type: 'pong',
    sequence: 17,
    sentAt: 812.5,
    serverTime: 0,
  });
  assert.ok(Number.isFinite(response.serverTime));
});
