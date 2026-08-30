import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import { MultiplayerHub } from '../server/multiplayer/Hub.js';
import { PROTOCOL_VERSION } from '../server/multiplayer/config.js';

async function withHub(run) {
  const server = createServer();
  const hub = new MultiplayerHub(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`ws://127.0.0.1:${address.port}/ws`);
  } finally {
    hub.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function nextJson(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message.'));
    }, 2_000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

test('War transport refuses a forced tiny server compression window', async () => {
  await withHub(async (url) => {
    const status = await new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        perMessageDeflate: { serverMaxWindowBits: 8 },
      });
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
      socket.once('open', () => {
        socket.close();
        reject(new Error('Tiny compression-window handshake was accepted.'));
      });
      socket.once('error', () => {
        // `unexpected-response` is the assertion-bearing path.
      });
    });
    assert.equal(status, 400);
  });
});

test('an uncompressed real socket may connect but cannot enter War', async () => {
  await withHub(async (url) => {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    assert.equal(socket.extensions, '');
    socket.send(JSON.stringify({
      type: 'hello',
      version: PROTOCOL_VERSION,
      name: 'Transport test',
    }));
    await nextJson(socket, (message) => message.type === 'welcome');
    const rejection = nextJson(
      socket,
      (message) => message.type === 'error' && message.code === 'WAR_COMPRESSION_REQUIRED',
    );
    socket.send(JSON.stringify({ type: 'war_play', classId: 'knives' }));
    assert.equal((await rejection).code, 'WAR_COMPRESSION_REQUIRED');
    socket.close(1000, 'TEST_COMPLETE');
    await new Promise((resolve) => socket.once('close', resolve));
  });
});
