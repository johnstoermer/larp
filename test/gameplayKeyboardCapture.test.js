import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL,
  GAMEPLAY_KEYBOARD_LOCK_CODES,
  GAMEPLAY_KEYBOARD_PARENT_ORIGIN,
  guardActiveMatchBeforeUnload,
  releaseGameplayKeyboardCapture,
  requestGameplayKeyboardCapture,
} from '../src/game/gameplayKeyboardCapture.js';

function captureEnvironment({ fullscreen = false } = {}) {
  const calls = [];
  const target = {
    async requestFullscreen(options) {
      calls.push(['fullscreen', options]);
      documentRef.fullscreenElement = target;
    },
  };
  const documentRef = {
    fullscreenElement: fullscreen ? target : null,
    async exitFullscreen() {
      calls.push(['exitFullscreen']);
      documentRef.fullscreenElement = null;
    },
  };
  const navigatorRef = {
    keyboard: {
      async lock(codes) {
        calls.push(['lock', codes]);
      },
      unlock() {
        calls.push(['unlock']);
      },
    },
  };
  return { calls, documentRef, navigatorRef, target };
}

function parentBridgeEnvironment() {
  const calls = [];
  const localCalls = [];
  const listeners = new Map();
  const windowRef = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const parentRef = {
    postMessage(message, targetOrigin) {
      calls.push([message, targetOrigin]);
      queueMicrotask(() => {
        listeners.get('message')?.({
          data: {
            channel: GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL,
            version: 1,
            type: 'response',
            action: message.action,
            requestId: message.requestId,
            active: message.action === 'acquire',
            fullscreen: message.action === 'acquire',
            fullscreenExited: message.action === 'release',
            keyboardUnlocked: message.action === 'release',
          },
          origin: GAMEPLAY_KEYBOARD_PARENT_ORIGIN,
          source: parentRef,
        });
      });
    },
  };
  windowRef.parent = parentRef;
  const fullscreenTarget = {
    async requestFullscreen(options) {
      localCalls.push(['fullscreen', options]);
      documentRef.fullscreenElement = fullscreenTarget;
    },
  };
  const documentRef = {
    fullscreenElement: null,
    async exitFullscreen() {
      localCalls.push(['exitFullscreen']);
      documentRef.fullscreenElement = null;
    },
  };
  return {
    calls,
    documentRef,
    fullscreenTarget,
    listeners,
    localCalls,
    navigatorRef: {},
    parentRef,
    windowRef,
  };
}

test('gameplay capture enters JavaScript fullscreen before locking Ctrl+W movement', async () => {
  const environment = captureEnvironment();

  const result = await requestGameplayKeyboardCapture(
    environment.target,
    environment,
  );

  assert.deepEqual(GAMEPLAY_KEYBOARD_LOCK_CODES, ['KeyW']);
  assert.deepEqual(environment.calls, [
    ['fullscreen', { navigationUI: 'hide' }],
    ['lock', ['KeyW']],
  ]);
  assert.deepEqual(result, { fullscreen: true, keyboardLocked: true });
});

test('an existing fullscreen session only refreshes the KeyW keyboard lock', async () => {
  const environment = captureEnvironment({ fullscreen: true });

  const result = await requestGameplayKeyboardCapture(
    environment.target,
    environment,
  );

  assert.deepEqual(environment.calls, [['lock', ['KeyW']]]);
  assert.deepEqual(result, { fullscreen: true, keyboardLocked: true });
});

test('embedded gameplay delegates capture to the authenticated herm.cool parent', async () => {
  const environment = parentBridgeEnvironment();

  assert.deepEqual(
    await requestGameplayKeyboardCapture(
      environment.fullscreenTarget,
      environment,
    ),
    { fullscreen: true, keyboardLocked: true },
  );
  assert.deepEqual(environment.localCalls, [
    ['fullscreen', { navigationUI: 'hide' }],
  ]);
  assert.equal(environment.calls.length, 1);
  const [message, targetOrigin] = environment.calls[0];
  assert.equal(targetOrigin, 'https://herm.cool');
  assert.equal(message.channel, GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL);
  assert.equal(message.type, 'request');
  assert.equal(message.action, 'acquire');
});

test('embedded gameplay asks the parent to release its lock and fullscreen', async () => {
  const environment = parentBridgeEnvironment();
  environment.documentRef.fullscreenElement = environment.fullscreenTarget;

  assert.deepEqual(
    await releaseGameplayKeyboardCapture(
      environment.fullscreenTarget,
      environment,
    ),
    { keyboardUnlocked: true, fullscreenExited: true },
  );
  assert.deepEqual(environment.localCalls, [['exitFullscreen']]);
  const [message, targetOrigin] = environment.calls[0];
  assert.equal(targetOrigin, 'https://herm.cool');
  assert.equal(message.action, 'release');
});

test('the child ignores bridge responses from spoofed origins', async () => {
  const environment = parentBridgeEnvironment();
  environment.parentRef.postMessage = (message, targetOrigin) => {
    environment.calls.push([message, targetOrigin]);
    queueMicrotask(() => {
      environment.listeners.get('message')?.({
        data: {
          channel: GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL,
          version: 1,
          type: 'response',
          action: message.action,
          requestId: message.requestId,
          active: true,
          fullscreen: true,
        },
        origin: 'https://example.com',
        source: environment.parentRef,
      });
    });
  };

  assert.deepEqual(
    await requestGameplayKeyboardCapture({}, {
      ...environment,
      bridgeTimeoutMs: 1,
    }),
    { fullscreen: false, keyboardLocked: false },
  );
});

test('unsupported or denied capture APIs fail closed without rejecting', async () => {
  let lockAttempted = false;
  const denied = {
    documentRef: { fullscreenElement: null },
    navigatorRef: {
      keyboard: {
        async lock() {
          lockAttempted = true;
        },
      },
    },
  };
  const deniedTarget = {
    async requestFullscreen() {
      throw new Error('denied');
    },
  };

  assert.deepEqual(
    await requestGameplayKeyboardCapture(deniedTarget, denied),
    { fullscreen: false, keyboardLocked: false },
  );
  assert.equal(lockAttempted, false);

  const unsupported = {
    documentRef: { fullscreenElement: null },
    navigatorRef: {},
  };
  assert.deepEqual(
    await requestGameplayKeyboardCapture({}, unsupported),
    { fullscreen: false, keyboardLocked: false },
  );

  const lockDenied = captureEnvironment({ fullscreen: true });
  lockDenied.navigatorRef.keyboard.lock = async () => {
    throw new Error('denied');
  };
  assert.deepEqual(
    await requestGameplayKeyboardCapture(lockDenied.target, lockDenied),
    { fullscreen: true, keyboardLocked: false },
  );
});

test('release unlocks the keyboard and exits only the game-owned fullscreen target', async () => {
  const environment = captureEnvironment({ fullscreen: true });

  assert.deepEqual(
    await releaseGameplayKeyboardCapture(environment.target, environment),
    { keyboardUnlocked: true, fullscreenExited: true },
  );
  assert.deepEqual(environment.calls, [
    ['unlock'],
    ['exitFullscreen'],
  ]);

  const otherTarget = {};
  const otherEnvironment = captureEnvironment({ fullscreen: true });
  await releaseGameplayKeyboardCapture(otherTarget, otherEnvironment);
  assert.deepEqual(otherEnvironment.calls, [['unlock']]);
});

test('beforeunload fallback only protects an active match', () => {
  let prevented = 0;
  const event = {
    returnValue: undefined,
    preventDefault() {
      prevented += 1;
    },
  };

  assert.equal(guardActiveMatchBeforeUnload(event, false), false);
  assert.equal(prevented, 0);
  assert.equal(event.returnValue, undefined);

  assert.equal(guardActiveMatchBeforeUnload(event, true), true);
  assert.equal(prevented, 1);
  assert.equal(event.returnValue, true);
});

test('Game wires capture to gesture entry paths and releases it at match end', () => {
  const gameSource = readFileSync(
    new URL('../src/game/Game.js', import.meta.url),
    'utf8',
  );

  assert.match(
    gameSource,
    /this\.fullscreenTarget = canvas\.closest\?\.\('#game-root'\) \?\? canvas/,
  );
  assert.match(
    gameSource,
    /this\.canvas\.addEventListener\('click', async \(\) =>[\s\S]*?await this\.captureGameplayKeyboard\(\);[\s\S]*?this\.requestPointerLock\(\);/,
  );
  assert.match(
    gameSource,
    /captureGameplayKeyboard\(\) \{[\s\S]*?const capture = requestGameplayKeyboardCapture\(this\.fullscreenTarget\);[\s\S]*?return capture;/,
  );
  for (const method of [
    'startQuickPlay',
    'createPrivateRoom',
    'joinPrivateRoom',
    'startMatch',
    'resume',
  ]) {
    assert.match(
      gameSource,
      new RegExp(`(?:async )?${method}\\([^)]*\\) \\{[\\s\\S]*?this\\.captureGameplayKeyboard\\(\\);`),
      `${method} must request capture while its user activation is available`,
    );
  }
  assert.match(
    gameSource,
    /window\.addEventListener\('beforeunload',[\s\S]*?this\.mode === 'match' \|\| this\.mode === 'paused'/,
  );
  assert.ok(
    [...gameSource.matchAll(/this\.releaseGameplayKeyboard\(\);/g)].length >= 4,
    'title and every result path must release fullscreen keyboard capture',
  );
});
