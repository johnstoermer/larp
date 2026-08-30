import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../src/game/weapons.js';
import {
  bowRightSideOffset,
  createViewmodelFrameSet,
  greatswordSweepForFrame,
  normalizeViewmodelState,
  SteppedViewmodelAnimation,
  substantialAlphaBottomMargin,
  viewmodelFireStepMs,
  viewmodelFrameIndexForProgress,
  VIEWMODEL_FRAME_STEP_MS,
} from '../src/game/viewmodelAnimation.js';
import { LARP_ASSET_REVISION } from '../src/game/assetUrl.js';

const BOWS = new Set(['shortbow', 'longbow']);

test('viewmodel frame sets map every action to a canonical numbered file', () => {
  const frames = createViewmodelFrameSet(WEAPONS.greatsword);

  assert.equal(frames.idle.length, 1);
  assert.equal(frames.fire.length, 6);
  assert.equal(frames.reload, undefined);
  assert.equal(frames.draw, undefined);
  assert.equal(
    frames.idle[0].url,
    `/assets/larp/viewmodels/greatsword-idle.webp?v=${LARP_ASSET_REVISION}`,
  );
  assert.deepEqual(
    frames.fire.map((frame) => frame.url),
    [1, 2, 3, 4, 5, 6].map(
      (number) => `/assets/larp/viewmodels/greatsword-fire-${number}.webp?v=${LARP_ASSET_REVISION}`,
    ),
  );
  assert.ok(frames.fire.every((frame) => frame.duration === VIEWMODEL_FRAME_STEP_MS));
});

test('bows receive draw frames, omit reload frames, and the runtime manifest has 53 frames', () => {
  let total = 0;
  for (const definition of Object.values(WEAPONS)) {
    const frames = createViewmodelFrameSet(definition, {
      isBow: BOWS.has(definition.id),
    });
    total += Object.values(frames).reduce((sum, state) => sum + state.length, 0);
    if (BOWS.has(definition.id)) {
      assert.deepEqual(
        frames.draw.map((frame) => frame.frameNumber),
        [1, 2, 3],
      );
      assert.equal(frames.reload, undefined);
    }
  }
  assert.equal(total, 53);
});

test('greatsword uses six broad-swing poses and has no reload action', () => {
  const frames = createViewmodelFrameSet(WEAPONS.greatsword);
  assert.deepEqual(frames.fire.map((frame) => frame.frameNumber), [1, 2, 3, 4, 5, 6]);
  assert.equal(frames.reload, undefined);
  assert.equal(WEAPONS.greatsword.usesAmmo, false);
});

test('greatsword poses sweep monotonically from screen-left to screen-right', () => {
  const poses = [0, 1, 2, 3, 4, 5].map((frame) =>
    greatswordSweepForFrame(frame, 6));
  assert.ok(poses[0].x < 0);
  assert.ok(poses.at(-1).x > 0);
  assert.ok(poses.every((pose, index) => index === 0 || pose.x > poses[index - 1].x));
  assert.ok(poses[2].y < poses[0].y);
  assert.ok(poses[3].scale > poses[0].scale);
});

test('only active bow poses receive the responsive right-side offset', () => {
  assert.equal(bowRightSideOffset('idle', 1440), 0);
  assert.equal(bowRightSideOffset('reload', 1440), 0);
  assert.equal(bowRightSideOffset('draw', 1440), 165.6);
  assert.equal(bowRightSideOffset('fire', 720), 82.8);
  assert.equal(bowRightSideOffset('draw', Number.NaN), 0);
  assert.equal(bowRightSideOffset('fire', -720), 0);
});

test('bows automatically nock without ammunition or reload actions', () => {
  for (const weapon of BOWS) {
    const definition = WEAPONS[weapon];
    const frames = createViewmodelFrameSet(definition, { isBow: true });
    assert.equal(definition.usesAmmo, false);
    assert.equal(definition.reloadMs, 0);
    assert.equal(definition.reserve, 0);
    assert.equal(frames.reload, undefined);
  }
});

test('held throwing knives cycle fire poses once per second without a reload action', () => {
  const definition = WEAPONS.knives;
  const frames = createViewmodelFrameSet(definition);
  assert.equal(definition.usesAmmo, false);
  assert.equal(definition.automatic, true);
  assert.equal(definition.reloadMs, 0);
  assert.equal(definition.reserve, 0);
  assert.equal(frames.reload, undefined);
  assert.equal(viewmodelFireStepMs(definition.interval), VIEWMODEL_FRAME_STEP_MS);
});

test('draw and unknown states fall back to idle when unavailable', () => {
  assert.equal(normalizeViewmodelState('draw', false), 'idle');
  assert.equal(normalizeViewmodelState('draw', true), 'draw');
  assert.equal(normalizeViewmodelState('missing', true), 'idle');
});

test('stepped playback advances at roughly 11 fps without interpolation', () => {
  const animation = new SteppedViewmodelAnimation();
  animation.play('fire');

  assert.equal(animation.frameIndex, 0);
  animation.update(0.089);
  assert.equal(animation.frameIndex, 0);
  animation.update(0.001);
  assert.equal(animation.frameIndex, 1);
  animation.update(0.09);
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, false);
  animation.update(0.09);
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, true);
});

test('playback holds its frame unless state changes or restart is explicit', () => {
  const animation = new SteppedViewmodelAnimation();
  animation.play('reload');
  animation.update(0.1);
  assert.equal(animation.frameIndex, 1);

  assert.equal(animation.play('reload'), false);
  assert.equal(animation.frameIndex, 1);
  assert.equal(animation.play('reload', { restart: true }), true);
  assert.equal(animation.frameIndex, 0);

  animation.update(1);
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, true);
  animation.update(1);
  assert.equal(animation.frameIndex, 2);

  animation.play('idle');
  assert.equal(animation.state, 'idle');
  assert.equal(animation.frameIndex, 0);
});

test('automatic fire shows every frame before cadence restart', () => {
  const animation = new SteppedViewmodelAnimation();
  const interval = WEAPONS.lightning.interval;
  const stepMs = viewmodelFireStepMs(interval);

  assert.equal(stepMs, (interval * 1000) / 3);
  assert.equal(viewmodelFireStepMs(WEAPONS.shortbow.interval), VIEWMODEL_FRAME_STEP_MS);

  animation.restartFire(interval);
  assert.equal(animation.frameIndex, 0);
  animation.update(stepMs / 1000);
  assert.equal(animation.frameIndex, 1);
  animation.update(stepMs / 1000);
  assert.equal(animation.frameIndex, 2);
  animation.update((stepMs - 1) / 1000);
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, false);

  // A new successful shot starts again at its first pose, even while the
  // previous fire animation still has time remaining.
  animation.restartFire(interval);
  assert.equal(animation.frameIndex, 0);
  assert.equal(animation.elapsedMs, 0);
  assert.equal(animation.finished, false);
});

test('reload and bow draw progress map evenly across all three frames', () => {
  assert.deepEqual(
    [0, 0.32, 1 / 3, 0.65, 2 / 3, 0.99, 1].map((progress) =>
      viewmodelFrameIndexForProgress(progress, 3)),
    [0, 0, 1, 1, 2, 2, 2],
  );

  const animation = new SteppedViewmodelAnimation();
  animation.setProgress('reload', 0);
  assert.equal(animation.frameIndex, 0);
  animation.setProgress('reload', 0.5);
  assert.equal(animation.frameIndex, 1);
  animation.setProgress('reload', 1);
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, true);

  animation.setProgress('draw', 0.84);
  assert.equal(animation.state, 'draw');
  assert.equal(animation.frameIndex, 2);
  assert.equal(animation.finished, false);
});

test('invalid timing input falls back to the standard frame step', () => {
  const animation = new SteppedViewmodelAnimation({ stepMs: 0 });
  assert.equal(animation.stepMs, VIEWMODEL_FRAME_STEP_MS);
  animation.play('fire');
  animation.update(Number.NaN);
  assert.equal(animation.frameIndex, 0);
});

test('viewmodel bottom anchoring ignores stray alpha and finds the occupied edge', () => {
  const width = 10;
  const height = 8;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels[((height - 1) * width + 1) * 4 + 3] = 255;
  for (let x = 0; x < 4; x += 1) {
    pixels[((height - 3) * width + x) * 4 + 3] = 255;
  }
  assert.equal(substantialAlphaBottomMargin(pixels, width, height), 2);
});
