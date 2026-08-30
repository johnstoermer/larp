import { mkdir, writeFile } from 'node:fs/promises';
import { launchChromium, pathFromUrl } from './browser.mjs';
import { WAR_COMBATANT_COUNT, WAR_TEAM_SIZE } from '../shared/warConfig.js';

const baseUrl = process.env.LARP_URL || 'http://127.0.0.1:8080';
const output = new URL('../artifacts/war-performance/', import.meta.url);
await mkdir(output, { recursive: true });

const viewports = Object.freeze({
  desktop: { width: 1440, height: 900 },
  narrow: { width: 720, height: 900 },
});
const angleBackend = (process.env.LARP_WAR_ANGLE_BACKEND || '').trim();
const remoteCombatantCount = WAR_COMBATANT_COUNT - 1;
const nearHealthBarMinimum = Math.floor(remoteCombatantCount * 0.85);

function summarize(samples) {
  const sorted = [...samples].sort((first, second) => first - second);
  const percentile = (ratio) => sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
  return {
    count: samples.length,
    mean: samples.reduce((total, value) => total + value, 0) / Math.max(1, samples.length),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? 0,
    over16ms: samples.filter((value) => value > 16.7).length,
    over25ms: samples.filter((value) => value > 25).length,
  };
}

async function sampleFrames(page, count = 300) {
  const sample = await page.evaluate((frameCount) => new Promise((resolve) => {
    const frameDeltas = [];
    const longTasks = [];
    const crowd = window.__WAR_PERFORMANCE__;
    crowd.updateSamples.length = 0;
    const observer = typeof PerformanceObserver === 'undefined'
      ? null
      : new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
    try {
      observer?.observe({ type: 'longtask', buffered: false });
    } catch {
      // Some browsers do not expose long-task entries in headless contexts.
    }
    let previous = 0;
    const step = (now) => {
      if (previous) frameDeltas.push(now - previous);
      previous = now;
      if (frameDeltas.length < frameCount) {
        requestAnimationFrame(step);
        return;
      }
      observer?.disconnect();
      resolve({
        frameDeltas,
        crowdUpdates: [...crowd.updateSamples],
        longTasks,
        renderState: window.__LARP_GAME__.rendering.getPerformanceState(),
      });
    };
    requestAnimationFrame(step);
  }), count);
  return {
    frames: summarize(sample.frameDeltas),
    crowdUpdate: summarize(sample.crowdUpdates),
    longTasks: summarize(sample.longTasks),
    renderState: sample.renderState,
  };
}

async function collectHeap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  return cdp.send('Runtime.getHeapUsage');
}

async function releaseGameplayFullscreenForResize(page, viewport) {
  await page.evaluate(async () => {
    const game = window.__LARP_GAME__;
    game?.releaseGameplayKeyboard();
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      try {
        await document.exitFullscreen();
      } catch {
        // The game's asynchronous release may win the fullscreen-exit race.
      }
    }
  });
  await page.waitForFunction(() => document.fullscreenElement == null, null, {
    timeout: 5_000,
  });
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.__LARP_GAME__?.ui.hidePause());
}

const browser = await launchChromium({
  forceSoftwareWebgl: false,
  args: [
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    ...(angleBackend ? [`--use-angle=${angleBackend}`] : []),
  ],
});
const page = await browser.newPage({
  viewport: viewports.desktop,
  deviceScaleFactor: 1,
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Runtime.enable');
await cdp.send('HeapProfiler.enable');

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#game-mode').selectOption('war');
  await page.locator('#war-class').selectOption('lightning');
  await page.locator('#online-button').click();
  await page.waitForFunction((combatantCount) => {
    const game = window.__LARP_GAME__;
    return game?.matchType === 'war' &&
      game.warSnapshot?.combatants?.length === combatantCount;
  }, WAR_COMBATANT_COUNT, { timeout: 20_000 });
  await releaseGameplayFullscreenForResize(page, viewports.desktop);

  const harness = await page.evaluate(({ combatantCount, teamSize }) => {
    const game = window.__LARP_GAME__;
    const crowd = game.warCrowd;
    const classIds = ['shortbow', 'crossbow', 'greatsword', 'lightning'];
    const maxHealth = { shortbow: 90, crossbow: 105, greatsword: 160, lightning: 115 };
    const nativeNetworkHandler = game.network.handleMessage.bind(game.network);
    game.network.handleMessage = (raw) => {
      try {
        const message = JSON.parse(raw);
        if (message.type === 'war_snapshot' || message.type === 'war_event') return;
      } catch {
        // Let the native handler own malformed-message behavior.
      }
      nativeNetworkHandler(raw);
    };
    game.onlinePaused = true;
    game.phase = 'control';
    game.mode = 'match';
    game.player.dead = false;
    game.player.position.set(0, 0.02, 24);
    game.player.velocity.set(0, 0, 0);
    game.player.yaw = 0;
    game.player.pitch = -0.08;
    game.player.syncCamera(1);

    const slotRefs = [...crowd.slots];
    const rootRefs = crowd.slots.map((slot) => slot.root);
    const spriteMaterialRefs = crowd.slots.map((slot) => slot.spriteMaterial);
    const healthTextureRefs = crowd.slots.map((slot) => slot.healthTexture);
    const priorDead = new Map();
    const performanceState = {
      timer: 0,
      tick: 0,
      updateSamples: [],
      slotRefs,
      rootRefs,
      spriteMaterialRefs,
      healthTextureRefs,
      priorDead,
      events: {
        snapshots: 0,
        projectileAttacks: 0,
        meleeAttacks: 0,
        damageNumbers: 0,
        deaths: 0,
        respawns: 0,
        controlChanges: 0,
        peakTransients: 0,
        peakParticles: 0,
      },
    };

    const nativeCrowdUpdate = crowd.update.bind(crowd);
    crowd.update = (...args) => {
      const startedAt = performance.now();
      const result = nativeCrowdUpdate(...args);
      if (performanceState.updateSamples.length < 4_000) {
        performanceState.updateSamples.push(performance.now() - startedAt);
      }
      return result;
    };

    const makeStates = (tick, scenario = 'near') => Array.from({ length: combatantCount }, (_, id) => {
      const classId = classIds[id % classIds.length];
      const local = id === game.warSlot;
      const angle = id * 2.399963229728653;
      let radius = 5 + (id % 10) * 1.8;
      let x = Math.cos(angle) * radius;
      let z = Math.sin(angle) * radius;
      if (scenario === 'far' && id >= teamSize) {
        radius = 96 + (id % 8) * 3;
        x = Math.cos(angle) * radius;
        z = Math.sin(angle) * radius;
      } else if (scenario === 'cull' && id >= 12) {
        x = 215 + (id % 8) * 3;
        z = (id % 9) * 4;
      }
      if (local) {
        x = 0;
        z = 24;
      }
      const churn = scenario === 'churn';
      const dead = !local && churn && id % 10 === Math.floor(tick / 5) % 10;
      const health = dead
        ? 0
        : churn && id % 5 === tick % 5
          ? Math.max(1, maxHealth[classId] - 12 - (tick % 4) * 7)
          : maxHealth[classId];
      return {
        id,
        team: id < teamSize ? 0 : 1,
        slot: id,
        teamSlot: id % teamSize,
        human: local,
        name: local ? 'You' : `Bot ${id % teamSize + 1}`,
        classId,
        weapon: classId,
        position: [x, 0.02, z],
        velocity: dead ? [0, 0, 0] : [id % 3 ? 0.8 : 0, 0, id % 3 ? -0.35 : 0],
        yaw: angle + Math.PI,
        pitch: 0,
        health,
        maxHealth: maxHealth[classId],
        dead,
        respawnRemaining: dead ? 4_000 : 0,
        attackSequence: churn ? Math.floor((tick + id % 4) / 3) : tick,
        ack: local ? tick : 0,
      };
    });

    const apply = (tick, scenario = 'near') => {
      const states = makeStates(tick, scenario);
      const receivedAt = performance.now();
      const control = {
        phase: 'control',
        owner: tick % 3 === 0 ? null : tick % 2,
        capturingTeam: tick % 2,
        contested: tick % 4 === 0,
        progress: (tick * 13) % 100,
        scores: [(tick * 3) % 100, (tick * 5) % 100],
        occupancy: [teamSize, teamSize],
      };
      game.warSnapshot = {
        serverTime: Date.now(),
        mode: 'war',
        mapId: 'war-field',
        phase: 'control',
        control,
        combatants: states,
        pickups: [],
        winner: null,
      };
      crowd.applySnapshot(states, receivedAt);
      game.warArena.setControlState(control);
      crowd.update(game.camera, 1 / 60, receivedAt + 1);
      performanceState.events.snapshots += 1;

      if (scenario === 'churn') {
        for (const state of states) {
          const wasDead = priorDead.get(state.id) ?? false;
          if (!wasDead && state.dead) performanceState.events.deaths += 1;
          if (wasDead && !state.dead) performanceState.events.respawns += 1;
          priorDead.set(state.id, state.dead);
        }
        performanceState.events.controlChanges += 1;
        const attacker = states[(tick * 7 + 1) % states.length];
        const target = states[(tick * 11 + 43) % states.length];
        const dx = target.position[0] - attacker.position[0];
        const dz = target.position[2] - attacker.position[2];
        const length = Math.max(0.001, Math.hypot(dx, dz));
        game.handleWarEvent({
          event: 'attack',
          shooter: attacker.id,
          classId: attacker.classId,
          origin: [attacker.position[0], 1.45, attacker.position[2]],
          direction: [dx / length, 0, dz / length],
          hitPoint: [target.position[0], 1.1, target.position[2]],
          hit: true,
          target: target.id,
          damage: 18,
        });
        if (attacker.classId === 'greatsword') performanceState.events.meleeAttacks += 1;
        else performanceState.events.projectileAttacks += 1;
        if (tick % 3 === 0) {
          game.handleWarEvent({
            event: 'attack',
            shooter: game.warSlot,
            classId: game.warClassId,
            hit: true,
            hits: [{ target: target.id, damage: 18 }],
            origin: [0, 1.45, 24],
            direction: [dx / length, 0, dz / length],
          });
          performanceState.events.damageNumbers += 1;
        }
        performanceState.events.peakTransients = Math.max(
          performanceState.events.peakTransients,
          game.vfx.transients.length,
        );
        performanceState.events.peakParticles = Math.max(
          performanceState.events.peakParticles,
          game.vfx.particles.length,
        );
      }
      return states;
    };

    const startChurn = () => {
      clearInterval(performanceState.timer);
      performanceState.timer = window.setInterval(() => {
        performanceState.tick += 1;
        apply(performanceState.tick, 'churn');
      }, 100);
    };
    const stopChurn = () => {
      clearInterval(performanceState.timer);
      performanceState.timer = 0;
    };

    Object.assign(performanceState, { makeStates, apply, startChurn, stopChurn });
    window.__WAR_PERFORMANCE__ = performanceState;
    apply(0, 'near');
    return {
      combatants: crowd.states.size,
      capacity: crowd.capacity,
      slots: crowd.slots.length,
      localId: crowd.localId,
    };
  }, {
    combatantCount: WAR_COMBATANT_COUNT,
    teamSize: WAR_TEAM_SIZE,
  });

  const lodAndPool = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const probe = window.__WAR_PERFORMANCE__;
    const crowd = game.warCrowd;
    const cameraPosition = game.camera.position;
    const describe = () => {
      const selected = [...crowd.slotById.values()];
      return {
        visible: crowd.visibleCount,
        assigned: crowd.slotById.size,
        healthBars: selected.filter((slot) => slot.healthBar.visible).length,
        attackOrHit: selected.filter((slot) =>
          slot.fighterState === 'attack' || slot.fighterState === 'hit').length,
        farAttackOrHit: selected.filter((slot) => {
          const far = slot.root.position.distanceToSquared(cameraPosition) > 72 ** 2;
          return far && (slot.fighterState === 'attack' || slot.fighterState === 'hit');
        }).length,
      };
    };

    crowd.clear();
    probe.apply(1, 'near');
    const firstMapping = crowd.slots.map((slot) => slot.id);
    const near = describe();
    crowd.clear();
    probe.apply(1, 'near');
    const secondMapping = crowd.slots.map((slot) => slot.id);
    const deterministic = JSON.stringify(firstMapping) === JSON.stringify(secondMapping);

    probe.apply(2, 'far');
    const far = describe();
    probe.apply(3, 'cull');
    const culled = describe();
    const safetyStates = probe.makeStates(4, 'near');
    const safetyActors = safetyStates.filter((state) => state.id !== crowd.localId).slice(0, 2);
    safetyActors[0].position = [0, 0.02, 26];
    safetyActors[1].position = [0, 0.02, 23.5];
    crowd.applySnapshot(safetyStates, performance.now());
    crowd.update(game.camera, 1 / 60, performance.now() + 1);
    const behindSlot = crowd.slotById.get(safetyActors[0].id);
    const nearSlot = crowd.slotById.get(safetyActors[1].id);
    const healthBarSafety = {
      behindVisible: behindSlot?.healthBar.visible ?? true,
      nearVisible: nearSlot?.healthBar.visible ?? true,
      fightersVisible: Boolean(behindSlot?.root.visible && nearSlot?.root.visible),
    };
    probe.apply(0, 'near');

    return {
      near,
      far,
      culled,
      healthBarSafety,
      deterministic,
      poolStable:
        crowd.slots.every((slot, index) => slot === probe.slotRefs[index]) &&
        crowd.slots.every((slot, index) => slot.root === probe.rootRefs[index]) &&
        crowd.slots.every((slot, index) =>
          slot.spriteMaterial === probe.spriteMaterialRefs[index]) &&
        crowd.slots.every((slot, index) =>
          slot.healthTexture === probe.healthTextureRefs[index]),
    };
  });

  const stableHealthAndCpu = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const probe = window.__WAR_PERFORMANCE__;
    const crowd = game.warCrowd;
    const states = probe.apply(0, 'near');
    const versions = crowd.slots.map((slot) => slot.healthTexture.version);
    const startedAt = performance.now();
    for (let index = 0; index < 2_000; index += 1) {
      crowd.update(game.camera, 1 / 60, 10_000 + index);
    }
    const stableElapsed = performance.now() - startedAt;
    const stableVersionChanges = crowd.slots.filter(
      (slot, index) => slot.healthTexture.version !== versions[index],
    ).length;
    const changedStates = states.map((state) => ({
      ...state,
      health: state.id === crowd.localId ? state.health : state.maxHealth * 0.5,
    }));
    const changedStartedAt = performance.now();
    crowd.applySnapshot(changedStates, 20_000);
    crowd.update(game.camera, 1 / 60, 20_001);
    const changedElapsed = performance.now() - changedStartedAt;
    const changedVersionCount = crowd.slots.filter(
      (slot, index) => slot.healthTexture.version !== versions[index],
    ).length;
    probe.apply(0, 'near');
    return {
      iterations: 2_000,
      elapsed: stableElapsed,
      meanUpdate: stableElapsed / 2_000,
      stableVersionChanges,
      changedVersionCount,
      changedElapsed,
    };
  });

  const heapBeforeFrames = await collectHeap(cdp);
  await page.evaluate(() => window.__WAR_PERFORMANCE__.startChurn());
  await page.waitForTimeout(1_500);

  const desktop = await sampleFrames(page);
  await page.screenshot({
    path: pathFromUrl(new URL('desktop-convergence.png', output)),
  });

  await page.setViewportSize(viewports.narrow);
  await page.waitForTimeout(500);
  const narrow = await sampleFrames(page);
  await page.screenshot({
    path: pathFromUrl(new URL('narrow-convergence.png', output)),
  });
  const heapAfterFrames = await collectHeap(cdp);

  await page.setViewportSize(viewports.desktop);
  await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const probe = window.__WAR_PERFORMANCE__;
    probe.stopChurn();
    probe.apply(0, 'near');
    game.vfx.clear();
  });
  await page.waitForTimeout(250);

  const resourceAndDraw = await page.evaluate(async () => {
    const game = window.__LARP_GAME__;
    const renderer = game.rendering.renderer;
    const materials = new Set();
    const geometries = new Set();
    const textures = new Set();
    game.scene.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of nodeMaterials) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });

    game.running = false;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderer.info.autoReset = false;
    renderer.info.reset();
    game.rendering.render(1 / 60, game.elapsed + 1 / 60);
    const render = { ...renderer.info.render };
    const memory = { ...renderer.info.memory };
    renderer.info.autoReset = true;

    const crowd = game.warCrowd;
    return {
      scene: {
        materials: materials.size,
        geometries: geometries.size,
        textures: textures.size,
      },
      renderer: { render, memory },
      crowd: {
        slots: crowd.slots.length,
        assigned: crowd.slotById.size,
        uniqueSpriteMaterials: new Set(crowd.slots.map((slot) => slot.spriteMaterial)).size,
        uniqueHealthMaterials: new Set(crowd.slots.map((slot) => slot.healthBar.material)).size,
        uniqueHealthTextures: new Set(crowd.slots.map((slot) => slot.healthTexture)).size,
        uniqueFighterTextures: new Set(crowd.slots.map((slot) => slot.spriteMaterial.map)).size,
        healthBars: crowd.slots.filter((slot) => slot.healthBar.visible).length,
      },
      graphics: (() => {
        const context = renderer.getContext();
        const debug = context.getExtension('WEBGL_debug_renderer_info');
        return {
          vendor: context.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR),
          renderer: context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER),
        };
      })(),
    };
  });

  const reloadLifetime = await page.evaluate(() => {
    const game = window.__LARP_GAME__;
    const renderer = game.rendering.renderer;
    renderer.info.autoReset = false;
    game.warArena.load(0, 100);
    renderer.render(game.scene, game.camera);
    const before = { ...renderer.info.memory };
    const samples = [];
    for (let index = 1; index <= 8; index += 1) {
      game.warArena.load(0, 100 + index);
      renderer.render(game.scene, game.camera);
      samples.push({ ...renderer.info.memory });
    }
    const after = { ...renderer.info.memory };
    renderer.info.autoReset = true;
    return {
      before,
      after,
      samples,
      geometryGrowth: after.geometries - before.geometries,
      textureGrowth: after.textures - before.textures,
      sharedFoliageGeometries: game.warArena.foliageGeometries.size,
      sharedFoliageMaterials: game.warArena.foliageMaterials.size,
    };
  });

  const arenaUnaffected = await page.evaluate(async () => {
    const game = window.__LARP_GAME__;
    game.setupTitleScene();
    game.titleAttract.stop();
    await game.startMatch();
    game.beginTake();
    return {
      matchType: game.matchType,
      arenaIsBase: game.arena === game.baseArena,
      baseVisible: game.baseArena.root.visible,
      warVisible: game.warArena.root.visible,
      crowdVisible: game.warCrowd.root.visible,
      crowdStates: game.warCrowd.states.size,
      mapId: game.arena.map.id,
      phase: game.phase,
      colliders: game.arena.colliders.length,
      raycastMeshes: game.arena.raycastMeshes.length,
      botVisible: game.bot.root.visible,
    };
  });

  const softwareRenderer = /swiftshader|llvmpipe|software/i.test(
    `${resourceAndDraw.graphics.vendor} ${resourceAndDraw.graphics.renderer}`,
  );
  const events = await page.evaluate(() => ({ ...window.__WAR_PERFORMANCE__.events }));
  const report = {
    baseUrl,
    viewports,
    harness,
    lodAndPool,
    stableHealthAndCpu,
    frameSamples: { desktop, narrow },
    heap: {
      before: heapBeforeFrames,
      after: heapAfterFrames,
      usedGrowth: heapAfterFrames.usedSize - heapBeforeFrames.usedSize,
      embedderHeapGrowth:
        heapAfterFrames.embedderHeapUsedSize - heapBeforeFrames.embedderHeapUsedSize,
    },
    resourceAndDraw,
    reloadLifetime,
    arenaUnaffected,
    events,
    performanceGate: {
      enforced: !softwareRenderer,
      frameP95Ms: 25,
      renderer: softwareRenderer ? 'software' : 'hardware',
    },
    errors,
  };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (
    harness.combatants !== WAR_COMBATANT_COUNT ||
    harness.capacity !== remoteCombatantCount ||
    harness.slots !== remoteCombatantCount
  ) {
    throw new Error(`War did not expose one pooled remote slot per combatant: ${JSON.stringify(harness)}`);
  }
  if (
    lodAndPool.near.visible !== remoteCombatantCount ||
    lodAndPool.near.healthBars < nearHealthBarMinimum ||
    lodAndPool.far.visible !== remoteCombatantCount ||
    lodAndPool.far.healthBars >= lodAndPool.near.healthBars ||
    lodAndPool.far.farAttackOrHit !== 0 ||
    lodAndPool.culled.visible >= remoteCombatantCount ||
    lodAndPool.healthBarSafety.behindVisible ||
    lodAndPool.healthBarSafety.nearVisible ||
    !lodAndPool.healthBarSafety.fightersVisible ||
    !lodAndPool.deterministic ||
    !lodAndPool.poolStable
  ) {
    throw new Error(`War pool/LOD contract failed: ${JSON.stringify(lodAndPool)}`);
  }
  if (
    stableHealthAndCpu.stableVersionChanges !== 0 ||
    stableHealthAndCpu.changedVersionCount !== remoteCombatantCount ||
    stableHealthAndCpu.meanUpdate > 2
  ) {
    throw new Error(`War crowd CPU/health uploads regressed: ${JSON.stringify(stableHealthAndCpu)}`);
  }
  if (
    resourceAndDraw.crowd.uniqueSpriteMaterials !== remoteCombatantCount ||
    resourceAndDraw.crowd.uniqueHealthMaterials !== remoteCombatantCount ||
    resourceAndDraw.crowd.uniqueHealthTextures !== remoteCombatantCount ||
    resourceAndDraw.crowd.uniqueFighterTextures > 20 ||
    resourceAndDraw.scene.materials > 260 ||
    resourceAndDraw.scene.textures > 180 ||
    resourceAndDraw.renderer.render.calls > 500
  ) {
    throw new Error(`War render resources exceeded their bounds: ${JSON.stringify(resourceAndDraw)}`);
  }
  if (reloadLifetime.geometryGrowth > 2 || reloadLifetime.textureGrowth > 1) {
    throw new Error(`War reload leaked GPU resources: ${JSON.stringify(reloadLifetime)}`);
  }
  if (
    report.performanceGate.enforced &&
    (desktop.frames.p95 > 25 || narrow.frames.p95 > 25)
  ) {
    throw new Error(`War frame time exceeded 25ms p95: ${JSON.stringify(report.frameSamples)}`);
  }
  if (report.heap.usedGrowth > 8 * 1024 * 1024) {
    throw new Error(`War retained excessive JS heap during churn: ${JSON.stringify(report.heap)}`);
  }
  if (
    events.projectileAttacks < 1 ||
    events.meleeAttacks < 1 ||
    events.damageNumbers < 1 ||
    events.deaths < 1 ||
    events.respawns < 1 ||
    events.controlChanges < 1
  ) {
    throw new Error(`War combat churn was incomplete: ${JSON.stringify(events)}`);
  }
  if (
    arenaUnaffected.matchType !== 'practice' ||
    !arenaUnaffected.arenaIsBase ||
    !arenaUnaffected.baseVisible ||
    arenaUnaffected.warVisible ||
    arenaUnaffected.crowdVisible ||
    arenaUnaffected.crowdStates !== 0 ||
    arenaUnaffected.mapId === 'war-field' ||
    arenaUnaffected.phase !== 'playing' ||
    arenaUnaffected.colliders < 1 ||
    arenaUnaffected.raycastMeshes < 1 ||
    !arenaUnaffected.botVisible
  ) {
    throw new Error(`Arena mode was not restored after War: ${JSON.stringify(arenaUnaffected)}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  try {
    await page.evaluate(() => window.__LARP_GAME__?.network?.leave());
    await page.waitForTimeout(150);
  } catch {
    // The page may already be closed after an earlier failure.
  }
  await browser.close();
}
