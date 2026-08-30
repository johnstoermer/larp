export const GAMEPLAY_KEYBOARD_LOCK_CODES = Object.freeze(['KeyW']);
export const GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL =
  'herm.cool/larp-keyboard-capture';
export const GAMEPLAY_KEYBOARD_BRIDGE_VERSION = 1;
export const GAMEPLAY_KEYBOARD_PARENT_ORIGIN = 'https://herm.cool';

let nextBridgeRequestId = 0;

function browserEnvironment(options = {}) {
  return {
    documentRef: options.documentRef ?? globalThis.document,
    navigatorRef: options.navigatorRef ?? globalThis.navigator,
    windowRef: options.windowRef ?? globalThis.window,
  };
}

function parentBridgeEnvironment(options = {}) {
  const { windowRef } = browserEnvironment(options);
  const parentRef = options.parentRef ?? windowRef?.parent;
  return {
    parentOrigin:
      options.parentOrigin ?? GAMEPLAY_KEYBOARD_PARENT_ORIGIN,
    parentRef,
    windowRef,
  };
}

function isParentBridgeResponse(
  event,
  { action, parentOrigin, parentRef, requestId },
) {
  const data = event?.data;
  return (
    event?.source === parentRef &&
    event?.origin === parentOrigin &&
    data?.channel === GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL &&
    data?.version === GAMEPLAY_KEYBOARD_BRIDGE_VERSION &&
    data?.type === 'response' &&
    data?.action === action &&
    data?.requestId === requestId
  );
}

function canUseParentKeyboardBridge(options = {}) {
  const { parentRef, windowRef } = parentBridgeEnvironment(options);
  return Boolean(
    windowRef &&
    parentRef &&
    parentRef !== windowRef &&
    typeof parentRef.postMessage === 'function'
  );
}

function requestParentKeyboardCapture(action, options = {}) {
  const { parentOrigin, parentRef, windowRef } =
    parentBridgeEnvironment(options);
  if (!canUseParentKeyboardBridge(options)) {
    return null;
  }

  nextBridgeRequestId += 1;
  const requestId = `larp-keyboard-${nextBridgeRequestId}`;
  const message = {
    channel: GAMEPLAY_KEYBOARD_BRIDGE_CHANNEL,
    version: GAMEPLAY_KEYBOARD_BRIDGE_VERSION,
    type: 'request',
    action,
    requestId,
  };

  if (typeof windowRef.addEventListener !== 'function') {
    parentRef.postMessage(message, parentOrigin);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let timeoutId;
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      windowRef.removeEventListener?.('message', handleMessage);
      resolve(status);
    };
    const handleMessage = (event) => {
      if (
        isParentBridgeResponse(event, {
          action,
          parentOrigin,
          parentRef,
          requestId,
        })
      ) {
        finish(event.data);
      }
    };

    windowRef.addEventListener('message', handleMessage);
    try {
      // The explicit target origin prevents an unrelated embedding page from
      // receiving gameplay-control requests.
      parentRef.postMessage(message, parentOrigin);
    } catch {
      finish(null);
      return;
    }

    if (!settled) {
      const timeoutMs = Math.max(0, options.bridgeTimeoutMs ?? 1200);
      timeoutId = setTimeout(() => finish(null), timeoutMs);
    }
  });
}

export async function requestGameplayKeyboardCapture(
  fullscreenTarget,
  options = {},
) {
  const { documentRef, navigatorRef } = browserEnvironment(options);
  if (canUseParentKeyboardBridge(options)) {
    let fullscreen = Boolean(documentRef?.fullscreenElement);
    if (!fullscreen && typeof fullscreenTarget?.requestFullscreen === 'function') {
      try {
        // A nested fullscreen element keeps the iframe document in the
        // fullscreen chain, which Pointer Lock requires. Keyboard Lock itself
        // is still delegated to herm.cool's primary top-level context.
        await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
        fullscreen = true;
      } catch {
        // The parent can still attempt top-level fullscreen and provide the
        // active-match unload fallback when nested fullscreen is unavailable.
      }
    }
    const status = await requestParentKeyboardCapture('acquire', options);
    return {
      fullscreen: fullscreen || Boolean(status?.fullscreen),
      keyboardLocked: Boolean(status?.active),
    };
  }

  let fullscreen = Boolean(documentRef?.fullscreenElement);

  if (!fullscreen) {
    if (typeof fullscreenTarget?.requestFullscreen !== 'function') {
      return { fullscreen: false, keyboardLocked: false };
    }
    try {
      await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
      fullscreen = true;
    } catch {
      return { fullscreen: false, keyboardLocked: false };
    }
  }

  let keyboardLocked = false;
  try {
    if (typeof navigatorRef?.keyboard?.lock === 'function') {
      await navigatorRef.keyboard.lock([...GAMEPLAY_KEYBOARD_LOCK_CODES]);
      keyboardLocked = true;
    }
  } catch {
    // Fullscreen and Keyboard Lock may be denied independently. The active-match
    // beforeunload guard remains available when the browser reserves Ctrl+W.
  }

  return { fullscreen, keyboardLocked };
}

export async function releaseGameplayKeyboardCapture(
  fullscreenTarget,
  options = {},
) {
  const { documentRef, navigatorRef } = browserEnvironment(options);
  if (canUseParentKeyboardBridge(options)) {
    const status = await requestParentKeyboardCapture('release', options);
    let childFullscreenExited = false;
    try {
      if (
        documentRef?.fullscreenElement === fullscreenTarget &&
        typeof documentRef.exitFullscreen === 'function'
      ) {
        await documentRef.exitFullscreen();
        childFullscreenExited = true;
      }
    } catch {
      // The parent may have already unwound the nested fullscreen chain.
    }
    return {
      keyboardUnlocked: Boolean(status?.keyboardUnlocked),
      fullscreenExited:
        childFullscreenExited || Boolean(status?.fullscreenExited),
    };
  }

  let keyboardUnlocked = false;
  let fullscreenExited = false;

  try {
    if (typeof navigatorRef?.keyboard?.unlock === 'function') {
      navigatorRef.keyboard.unlock();
      keyboardUnlocked = true;
    }
  } catch {
    // Keyboard Lock is experimental and some implementations can throw here.
  }

  try {
    if (
      documentRef?.fullscreenElement === fullscreenTarget &&
      typeof documentRef.exitFullscreen === 'function'
    ) {
      await documentRef.exitFullscreen();
      fullscreenExited = true;
    }
  } catch {
    // Leaving fullscreen can race with the user pressing Escape; either outcome
    // already releases the browser's keyboard lock.
  }

  return { keyboardUnlocked, fullscreenExited };
}

export function guardActiveMatchBeforeUnload(event, activeMatch) {
  if (!activeMatch) return false;
  event?.preventDefault?.();
  if (event) event.returnValue = true;
  return true;
}
