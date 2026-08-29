const EDITABLE_TAG_NAMES = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

const PREVENTED_GAMEPLAY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'KeyC',
  'KeyR',
]);

export function isEditableEventTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (EDITABLE_TAG_NAMES.has(String(target.tagName || '').toUpperCase())) return true;
  if (target.isContentEditable) return true;
  if (typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest(
      'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    ),
  );
}

export function recordGameplayKeyDown(event, keys, pressed) {
  const code = event.code;
  if (isEditableEventTarget(event.target)) {
    keys.delete(code);
    pressed.delete(code);
    return false;
  }
  if (PREVENTED_GAMEPLAY_CODES.has(code)) event.preventDefault();
  if (!keys.has(code)) pressed.add(code);
  keys.add(code);
  return true;
}

export function recordGameplayKeyUp(event, keys) {
  keys.delete(event.code);
}
