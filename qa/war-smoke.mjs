import { mkdir, writeFile } from 'node:fs/promises';
import { WAR_CLASSES } from '../shared/warConfig.js';
import { launchChromium } from './browser.mjs';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const selectedClass = process.env.LARP_WAR_CLASS || 'greatsword';
const ammoFree = new Set(['knives', 'shortbow', 'longbow', 'greatsword']).has(selectedClass);
const artifactSuffix = selectedClass === 'greatsword' ? '' : `-${selectedClass}`;
const output = new URL('../artifacts/war-review/', import.meta.url);
await mkdir(output, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#game-mode').selectOption('war');
  await page.locator('#war-class').selectOption(selectedClass);
  await page.screenshot({
    path: new URL(`mode-selector${artifactSuffix}.png`, output).pathname,
  });
  await page.locator('#online-button').click();
  await page.waitForFunction(
    () => {
      const game = window.__LARP_GAME__;
      return game?.matchType === 'war' && game.warSnapshot?.combatants?.length === 80;
    },
    null,
    { timeout: 20_000 },
  );
  const initialAck = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const local = game.warSnapshot.combatants.find(
      (combatant) => combatant.id === game.warSlot,
    );
    game.sendWarState();
    return Number(local?.ack) || 0;
  });
  await page.waitForFunction(
    (previousAck) => {
      const game = window.__LARP_GAME__;
      const local = game?.warSnapshot?.combatants?.find(
        (combatant) => combatant.id === game.warSlot,
      );
      return local?.ack > previousAck;
    },
    initialAck,
    { timeout: 10_000 },
  );
  // A newly spawned combatant starts inside the server-authoritative attack
  // cooldown. Waiting a full class interval also absorbs a pointer click that
  // may have reached the game while the mode button handed off to the canvas.
  await page.waitForTimeout(WAR_CLASSES[selectedClass].attackMs + 150);
  await page.evaluate((isFireball) => {
    const game = window.__LARP_GAME__;
    game.onlinePaused = true;
    game.onlineStateHistory.clear();
    game.player.position.set(0, 0.02, 24);
    game.player.yaw = game.warTeam === 1 ? Math.PI : 0;
    // Aim the replication probe steeply above the crowded drop-in skirmish so
    // its authoritative projectile survives long enough for two snapshots.
    game.player.pitch = isFireball ? 1.25 : -0.04;
    game.player.syncCamera(1 / 60);
    game.warLastAttackAt = -Infinity;
    if (isFireball) {
      const probe = {
        firstShotId: game.onlineShotSequence + 1,
        attemptedShotId: null,
        shotId: null,
        lastAttemptAt: -Infinity,
        projectileId: null,
        shotAck: 0,
        before: null,
        after: null,
      };
      window.__LARP_WAR_FIREBALL_PROBE__ = probe;
      const captureProjectile = (event) => {
        const message = event.detail;
        if (
          message?.event === 'attack' &&
          message.shooter === game.warSlot &&
          message.shotId >= probe.firstShotId &&
          message.projectile
        ) {
          probe.shotId = message.shotId;
          probe.projectileId = message.projectile.id;
          const visual = game.onlineProjectiles.get(probe.projectileId);
          if (visual) probe.before = visual.position.toArray();
          game.network.removeEventListener('war_event', captureProjectile);
        }
      };
      game.network.addEventListener('war_event', captureProjectile);
      const sampleProjectile = () => {
        const local = game.warSnapshot?.combatants?.find(
          (combatant) => combatant.id === game.warSlot,
        );
        probe.shotAck = Number(local?.shotAck) || 0;
        const expectedShotId = probe.shotId ?? probe.attemptedShotId;
        if (
          !probe.projectileId &&
          expectedShotId != null &&
          probe.shotAck >= expectedShotId
        ) {
          const state = game.warSnapshot?.projectiles
            ?.filter((projectile) => projectile.owner === game.warSlot)
            .sort((left, right) => right.id - left.id)[0];
          probe.projectileId = state?.id ?? null;
          if (probe.projectileId) probe.shotId = expectedShotId;
        }
        const position = game.onlineProjectiles
          .get(probe.projectileId)?.position.toArray();
        if (position && !probe.before) probe.before = position;
        if (position && probe.before) {
          const travel = Math.hypot(...position.map(
            (value, index) => value - probe.before[index],
          ));
          if (travel >= 0.2) probe.after = position;
        }
        if (!probe.after || probe.shotAck < probe.shotId) {
          requestAnimationFrame(sampleProjectile);
        }
      };
      requestAnimationFrame(sampleProjectile);
      const retryFireball = () => {
        if (probe.projectileId || probe.after) return;
        const local = game.warSnapshot?.combatants?.find(
          (combatant) => combatant.id === game.warSlot,
        );
        if (
          local &&
          !local.dead &&
          !game.player.dead &&
          game.elapsed - probe.lastAttemptAt >= 1.2
        ) {
          game.player.ammo = Math.max(1, Number(local.ammo) || 1);
          game.player.reloading = false;
          game.warLastAttackAt = -Infinity;
          probe.attemptedShotId = game.onlineShotSequence + 1;
          probe.lastAttemptAt = game.elapsed;
          const restingPitch = game.player.pitch;
          game.player.pitch = 1.25;
          game.player.syncCamera(1 / 60);
          game.fireWarWeapon();
          game.player.pitch = restingPitch;
          game.player.syncCamera(1 / 60);
        }
        requestAnimationFrame(retryFireball);
      };
      requestAnimationFrame(retryFireball);
    }
    if (game.warClassId !== 'knives' && !isFireball) game.fireWarWeapon();
    if (isFireball) {
      game.player.pitch = -0.04;
      game.player.syncCamera(1 / 60);
    }
  }, selectedClass === 'fireball');
  let heldKnifeThrows = null;
  if (selectedClass === 'knives') {
    heldKnifeThrows = await page.evaluate((cadence) => {
      const game = window.__LARP_GAME__;
      const start = game.onlineShotSequence;
      const startTime = game.elapsed;
      game.player.buttons.add(0);
      // Sample one render frame beyond the exact floating-point boundary, as
      // real held input does, while still proving that the halfway update is
      // rejected and the one-second cadence repeats without another click.
      for (const offset of [0, cadence / 2, cadence + 1 / 60]) {
        game.elapsed = startTime + offset;
        const movement = game.player.update(1 / 60, true);
        if (movement.fire) game.fireWarWeapon();
      }
      game.player.buttons.delete(0);
      return game.onlineShotSequence - start;
    }, WAR_CLASSES.knives.attackMs / 1_000);
  }
  let fireballMotion = null;
  if (selectedClass === 'fireball') {
    let motionHandle;
    try {
      motionHandle = await page.waitForFunction(() => {
        const probe = window.__LARP_WAR_FIREBALL_PROBE__;
        return probe?.shotId != null &&
          probe?.shotAck >= probe?.shotId && probe?.before && probe?.after
          ? { before: probe.before, after: probe.after }
          : null;
      }, null, { polling: 50, timeout: 20_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const game = window.__LARP_GAME__;
        const local = game?.warSnapshot?.combatants?.find(
          (combatant) => combatant.id === game.warSlot,
        );
        return {
          probe: window.__LARP_WAR_FIREBALL_PROBE__,
          phase: game?.phase,
          playerDead: game?.player?.dead,
          localDead: local?.dead,
          localShotAck: local?.shotAck,
          onlineShotSequence: game?.onlineShotSequence,
        };
      });
      throw new Error(`Fireball replication probe timed out: ${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }
    fireballMotion = await motionHandle.jsonValue();
    await motionHandle.dispose();
  }
  await page.waitForTimeout(250);
  await page.screenshot({
    path: new URL(`war-gameplay${artifactSuffix}.png`, output).pathname,
  });

  const state = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    const local = game.warSnapshot.combatants.find(
      (combatant) => combatant.id === game.warSlot,
    );
    return {
      matchType: game.matchType,
      phase: game.phase,
      team: game.warTeam,
      slot: game.warSlot,
      localClass: local.classId,
      combatants: game.warSnapshot.combatants.length,
      teams: [0, 1].map((team) =>
        game.warSnapshot.combatants.filter((combatant) => combatant.team === team).length),
      humans: game.warSnapshot.combatants.filter((combatant) => combatant.human).length,
      pickups: game.warSnapshot.pickups.length,
      localAck: local.ack,
      onlineShotSequence: game.onlineShotSequence,
      crowd: {
        capacity: game.warCrowd.capacity,
        visible: game.warCrowd.visibleCount,
        stateCount: game.warCrowd.states.size,
      },
      foliage: {
        count: game.warArena.foliageCutouts.length,
        fixed: game.warArena.foliageCutouts.every((cutout) =>
          cutout.children.length === 2 &&
          cutout.children.every((child) => child.type === 'Mesh') &&
          cutout.children[0].material === cutout.children[1].material &&
          cutout.children[0].rotation.y === 0 &&
          cutout.children[1].rotation.y === Math.PI / 2),
      },
      ui: {
        arenaScoreHidden: document.querySelector('#arena-score').classList.contains('hidden'),
        warScoreHidden: document.querySelector('#war-score').classList.contains('hidden'),
        ammoHidden: document.querySelector('.health-panel').classList.contains('ammo-free'),
        modeValue: document.querySelector('#game-mode').value,
        classValue: document.querySelector('#war-class').value,
        titleBackground: style('#title-screen').backgroundImage,
        windowBorderRadius: style('.match-header').borderRadius,
      },
      errors: [...(window.__LARP_ERRORS__ ?? [])],
    };
  });
  const report = { baseUrl, selectedClass, state, heldKnifeThrows, fireballMotion, errors };
  await writeFile(
    new URL(`report${artifactSuffix}.json`, output),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (state.matchType !== 'war') throw new Error('War did not start.');
  if (state.combatants !== 80 || state.teams.some((count) => count !== 40)) {
    throw new Error(`War teams are not 40v40: ${JSON.stringify(state.teams)}`);
  }
  if (state.pickups !== 0) throw new Error('War exposed field pickups.');
  if (state.localClass !== selectedClass) throw new Error('Selected War class was not applied.');
  if (state.localAck < 1) throw new Error('Server did not acknowledge War movement.');
  if (state.onlineShotSequence < 1) throw new Error('War attack was not sent.');
  if (selectedClass === 'knives' && heldKnifeThrows < 2) {
    throw new Error(`Held War knives did not repeat: ${heldKnifeThrows}`);
  }
  if (state.crowd.capacity !== 79 || state.crowd.visible > state.crowd.capacity) {
    throw new Error(`War crowd exceeded its pool: ${JSON.stringify(state.crowd)}`);
  }
  if (state.crowd.stateCount !== 80) throw new Error('Client did not retain all War records.');
  if (!state.foliage.fixed || state.foliage.count < 20) {
    throw new Error(`War foliage contract failed: ${JSON.stringify(state.foliage)}`);
  }
  if (
    !state.ui.arenaScoreHidden ||
    state.ui.warScoreHidden ||
    state.ui.ammoHidden !== ammoFree
  ) {
    throw new Error(`War HUD visibility failed: ${JSON.stringify(state.ui)}`);
  }
  if (state.ui.windowBorderRadius !== '0px') {
    throw new Error(`War window is not square Win98 chrome: ${state.ui.windowBorderRadius}`);
  }
  if (selectedClass === 'fireball') {
    if (!fireballMotion?.before || !fireballMotion?.after) {
      throw new Error('The authoritative fireball was not represented in the client projectile pool.');
    }
    const travel = Math.hypot(...fireballMotion.after.map(
      (value, index) => value - fireballMotion.before[index],
    ));
    if (travel < 0.2) throw new Error(`The War fireball did not move (${travel}).`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  try {
    await page.evaluate(() => window.__LARP_GAME__?.network?.leave());
    await page.waitForTimeout(150);
  } catch {
    // The browser may already be gone after an earlier assertion.
  }
  await browser.close();
}
