import { launchChromium } from './browser.mjs';
import { WAR_COMBATANT_COUNT } from '../shared/warConfig.js';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const browser = await launchChromium();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#callsign').fill('ROOKIE');
  await page.locator('#start-button').click();
  await page.waitForFunction(() => window.__LARP_GAME__?.mode === 'match');
  await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    game.beginTake();
    game.practiceScoreboardStats = [
      { kills: 3, deaths: 2, assists: 0 },
      { kills: 2, deaths: 3, assists: 0 },
    ];
    window.__LARP_TAB_PREVENTED__ = false;
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Tab') window.__LARP_TAB_PREVENTED__ = event.defaultPrevented;
    });
  });

  await page.keyboard.down('Tab');
  await page.locator('#scoreboard:not(.hidden)').waitFor();
  const held = await page.evaluate(() => {
    const scoreboard = document.querySelector('#scoreboard');
    const bounds = scoreboard.getBoundingClientRect();
    return {
      prevented: window.__LARP_TAB_PREVENTED__,
      headers: [...scoreboard.querySelectorAll('th')].map((cell) => cell.textContent),
      rows: [...scoreboard.querySelectorAll('tbody tr')].map((row) =>
        [...row.cells].map((cell) => cell.textContent)),
      centered: Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) < 2 &&
        Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2) < 2,
    };
  });
  if (
    !held.prevented ||
    !held.centered ||
    JSON.stringify(held.headers) !== JSON.stringify(['Player', 'Kills', 'Deaths', 'Assists']) ||
    JSON.stringify(held.rows) !== JSON.stringify([
      ['ROOKIE', '3', '2', '0'],
      ['Computer', '2', '3', '0'],
    ])
  ) {
    throw new Error(`Held scoreboard is incorrect: ${JSON.stringify(held)}`);
  }

  await page.keyboard.up('Tab');
  await page.waitForFunction(() =>
    document.querySelector('#scoreboard')?.classList.contains('hidden'));

  const warLayout = await page.evaluate((combatantCount) => {
    const game = window.__LARP_GAME__;
    game.ui.showScoreboard(Array.from({ length: combatantCount }, (_, id) => ({
      id,
      name: `Player ${id + 1}`,
      kills: combatantCount - id,
      deaths: id,
      assists: id % 4,
      local: id === 0,
    })));
    const scoreboard = document.querySelector('#scoreboard');
    const body = scoreboard.querySelector('.window-body');
    const bounds = scoreboard.getBoundingClientRect();
    const result = {
      rows: scoreboard.querySelectorAll('tbody tr').length,
      inFrame: bounds.top >= 0 && bounds.bottom <= innerHeight,
      scrollable: body.scrollHeight > body.clientHeight,
    };
    game.ui.hideScoreboard();
    return result;
  }, WAR_COMBATANT_COUNT);
  if (
    warLayout.rows !== WAR_COMBATANT_COUNT ||
    !warLayout.inFrame ||
    !warLayout.scrollable
  ) {
    throw new Error(`War scoreboard layout is incorrect: ${JSON.stringify(warLayout)}`);
  }

  const hud = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    game.ui.updateRespawnCountdown({ dead: true, respawnRemaining: 5_000 });
    const countdown = document.querySelector('#respawn-countdown');
    const countdownBounds = countdown.getBoundingClientRect();
    const five = countdown.textContent.trim();
    game.ui.updateRespawnCountdown({ dead: true, respawnRemaining: 4_000 });
    const four = countdown.textContent.trim();
    game.ui.updateRespawnCountdown({ dead: false, respawnRemaining: 4_000 });
    const countdownHidden = countdown.classList.contains('hidden');

    game.ui.setOnlineMatch(true, 'Opponent');
    game.ui.setConnection('online', 16);
    const ping = document.querySelector('#network-meter');
    const pingBounds = ping.getBoundingClientRect();
    return {
      five,
      four,
      countdownHidden,
      countdownCentered:
        Math.abs(countdownBounds.x + countdownBounds.width / 2 - innerWidth / 2) < 2 &&
        Math.abs(countdownBounds.y + countdownBounds.height / 2 - innerHeight / 2) < 2,
      ping: ping.textContent.trim(),
      pingTopLeft: pingBounds.left < 20 && pingBounds.top < 20,
    };
  });
  if (
    hud.five !== 'Respawn: 5' ||
    hud.four !== 'Respawn: 4' ||
    !hud.countdownHidden ||
    !hud.countdownCentered ||
    hud.ping !== 'Ping: 16 ms' ||
    !hud.pingTopLeft
  ) {
    throw new Error(`HUD placement is incorrect: ${JSON.stringify(hud)}`);
  }

  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  console.log(JSON.stringify({ baseUrl, held, warLayout, hud }, null, 2));
} finally {
  await browser.close();
}
