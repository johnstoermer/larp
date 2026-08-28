import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COOKOUT_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

const diagnostics = [];
function createPlayer(name) {
  const contextPromise = browser.newContext({
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 1,
  });
  return contextPromise.then(async (context) => {
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    diagnostics.push({ name, errors });
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.locator('#title-screen.active').waitFor();
    await page.locator('#callsign').fill(name);
    return { name, context, page, errors };
  });
}

try {
  const [alpha, bravo] = await Promise.all([
    createPlayer('ALPHA TEST'),
    createPlayer('BRAVO TEST'),
  ]);

  await alpha.page.locator('#online-button').click();
  await alpha.page.locator('#network-lobby.active').waitFor();
  await bravo.page.locator('#online-button').click();

  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.waitForFunction(
        () =>
          window.__COOKOUT_2_GAME__?.matchType === 'online' &&
          window.__COOKOUT_2_GAME__?.onlineRoomId,
        null,
        { timeout: 30_000 },
      ),
    ),
  );
  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.waitForFunction(
        () => window.__COOKOUT_2_GAME__?.phase === 'playing',
        null,
        { timeout: 30_000 },
      ),
    ),
  );

  const matched = await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.evaluate(() => {
        const game = window.__COOKOUT_2_GAME__;
        return {
          roomId: game.onlineRoomId,
          slot: game.onlineSlot,
          opponent: game.onlineOpponent,
          phase: game.phase,
          map: game.arena.map.id,
          pickups: game.pickups.pickups.length,
          networkStatus: game.network.status,
        };
      }),
    ),
  );
  if (matched[0].roomId !== matched[1].roomId) {
    throw new Error('Quick match clients entered different rooms.');
  }
  if (matched[0].slot === matched[1].slot) {
    throw new Error('Quick match clients received the same player slot.');
  }
  if (matched.some((entry) => entry.networkStatus !== 'online')) {
    throw new Error(`Network did not settle: ${JSON.stringify(matched)}`);
  }

  await alpha.page.locator('#world').click({ position: { x: 640, y: 380 } });
  await alpha.page.waitForTimeout(250);
  const beforeMovement = await alpha.page.evaluate(() =>
    window.__COOKOUT_2_GAME__.player.position.toArray(),
  );
  await alpha.page.keyboard.down('ShiftLeft');
  await alpha.page.keyboard.down('KeyW');
  await alpha.page.waitForTimeout(3500);
  await alpha.page.keyboard.up('KeyW');
  await alpha.page.keyboard.up('ShiftLeft');
  await alpha.page.waitForTimeout(500);
  const afterMovement = await alpha.page.evaluate(() =>
    window.__COOKOUT_2_GAME__.player.position.toArray(),
  );
  const movementDistance = Math.hypot(
    afterMovement[0] - beforeMovement[0],
    afterMovement[2] - beforeMovement[2],
  );
  if (movementDistance < 0.2) {
    const movementState = await alpha.page.evaluate(() => {
      const game = window.__COOKOUT_2_GAME__;
      return {
        phase: game.phase,
        onlinePaused: game.onlinePaused,
        pointerLock: document.pointerLockElement?.id ?? null,
        inputEnabled: game.player.inputEnabled,
        velocity: game.player.velocity.toArray(),
        networkStatus: game.network.status,
        sequence: game.onlineSequence,
        serverPosition:
          game.onlineSnapshot?.players?.[game.onlineSlot]?.position ?? null,
        serverAck:
          game.onlineSnapshot?.players?.[game.onlineSlot]?.ack ?? null,
        reconciliationHistory: game.onlineStateHistory.size,
      };
    });
    throw new Error(
      `Predicted movement did not advance: ${JSON.stringify({
        beforeMovement,
        afterMovement,
        movementDistance,
        movementState,
      })}`,
    );
  }

  await alpha.page.evaluate(() => {
    window.__COOKOUT_2_GAME__.player.lastShotAt = -Infinity;
  });
  const ammoBefore = await alpha.page.evaluate(
    () => window.__COOKOUT_2_GAME__.player.ammo,
  );
  await alpha.page.mouse.down();
  await alpha.page.waitForTimeout(120);
  await alpha.page.mouse.up();
  await alpha.page.waitForFunction(
    (before) => window.__COOKOUT_2_GAME__.player.ammo < before,
    ammoBefore,
  );
  await bravo.page.waitForFunction(
    (before) => window.__COOKOUT_2_GAME__.bot.ammo < before,
    ammoBefore,
    { timeout: 5000 },
  );
  const weaponSync = await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.evaluate(() => ({
        localAmmo: window.__COOKOUT_2_GAME__.player.ammo,
        remoteAmmo: window.__COOKOUT_2_GAME__.bot.ammo,
      })),
    ),
  );

  const remoteObservedPosition = await bravo.page.evaluate(() =>
    window.__COOKOUT_2_GAME__.bot.position.toArray(),
  );
  const remoteMovementError = Math.hypot(
    remoteObservedPosition[0] - afterMovement[0],
    remoteObservedPosition[2] - afterMovement[2],
  );
  if (remoteMovementError > 2.5) {
    throw new Error(`Opponent interpolation diverged by ${remoteMovementError}.`);
  }

  await bravo.page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  await bravo.page.waitForFunction(
    () =>
      window.__COOKOUT_2_GAME__?.matchType === 'online' &&
      window.__COOKOUT_2_GAME__?.onlineRoomId,
    null,
    { timeout: 20_000 },
  );
  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.waitForFunction(
        () =>
          window.__COOKOUT_2_GAME__?.network.status === 'online' &&
          window.__COOKOUT_2_GAME__?.phase !== 'reconnecting',
        null,
        { timeout: 20_000 },
      ),
    ),
  );
  const resumed = await bravo.page.evaluate(() => ({
    roomId: window.__COOKOUT_2_GAME__.onlineRoomId,
    slot: window.__COOKOUT_2_GAME__.onlineSlot,
    phase: window.__COOKOUT_2_GAME__.phase,
    activeSession: localStorage.getItem('cookout2-active-match'),
  }));
  if (resumed.roomId !== matched[1].roomId || resumed.slot !== matched[1].slot) {
    throw new Error(`Reconnect did not restore the held slot: ${JSON.stringify(resumed)}`);
  }

  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.evaluate(() => window.__COOKOUT_2_GAME__.returnToTitle()),
    ),
  );
  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.waitForFunction(
        () =>
          window.__COOKOUT_2_GAME__?.mode === 'title' &&
          !window.__COOKOUT_2_GAME__?.network.inMatch,
      ),
    ),
  );
  await alpha.page.locator('#private-button').click();
  await alpha.page.locator('#create-room-button').click();
  await alpha.page.waitForFunction(
    () => document.querySelector('#queue-code')?.textContent?.trim().length === 5,
  );
  const privateCode = await alpha.page.locator('#queue-code').textContent();
  await bravo.page.locator('#private-button').click();
  await bravo.page.locator('#room-code-input').fill(privateCode);
  await bravo.page.locator('#join-room-button').click();
  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.waitForFunction(
        (previousRoom) =>
          window.__COOKOUT_2_GAME__?.matchType === 'online' &&
          window.__COOKOUT_2_GAME__?.onlineRoomId &&
          window.__COOKOUT_2_GAME__.onlineRoomId !== previousRoom,
        matched[0].roomId,
        { timeout: 20_000 },
      ),
    ),
  );
  const privateMatch = await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.evaluate(() => ({
        roomId: window.__COOKOUT_2_GAME__.onlineRoomId,
        privateMatch: window.__COOKOUT_2_GAME__.onlinePrivateMatch,
        opponent: window.__COOKOUT_2_GAME__.onlineOpponent,
      })),
    ),
  );
  if (
    privateMatch[0].roomId !== privateMatch[1].roomId ||
    privateMatch.some((entry) => !entry.privateMatch)
  ) {
    throw new Error(`Private room pairing failed: ${JSON.stringify(privateMatch)}`);
  }

  await alpha.page.screenshot({
    path: new URL('multiplayer-alpha.png', output).pathname.slice(1),
    fullPage: true,
  });
  const status = await fetch(`${baseUrl}/api/status`).then((response) =>
    response.json(),
  );
  if (status.rooms < 1 || status.connections < 2) {
    throw new Error(`Server presence metrics are incomplete: ${JSON.stringify(status)}`);
  }
  if (diagnostics.some((entry) => entry.errors.length)) {
    throw new Error(`Browser diagnostics failed: ${JSON.stringify(diagnostics)}`);
  }

  const report = {
    baseUrl,
    matched,
    movementDistance,
    remoteMovementError,
    weaponSync,
    resumed,
    privateCode,
    privateMatch,
    status,
    diagnostics,
  };
  await writeFile(
    new URL('multiplayer-report.json', output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  await Promise.all(
    [alpha.page, bravo.page].map((page) =>
      page.evaluate(() => window.__COOKOUT_2_GAME__.returnToTitle()),
    ),
  );
  await Promise.all([alpha.context.close(), bravo.context.close()]);
} finally {
  await browser.close();
}
