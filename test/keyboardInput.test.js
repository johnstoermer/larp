import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEditableEventTarget,
  recordGameplayKeyDown,
  recordGameplayKeyUp,
} from '../src/game/keyboardInput.js';

function keyboardEvent(code, target) {
  let prevented = false;
  return {
    code,
    target,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

test('text-entry targets include standard fields and editable descendants', () => {
  assert.equal(isEditableEventTarget({ tagName: 'input' }), true);
  assert.equal(isEditableEventTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableEventTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableEventTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableEventTarget({
      tagName: 'SPAN',
      closest: (selector) => selector.includes('[role="textbox"]') ? {} : null,
    }),
    true,
  );
  assert.equal(isEditableEventTarget({ tagName: 'CANVAS' }), false);
});

test('gameplay letters remain normal text input and never enter player state', () => {
  const keys = new Set();
  const pressed = new Set();

  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'Space']) {
    const event = keyboardEvent(code, { tagName: 'INPUT' });
    const routed = recordGameplayKeyDown(event, keys, pressed);

    assert.equal(routed, false, code);
    assert.equal(event.prevented, false, code);
    assert.equal(keys.has(code), false, code);
    assert.equal(pressed.has(code), false, code);
  }
});

test('gameplay controls still route and prevent browser defaults off an editor', () => {
  const keys = new Set();
  const pressed = new Set();
  const event = keyboardEvent('KeyW', { tagName: 'CANVAS' });

  assert.equal(recordGameplayKeyDown(event, keys, pressed), true);
  assert.equal(event.prevented, true);
  assert.equal(keys.has('KeyW'), true);
  assert.equal(pressed.has('KeyW'), true);

  recordGameplayKeyUp(event, keys);
  assert.equal(keys.has('KeyW'), false);
  assert.equal(pressed.has('KeyW'), true);
});

test('an editable key event clears a previously held gameplay key', () => {
  const keys = new Set(['KeyR']);
  const pressed = new Set(['KeyR']);
  const event = keyboardEvent('KeyR', { tagName: 'INPUT' });

  recordGameplayKeyDown(event, keys, pressed);

  assert.deepEqual([...keys], []);
  assert.deepEqual([...pressed], []);
});
