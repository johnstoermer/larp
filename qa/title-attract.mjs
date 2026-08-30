import { mkdir } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/title-attract/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function titleLayout() {
  return page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const title = document.querySelector('#title-screen');
    const titleWindow = document.querySelector('.title-copy');
    const bounds = titleWindow.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const actors = game.titleAttract.actors.map((record) => {
      const projected = record.controller.getBodyCenter().project(game.camera);
      return {
        id: record.definition.id,
        weapon: record.definition.weapon,
        visible: record.controller.root.visible,
        state: record.controller.fighterState,
        screen: [
          (projected.x * 0.5 + 0.5) * width,
          (-projected.y * 0.5 + 0.5) * height,
          projected.z,
        ],
      };
    });
    return {
      mode: game.mode,
      audioStarted: Boolean(game.audio.context),
      coverBackground: getComputedStyle(title).backgroundImage,
      controlsWindowCount: document.querySelectorAll('.title-controls').length,
      titleWindow: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      },
      viewport: [width, height],
      actors,
      attract: game.titleAttract.snapshot(),
      gameplayBotVisible: game.bot.root.visible,
      gameplayBotIsAttractActor: game.titleAttract.actors.some(
        (record) => record.controller === game.bot,
      ),
    };
  });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#title-screen.active').waitFor();
  await page.waitForFunction(() =>
    window.__LARP_GAME__?.titleAttract?.active &&
    window.__LARP_GAME__.titleAttract.snapshot().actors.length >= 4,
  );

  const initial = await titleLayout();
  assert(initial.mode === 'title', `home opened in ${initial.mode} mode`);
  assert(!initial.audioStarted, 'title combat initialized audio before interaction');
  assert(!/cover\.webp/i.test(initial.coverBackground), `static cover remains: ${initial.coverBackground}`);
  assert(initial.controlsWindowCount === 0, 'secondary Controls window still obscures the battle');
  assert(initial.attract.actors.length >= 4, 'fewer than four title fighters were created');
  assert(
    new Set(initial.attract.actors.map((actor) => actor.weapon)).size >= 4,
    'title fighters do not have distinct weapon identities',
  );
  assert(initial.attract.actors.every((actor) => actor.visible), 'a title fighter started hidden');
  assert(!initial.gameplayBotVisible, 'the live-match bot leaked into title combat');
  assert(!initial.gameplayBotIsAttractActor, 'title combat reused the live-match opponent');

  const initialPositions = initial.attract.actors.map((actor) => actor.position);
  await page.waitForFunction(() => {
    const stats = window.__LARP_GAME__?.titleAttract?.snapshot().stats;
    return stats &&
      stats.attacks >= 6 &&
      stats.hits >= 6 &&
      stats.deaths >= 1 &&
      stats.respawns >= 1 &&
      ['walk', 'attack', 'hit', 'death'].every((state) => stats.observedStates.includes(state));
  }, null, { timeout: 12_000 });
  const active = await titleLayout();
  assert(
    active.attract.actors.some((actor, actorIndex) =>
      actor.position.some((value, axis) => Math.abs(value - initialPositions[actorIndex][axis]) > 0.15)),
    'title fighters did not move over time',
  );
  assert(!active.audioStarted, 'silent title combat started an AudioContext while running');
  await page.screenshot({
    path: pathFromUrl(new URL('desktop.png', output)),
    fullPage: true,
  });

  await page.setViewportSize({ width: 720, height: 900 });
  await page.waitForTimeout(250);
  const narrow = await titleLayout();
  const visibleToRight = narrow.actors.filter(({ visible, screen }) =>
    visible &&
    screen[2] >= -1 && screen[2] <= 1 &&
    screen[0] > narrow.titleWindow.right + 4 &&
    screen[0] < narrow.viewport[0] - 4 &&
    screen[1] > 4 && screen[1] < narrow.viewport[1] - 4,
  );
  assert(
    visibleToRight.length >= 2,
    `only ${visibleToRight.length} fighters are readable beside the narrow title window: ${JSON.stringify(narrow)}`,
  );
  await page.screenshot({
    path: pathFromUrl(new URL('narrow.png', output)),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#callsign').fill('BOT TEST');
  assert(await page.locator('#callsign').inputValue() === 'BOT TEST', 'title name field is unusable');
  const sessionBeforeMatch = active.attract.session;
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__LARP_GAME__?.mode === 'match');
  const matchState = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    return {
      attractActive: game.titleAttract.active,
      attractVisible: game.titleAttract.actors.map((record) => record.controller.root.visible),
      gameplayBotVisible: game.bot.root.visible,
      gameplayBotIsDistinct: game.titleAttract.actors.every(
        (record) => record.controller !== game.bot,
      ),
      playerViewVisible: game.player.viewRoot.visible,
      networkProjectilesContainAttractActor: [...game.onlineProjectiles.values()].some((entry) =>
        game.titleAttract.actors.some((record) => record.controller === entry),
      ),
    };
  });
  assert(!matchState.attractActive, 'title simulation kept updating in a live match');
  assert(matchState.attractVisible.every((visible) => !visible), 'a title actor leaked into a live match');
  assert(matchState.gameplayBotVisible, 'live-match opponent was hidden by title cleanup');
  assert(matchState.gameplayBotIsDistinct, 'live match reused an attract actor');
  assert(matchState.playerViewVisible, 'live player view was hidden by title cleanup');
  assert(!matchState.networkProjectilesContainAttractActor, 'attract state leaked into network projectiles');

  await page.evaluate(() => window.__LARP_GAME__.returnToTitle());
  await page.locator('#title-screen.active').waitFor();
  await page.waitForFunction(
    (previous) => {
      const snapshot = window.__LARP_GAME__?.titleAttract?.snapshot();
      return snapshot?.active && snapshot.session === previous + 1;
    },
    sessionBeforeMatch,
  );
  const returned = await page.evaluate(() => window.__LARP_GAME__.titleAttract.snapshot());
  assert(returned.time < 0.75, `returning home did not reset the title clock: ${returned.time}`);
  assert(returned.actors.every((actor) => actor.visible && actor.health === 100), 'returning home did not reset actors');

  if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({
    titleAttract: 'ok',
    fighters: active.attract.actors.map((actor) => actor.weapon),
    stats: active.attract.stats,
    desktop: pathFromUrl(new URL('desktop.png', output)),
    narrow: pathFromUrl(new URL('narrow.png', output)),
  }, null, 2));
} finally {
  await browser.close();
}
