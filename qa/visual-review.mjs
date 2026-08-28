import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.COOKOUT_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/visual-review/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('#title-screen.active').waitFor();

await page.evaluate(async () => {
  const game = window.__COOKOUT_2_GAME__;
  await game.audio.init();
  game.mode = 'visual-review';
  game.ui.showHUD();
  game.player.viewRoot.visible = true;
});

const loadout = ['scatter', 'machine', 'rail', 'rocket', 'carbine', 'revolver'];
for (let index = 0; index < 3; index += 1) {
  const state = await page.evaluate(
    ({ mapIndex, weapons }) => {
      const game = window.__COOKOUT_2_GAME__;
      game.arena.load(mapIndex, 8800 + mapIndex);
      game.roundLoadout = weapons;
      game.pickups.reset(game.arena.weaponSlots, weapons);
      game.player.reset(
        game.arena.getSpawn('player'),
        game.arena.getSpawnYaw('player'),
      );
      game.player.pitch = -0.11;
      game.player.equip(mapIndex === 0 ? 'carbine' : mapIndex === 1 ? 'scatter' : 'rail', false);
      game.player.updateView(0.5, {
        moving: false,
        speed: 0,
        sprinting: false,
        sliding: false,
        wallRunning: false,
      });
      game.player.syncCamera(0.5);
      game.bot.reset(
        game.arena.getSpawn('bot'),
        game.arena.getSpawnYaw('bot'),
        1,
      );
      game.updateHUD();
      return {
        map: game.arena.map.name,
        spawn: game.player.position.toArray(),
        spawnOverlaps: game.arena
          .getOverlaps(game.player.position, 0.42, 1.8)
          .map((entry) => entry.name),
        meshCount: game.arena.raycastMeshes.length,
        colliderCount: game.arena.colliders.length,
      };
    },
    { mapIndex: index, weapons: loadout },
  );
  await page.waitForTimeout(1400);
  await page.screenshot({
    path: new URL(`map-${index + 1}.png`, output).pathname.slice(1),
    fullPage: true,
  });
  console.log(JSON.stringify(state));
}

await browser.close();
