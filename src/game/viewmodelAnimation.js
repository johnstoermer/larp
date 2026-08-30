import { versionLarpAssetUrl } from './assetUrl.js';

export const VIEWMODEL_FRAME_STEP_MS = 90;

export const VIEWMODEL_FRAME_COUNTS = Object.freeze({
  idle: 1,
  fire: 3,
  reload: 3,
  draw: 3,
});

const VIEWMODEL_STATES = new Set(Object.keys(VIEWMODEL_FRAME_COUNTS));

function assetUrl(asset, suffix, baseUrl) {
  return versionLarpAssetUrl(`${baseUrl}/${asset}-${suffix}.webp`);
}

function normalizeStepMs(stepMs) {
  const value = Number(stepMs);
  return Number.isFinite(value) && value > 0
    ? value
    : VIEWMODEL_FRAME_STEP_MS;
}

function normalizeFrameCount(frameCount) {
  return Math.max(1, Math.floor(Number(frameCount) || 1));
}

function normalizeProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Faster weapons divide their firing interval evenly among all frames so the
 * final pose is visible before the next successful shot. Slower weapons retain
 * the deliberately choppy circa-2010 90ms cadence.
 */
export function viewmodelFireStepMs(
  intervalSeconds,
  frameCount = VIEWMODEL_FRAME_COUNTS.fire,
) {
  const intervalMs = Number(intervalSeconds) * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return VIEWMODEL_FRAME_STEP_MS;
  return Math.min(
    VIEWMODEL_FRAME_STEP_MS,
    intervalMs / normalizeFrameCount(frameCount),
  );
}

/** Select an equal-duration discrete frame from normalized action progress. */
export function viewmodelFrameIndexForProgress(progress, frameCount = 1) {
  const count = normalizeFrameCount(frameCount);
  return Math.min(count - 1, Math.floor(normalizeProgress(progress) * count));
}

/**
 * Return the transparent rows beneath the last meaningfully occupied alpha
 * row. Ignoring isolated antialias specks keeps a sleeve/forearm edge anchored
 * instead of letting one stray pixel determine the composition.
 */
export function substantialAlphaBottomMargin(
  pixels,
  width,
  height,
  { alphaThreshold = 16, rowCoverage = 0.008 } = {},
) {
  const resolvedWidth = Math.max(0, Math.floor(Number(width) || 0));
  const resolvedHeight = Math.max(0, Math.floor(Number(height) || 0));
  if (!pixels || resolvedWidth === 0 || resolvedHeight === 0) return 0;
  const requiredPixels = Math.max(4, Math.ceil(resolvedWidth * rowCoverage));

  for (let y = resolvedHeight - 1; y >= 0; y -= 1) {
    let visible = 0;
    const rowStart = y * resolvedWidth * 4;
    for (let x = 0; x < resolvedWidth; x += 1) {
      if (pixels[rowStart + x * 4 + 3] >= alphaThreshold) {
        visible += 1;
        if (visible >= requiredPixels) return resolvedHeight - 1 - y;
      }
    }
  }
  return resolvedHeight;
}

/** Six deliberately stepped screen-space poses for the greatsword's melee arc. */
export function greatswordSweepForFrame(frameIndex, frameCount = 6) {
  const count = Math.max(2, normalizeFrameCount(frameCount));
  const index = Math.min(count - 1, Math.max(0, Math.floor(Number(frameIndex) || 0)));
  const progress = index / (count - 1);
  return Object.freeze({
    progress,
    x: -96 + progress * 191,
    y: -Math.sin(progress * Math.PI) * 54,
    rotate: -13 + progress * 30,
    scale: 1.015 + Math.sin(progress * Math.PI) * 0.035,
  });
}

/**
 * Keep active bow poses on the right-hand side of the aim point. The idle
 * photographs retain their authored composition; only draw/release states
 * receive this viewport-relative runtime translation.
 */
export function bowRightSideOffset(state, viewportWidth) {
  if (state !== 'draw' && state !== 'fire') return 0;
  const width = Number(viewportWidth);
  if (!Number.isFinite(width) || width <= 0) return 0;
  return width * 0.115;
}

export function normalizeViewmodelState(state, isBow = false) {
  if (!VIEWMODEL_STATES.has(state)) return 'idle';
  if (state === 'draw' && !isBow) return 'idle';
  return state;
}

export function createViewmodelFrameSet(
  definition,
  {
    isBow = false,
    baseUrl = '/assets/larp/viewmodels',
    stepMs = VIEWMODEL_FRAME_STEP_MS,
  } = {},
) {
  const candidateStates = isBow
    ? ['idle', 'fire', 'reload', 'draw']
    : ['idle', 'fire', 'reload'];
  const frameCounts = {
    ...VIEWMODEL_FRAME_COUNTS,
    ...(definition.viewmodelFrames ?? {}),
  };
  const states = candidateStates.filter((state) => frameCounts[state] > 0);
  const frameSet = {};
  const frameDuration = normalizeStepMs(stepMs);

  for (const state of states) {
    const count = frameCounts[state];
    frameSet[state] = Array.from({ length: count }, (_, index) => {
      const frameNumber = index + 1;
      const url = state === 'idle'
        ? assetUrl(definition.asset, state, baseUrl)
        : assetUrl(definition.asset, `${state}-${frameNumber}`, baseUrl);
      return Object.freeze({
        key: `${definition.id}:${state}:${frameNumber}`,
        state,
        frameNumber,
        duration: state === 'idle' ? Infinity : frameDuration,
        url,
      });
    });
    Object.freeze(frameSet[state]);
  }

  return Object.freeze(frameSet);
}

export class SteppedViewmodelAnimation {
  constructor({
    stepMs = VIEWMODEL_FRAME_STEP_MS,
    frameCounts = VIEWMODEL_FRAME_COUNTS,
  } = {}) {
    this.stepMs = normalizeStepMs(stepMs);
    this.frameCounts = frameCounts;
    this.state = 'idle';
    this.frameIndex = 0;
    this.elapsedMs = 0;
    this.finished = true;
  }

  frameCount(state = this.state) {
    return normalizeFrameCount(this.frameCounts[state]);
  }

  play(state, { restart = false, stepMs } = {}) {
    const resolvedState = VIEWMODEL_STATES.has(state) ? state : 'idle';
    if (resolvedState === this.state && !restart) return false;
    if (stepMs !== undefined) this.stepMs = normalizeStepMs(stepMs);
    this.state = resolvedState;
    this.frameIndex = 0;
    this.elapsedMs = 0;
    this.finished = this.frameCount() === 1;
    return true;
  }

  restartFire(intervalSeconds) {
    return this.play('fire', {
      restart: true,
      stepMs: viewmodelFireStepMs(intervalSeconds, this.frameCount('fire')),
    });
  }

  setProgress(state, progress) {
    const resolvedState = VIEWMODEL_STATES.has(state) ? state : 'idle';
    const normalized = normalizeProgress(progress);
    this.state = resolvedState;
    this.frameIndex = viewmodelFrameIndexForProgress(
      normalized,
      this.frameCount(resolvedState),
    );
    this.elapsedMs = 0;
    this.finished = this.frameCount() === 1 || normalized >= 1;
    return this.frameIndex;
  }

  update(deltaSeconds) {
    if (this.finished || this.frameCount() === 1) return this.frameIndex;
    const deltaMs = Number.isFinite(deltaSeconds)
      ? Math.max(0, deltaSeconds * 1000)
      : 0;
    this.elapsedMs += deltaMs;

    while (this.elapsedMs >= this.stepMs && !this.finished) {
      this.elapsedMs -= this.stepMs;
      if (this.frameIndex < this.frameCount() - 1) {
        this.frameIndex += 1;
      } else {
        this.finished = true;
        this.elapsedMs = 0;
      }
    }
    return this.frameIndex;
  }
}
