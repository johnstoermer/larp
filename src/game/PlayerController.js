import * as THREE from 'three';
import { clamp, damp, moveToward } from './math.js';
import {
  bowRightSideOffset,
  createViewmodelFrameSet,
  greatswordSweepForFrame,
  normalizeViewmodelState,
  SteppedViewmodelAnimation,
  substantialAlphaBottomMargin,
} from './viewmodelAnimation.js';
import {
  isEditableEventTarget,
  recordGameplayKeyDown,
  recordGameplayKeyUp,
} from './keyboardInput.js';
import { WEAPONS } from './weapons.js';

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const WISH = new THREE.Vector3();
const SLIDE_DIRECTION = new THREE.Vector3();
const WALL_TANGENT = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const BOW_WEAPONS = new Set(['shortbow', 'longbow']);
const BOW_MIN_DRAW = 0.12;
const BOW_FULL_DRAW = 0.72;

const VIEWMODEL_MOTION = Object.freeze({
  knives: { fireX: 120, fireY: -28, fireRotate: -9, reloadRotate: 13 },
  shortbow: { fireX: -18, fireY: 22, fireRotate: 2, reloadRotate: 0 },
  ember: { fireX: 10, fireY: -38, fireRotate: -3, reloadRotate: 16 },
  crossbow: { fireX: -26, fireY: 31, fireRotate: 1.5, reloadRotate: 8 },
  lightning: { fireX: 18, fireY: -31, fireRotate: 5, reloadRotate: -16 },
  longbow: { fireX: -12, fireY: 28, fireRotate: -1.5, reloadRotate: 0 },
  greatsword: { fireX: 155, fireY: -70, fireRotate: -28, reloadRotate: 18 },
  fireball: { fireX: -22, fireY: -48, fireRotate: 4, reloadRotate: 14 },
});

export class PlayerController {
  constructor(camera, arena, audio) {
    this.camera = camera;
    this.arena = arena;
    this.audio = audio;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.wallRunTime = 0;
    this.wallNormal = new THREE.Vector3();
    this.wallSide = 0;
    this.cameraHeight = 1.64;
    this.cameraRoll = 0;
    this.stepCycle = 0;
    this.lastStepCycle = 0;
    this.bob = 0;
    this.landKick = 0;
    this.recoil = 0;
    this.recoilSide = 0;
    this.weaponKick = 0;
    this.inspect = 0;
    this.sway = new THREE.Vector2();
    this.mouseDelta = new THREE.Vector2();
    this.shake = 0;
    this.shakeTime = 0;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.buttonPressed = new Set();
    this.buttonReleased = new Set();
    this.sensitivity = Number(localStorage.getItem('larp-sensitivity') || 0.85);
    this.weaponType = 'knives';
    this.ammo = WEAPONS.knives.ammo;
    this.reserve = WEAPONS.knives.reserve;
    this.lastShotAt = -Infinity;
    this.shotFrameTime = 0;
    this.bowDrawTime = 0;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.reloadDuration = 0;
    this.reloadServerControlled = false;
    this.focused = false;
    this.inputEnabled = false;
    this.movementScale = 1;

    this.viewmodelLayer = document.getElementById('viewmodel-layer');
    this.viewmodelSprite = document.getElementById('viewmodel-sprite');
    this.viewmodelFrameKey = '';
    this.viewmodelFrames = new Map();
    this.viewmodelFrameSets = new Map();
    this.viewmodelResolvedUrls = new Map();
    this.viewmodelBottomMargins = new Map();
    this.viewmodelAnchorMotion = {
      actionY: 0,
      actionScale: 1,
      viewmodelY: 0,
      rotation: 0,
    };
    this.viewmodelAnimation = new SteppedViewmodelAnimation();
    this.viewRoot = new THREE.Group();
    this.viewRoot.name = 'first-person-view-model';
    let viewVisible = true;
    Object.defineProperty(this.viewRoot, 'visible', {
      configurable: true,
      enumerable: true,
      get: () => viewVisible,
      set: (value) => {
        viewVisible = Boolean(value);
        this.viewmodelLayer?.classList.toggle('active', viewVisible && !this.dead);
      },
    });
    this.camera.add(this.viewRoot);
    this.preloadViewmodelFrames();
    this.setWeaponModel('knives', false);
    this.bindInput();
  }

  bindInput() {
    window.addEventListener('keydown', (event) => {
      recordGameplayKeyDown(event, this.keys, this.pressed);
    });
    window.addEventListener('keyup', (event) => {
      recordGameplayKeyUp(event, this.keys);
    });
    window.addEventListener('focusin', (event) => {
      if (!isEditableEventTarget(event.target)) return;
      this.keys.clear();
      this.pressed.clear();
    });
    window.addEventListener('mousedown', (event) => {
      if (!this.buttons.has(event.button)) this.buttonPressed.add(event.button);
      this.buttons.add(event.button);
    });
    window.addEventListener('mouseup', (event) => {
      if (this.buttons.has(event.button)) this.buttonReleased.add(event.button);
      this.buttons.delete(event.button);
    });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement && this.inputEnabled) {
        const scalar = 0.00165 * this.sensitivity;
        this.yaw -= event.movementX * scalar;
        this.pitch -= event.movementY * scalar;
        this.pitch = clamp(this.pitch, -1.49, 1.49);
        this.mouseDelta.x += event.movementX;
        this.mouseDelta.y += event.movementY;
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
      this.pressed.clear();
      this.buttonPressed.clear();
      this.buttonReleased.clear();
      this.bowDrawTime = 0;
    });
  }

  preloadViewmodelFrames() {
    for (const definition of Object.values(WEAPONS)) {
      const frameSet = createViewmodelFrameSet(definition, {
        isBow: BOW_WEAPONS.has(definition.id),
      });
      this.viewmodelFrameSets.set(definition.id, frameSet);
      if (typeof Image === 'undefined') continue;
      for (const frames of Object.values(frameSet)) {
        for (const frame of frames) this.preloadViewmodelFrame(frame);
      }
    }
  }

  preloadViewmodelFrame(frame) {
    const image = new Image();
    image.decoding = 'async';

    const showLoadedCandidate = () => {
      this.viewmodelResolvedUrls.set(frame.key, frame.url);
      this.measureViewmodelBottomMargin(frame, image);
      if (this.viewmodelFrameKey === frame.key && this.viewmodelSprite) {
        this.viewmodelSprite.style.backgroundImage = `url('${frame.url}')`;
        this.updateViewmodelBottomAnchor();
      }
    };
    image.onload = showLoadedCandidate;

    this.viewmodelFrames.set(frame.key, image);
    this.viewmodelResolvedUrls.set(frame.key, frame.url);
    image.src = frame.url;
  }

  measureViewmodelBottomMargin(frame, image) {
    if (typeof document === 'undefined' || !image.naturalWidth || !image.naturalHeight) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(256, image.naturalWidth);
      canvas.height = Math.max(
        1,
        Math.round(canvas.width * image.naturalHeight / image.naturalWidth),
      );
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const margin = substantialAlphaBottomMargin(pixels, canvas.width, canvas.height);
      this.viewmodelBottomMargins.set(frame.key, {
        ratio: margin / canvas.height,
        aspect: image.naturalWidth / image.naturalHeight,
      });
    } catch {
      // Same-origin production assets are readable. Keep the conservative CSS
      // overscan if a development proxy makes canvas pixels unavailable.
    }
  }

  updateViewmodelBottomAnchor(
    actionY = this.viewmodelAnchorMotion.actionY,
    actionScale = this.viewmodelAnchorMotion.actionScale,
    viewmodelY = this.viewmodelAnchorMotion.viewmodelY,
    rotation = this.viewmodelAnchorMotion.rotation,
  ) {
    if (!this.viewmodelSprite) return;
    const measurement = this.viewmodelBottomMargins.get(this.viewmodelFrameKey);
    const layoutWidth = this.viewmodelSprite.offsetWidth;
    const layoutHeight = this.viewmodelSprite.offsetHeight;
    const aspect = measurement?.aspect || 1;
    const renderedHeight = Math.min(layoutHeight, layoutWidth / aspect);
    const focusScale = this.focused ? 0.86 : 1;
    const transparentPadding = (measurement?.ratio || 0) * renderedHeight
      * focusScale * actionScale;
    const upwardMotion = Math.max(0, -(viewmodelY + actionY));
    const rotationSafety = Math.sin(Math.min(Math.PI / 2, Math.abs(rotation) * Math.PI / 180))
      * renderedHeight * 0.08;
    // Keep a tiny overlap below the viewport seam. The measured transparent
    // padding and live action offset already place the occupied sleeve edge at
    // the bottom; a large generic overscan made compact poses disappear below
    // short/narrow screens.
    const seamOverlap = 2;
    const shift = Math.ceil(transparentPadding + upwardMotion + rotationSafety + seamOverlap);
    this.viewmodelSprite.style.setProperty('--vm-frame-bottom-shift', `${shift}px`);
  }

  getViewmodelFrameSet(definition) {
    if (!this.viewmodelFrameSets.has(definition.id)) {
      this.viewmodelFrameSets.set(
        definition.id,
        createViewmodelFrameSet(definition, {
          isBow: BOW_WEAPONS.has(definition.id),
        }),
      );
    }
    return this.viewmodelFrameSets.get(definition.id);
  }

  setViewmodelFrame(state = 'idle', frameIndex = 0) {
    if (!this.viewmodelSprite) return;
    const definition = this.definition ?? WEAPONS.knives;
    const resolvedState = normalizeViewmodelState(
      state,
      BOW_WEAPONS.has(definition.id),
    );
    const frameSet = this.getViewmodelFrameSet(definition);
    const frames = frameSet[resolvedState] ?? frameSet.idle;
    const resolvedIndex = Math.min(
      frames.length - 1,
      Math.max(0, Math.floor(Number(frameIndex) || 0)),
    );
    const frame = frames[resolvedIndex];
    if (frame.key === this.viewmodelFrameKey) return;
    this.viewmodelFrameKey = frame.key;
    this.viewmodelSprite.dataset.state = resolvedState;
    this.viewmodelSprite.dataset.frame = String(frame.frameNumber);
    const url = this.viewmodelResolvedUrls.get(frame.key) ?? frame.url;
    this.viewmodelSprite.style.backgroundImage = `url('${url}')`;
    this.updateViewmodelBottomAnchor();
  }

  resetViewmodelAnimation() {
    this.viewmodelAnimation.play('idle', { restart: true });
    this.setViewmodelFrame('idle', 0);
  }

  playViewmodelFireAnimation() {
    this.viewmodelAnimation.restartFire(this.definition.interval);
    this.setViewmodelFrame('fire', 0);
  }

  setViewmodelAnimationProgress(state, progress) {
    const definition = this.definition ?? WEAPONS.knives;
    const resolvedState = normalizeViewmodelState(
      state,
      BOW_WEAPONS.has(definition.id),
    );
    const frameIndex = this.viewmodelAnimation.setProgress(resolvedState, progress);
    this.setViewmodelFrame(resolvedState, frameIndex);
    return this.viewmodelAnimation.state;
  }

  updateViewmodelAnimation(delta) {
    if (this.reloading) {
      const progress = 1 - this.reloadRemaining / Math.max(0.001, this.reloadDuration);
      return this.setViewmodelAnimationProgress('reload', progress);
    }

    if (
      this.shotFrameTime > 0
      || (this.viewmodelAnimation.state === 'fire' && !this.viewmodelAnimation.finished)
    ) {
      if (this.viewmodelAnimation.state !== 'fire') {
        this.viewmodelAnimation.restartFire(this.definition.interval);
      }
      this.viewmodelAnimation.update(delta);
      this.setViewmodelFrame('fire', this.viewmodelAnimation.frameIndex);
      return this.viewmodelAnimation.state;
    }

    if (BOW_WEAPONS.has(this.weaponType) && this.bowDrawTime > 0) {
      return this.setViewmodelAnimationProgress(
        'draw',
        this.bowDrawTime / BOW_FULL_DRAW,
      );
    }

    this.viewmodelAnimation.play('idle');
    this.setViewmodelFrame('idle', 0);
    return this.viewmodelAnimation.state;
  }

  setWeaponModel(type, animate = true) {
    const definition = WEAPONS[type] ?? WEAPONS.knives;
    const frameSet = this.getViewmodelFrameSet(definition);
    this.viewmodelAnimation.frameCounts = Object.fromEntries(
      Object.entries(frameSet).map(([state, frames]) => [state, frames.length]),
    );
    this.viewmodelAnchorMotion = {
      actionY: 0,
      actionScale: 1,
      viewmodelY: 0,
      rotation: definition.id === 'greatsword' ? -7 : 0,
    };
    if (this.viewmodelSprite) {
      this.viewmodelSprite.dataset.weapon = definition.id;
      this.viewmodelFrameKey = '';
      this.resetViewmodelAnimation();
    }
    if (animate) this.inspect = 1;
  }

  setSensitivity(value) {
    this.sensitivity = Number(value);
    localStorage.setItem('larp-sensitivity', String(this.sensitivity));
  }

  setMovementScale(value = 1) {
    this.movementScale = clamp(Number(value) || 1, 0.6, 1.5);
  }

  reset(position, yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = 100;
    this.dead = false;
    this.grounded = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.wallRunTime = 0;
    this.cameraHeight = 1.64;
    this.cameraRoll = 0;
    this.stepCycle = 0;
    this.landKick = 0;
    this.recoil = 0;
    this.recoilSide = 0;
    this.weaponKick = 0;
    this.shake = 0;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.shotFrameTime = 0;
    this.bowDrawTime = 0;
    this.equip('knives', false);
    this.syncCamera(0.016);
  }

  equip(type, announce = true) {
    this.weaponType = type in WEAPONS ? type : 'knives';
    this.ammo = WEAPONS[this.weaponType].ammo;
    this.reserve = WEAPONS[this.weaponType].reserve;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.bowDrawTime = 0;
    this.lastShotAt = -Infinity;
    this.setWeaponModel(this.weaponType, announce);
    if (announce) this.audio.pickup();
  }

  discard() {
    if (this.weaponType === 'knives') return false;
    this.equip('knives', true);
    return true;
  }

  get definition() {
    return WEAPONS[this.weaponType];
  }

  wantsToFire() {
    if (!this.inputEnabled || this.dead) return false;
    if (BOW_WEAPONS.has(this.weaponType)) {
      return this.buttonReleased.has(0) && this.bowDrawTime >= BOW_MIN_DRAW;
    }
    return this.definition.automatic ? this.buttons.has(0) : this.buttonPressed.has(0);
  }

  canFire(time) {
    return (
      !this.dead &&
      !this.reloading &&
      (this.definition.usesAmmo === false || this.ammo > 0) &&
      time - this.lastShotAt >= this.definition.interval
    );
  }

  registerShot(time) {
    this.lastShotAt = time;
    const definition = this.definition;
    if (definition.usesAmmo !== false) {
      this.ammo = Math.max(0, this.ammo - 1);
    }
    const groundedScale = this.grounded ? 1 : 1.12;
    this.recoil += definition.recoil * groundedScale;
    this.recoilSide += (Math.random() - 0.5) * definition.recoil * 0.44;
    this.weaponKick = Math.min(2.5, this.weaponKick + definition.recoil);
    this.shotFrameTime = 0.12;
    this.bowDrawTime = 0;
    this.playViewmodelFireAnimation();
    this.pitch = clamp(this.pitch + definition.recoil * 0.0062, -1.49, 1.49);
    this.shake = Math.max(this.shake, definition.recoil * 0.075);
    this.shakeTime = 0.11;
  }

  dryFire(time) {
    if (time - this.lastShotAt < 0.26) return false;
    this.lastShotAt = time;
    this.bowDrawTime = 0;
    this.weaponKick += 0.08;
    this.audio.empty();
    return true;
  }

  startReload(serverControlled = false) {
    const definition = this.definition;
    if (
      this.dead ||
      this.reloading ||
      definition.usesAmmo === false ||
      this.ammo >= definition.ammo ||
      this.reserve <= 0
    ) {
      return false;
    }
    this.reloading = true;
    this.bowDrawTime = 0;
    this.reloadDuration = definition.reloadMs / 1000;
    this.reloadRemaining = this.reloadDuration;
    this.reloadServerControlled = serverControlled;
    this.focused = false;
    this.setViewmodelAnimationProgress('reload', 0);
    this.audio.tone({
      frequency: 180,
      endFrequency: 115,
      duration: 0.11,
      volume: 0.035,
      type: 'square',
    });
    return true;
  }

  finishReload(ammo = null, reserve = null) {
    if (ammo == null || reserve == null) {
      const needed = Math.max(0, this.definition.ammo - this.ammo);
      const loaded = Math.min(needed, this.reserve);
      this.ammo += loaded;
      this.reserve -= loaded;
    } else {
      this.ammo = Math.max(0, Number(ammo) || 0);
      this.reserve = Math.max(0, Number(reserve) || 0);
    }
    this.reloading = false;
    this.reloadRemaining = 0;
    this.reloadServerControlled = false;
    this.bowDrawTime = 0;
    this.resetViewmodelAnimation();
    this.audio.tone({
      frequency: 260,
      endFrequency: 420,
      duration: 0.08,
      volume: 0.03,
      type: 'square',
    });
  }

  cancelReload() {
    this.reloading = false;
    this.reloadRemaining = 0;
    this.reloadServerControlled = false;
    this.bowDrawTime = 0;
    this.resetViewmodelAnimation();
  }

  getAim(originTarget = new THREE.Vector3(), directionTarget = new THREE.Vector3()) {
    this.camera.getWorldPosition(originTarget);
    this.camera.getWorldDirection(directionTarget);
    return { origin: originTarget, direction: directionTarget };
  }

  getMuzzlePosition(target = new THREE.Vector3()) {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return this.camera
      .getWorldPosition(target)
      .addScaledVector(direction, 0.62)
      .addScaledVector(right, 0.18)
      .add(new THREE.Vector3(0, -0.16, 0));
  }

  getCasingPosition(target = new THREE.Vector3()) {
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return this.camera
      .getWorldPosition(target)
      .addScaledVector(direction, 0.35)
      .addScaledVector(right, 0.27)
      .add(new THREE.Vector3(0, -0.11, 0));
  }

  getRightDirection(target = new THREE.Vector3()) {
    target.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return target;
  }

  addShake(amount, duration = 0.2) {
    this.shake = Math.max(this.shake, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  damage(amount) {
    if (this.dead) return 0;
    const applied = Math.min(this.health, Math.max(0, amount));
    this.health -= applied;
    this.shake = Math.max(this.shake, 0.18 + applied * 0.008);
    this.shakeTime = Math.max(this.shakeTime, 0.26);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.velocity.multiplyScalar(0.3);
    }
    return applied;
  }

  update(delta, canMove = true) {
    const dt = Math.min(delta, 0.034);
    this.inputEnabled = canMove;
    this.wasGrounded = this.grounded;
    const wasAirTime = this.airTime;
    const moveX =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const moveZ =
      (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const wantsSprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const wantsSlide =
      this.pressed.has('ControlLeft') ||
      this.pressed.has('ControlRight') ||
      this.pressed.has('KeyC');
    const wantsJump = this.pressed.has('Space');
    const jumpHeld = this.keys.has('Space');
    this.focused = this.buttons.has(2) && canMove;
    if (!BOW_WEAPONS.has(this.weaponType) || !canMove || this.dead || this.reloading) {
      this.bowDrawTime = 0;
    } else if (this.buttons.has(0)) {
      this.bowDrawTime = Math.min(BOW_FULL_DRAW, this.bowDrawTime + dt);
    } else if (!this.buttonReleased.has(0)) {
      this.bowDrawTime = 0;
    }

    FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    RIGHT.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    WISH.set(0, 0, 0)
      .addScaledVector(FORWARD, moveZ)
      .addScaledVector(RIGHT, moveX);
    if (WISH.lengthSq() > 1) WISH.normalize();

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (
      canMove &&
      wantsSlide &&
      this.grounded &&
      horizontalSpeed > 5.4 &&
      this.slideCooldown <= 0
    ) {
      this.slideTime = 0.72;
      this.slideCooldown = 0.95;
      const slideDirection =
        horizontalSpeed > 0.1
          ? SLIDE_DIRECTION.set(this.velocity.x, 0, this.velocity.z).normalize()
          : FORWARD;
      this.velocity.x = slideDirection.x * Math.max(9.4, horizontalSpeed * 1.07);
      this.velocity.z = slideDirection.z * Math.max(9.4, horizontalSpeed * 1.07);
      this.audio.movement('slide');
    }

    if (this.slideTime > 0) {
      this.slideTime = Math.max(0, this.slideTime - dt);
    }
    const sliding = this.slideTime > 0;
    const bodyHeight = sliding ? 1.15 : 1.8;

    const wall = !this.grounded
      ? this.arena.getWallContact(this.position, 0.44, bodyHeight)
      : null;
    const canWallRun =
      canMove &&
      wall &&
      jumpHeld &&
      horizontalSpeed > 5.2 &&
      this.airTime > 0.08 &&
      this.wallRunTime < 1.15;

    if (canWallRun) {
      this.wallNormal.copy(wall.normal);
      const tangent = WALL_TANGENT.set(-wall.normal.z, 0, wall.normal.x);
      if (tangent.dot(FORWARD) < 0) tangent.negate();
      const alongSpeed = Math.max(6.4, this.velocity.dot(tangent));
      this.velocity.x = damp(this.velocity.x, tangent.x * alongSpeed, 9, dt);
      this.velocity.z = damp(this.velocity.z, tangent.z * alongSpeed, 9, dt);
      this.velocity.y = Math.max(this.velocity.y - 5.5 * dt, -1.7);
      this.wallRunTime += dt;
      this.wallSide = Math.sign(RIGHT.dot(wall.normal));
      if (Math.floor(this.wallRunTime * 9) !== Math.floor((this.wallRunTime - dt) * 9)) {
        this.audio.movement('wall');
      }
    } else {
      if (this.grounded) this.wallRunTime = 0;
      this.wallSide = 0;
      this.velocity.y -= 22.5 * dt;
    }

    if (canMove && wantsJump) {
      if (this.grounded) {
        this.velocity.y = sliding ? 7.1 : 7.55;
        this.grounded = false;
        this.slideTime = 0;
        this.audio.movement('jump');
      } else if (wall && this.wallRunTime > 0.03) {
        this.velocity
          .addScaledVector(wall.normal, 7.2)
          .addScaledVector(FORWARD, 2.2);
        this.velocity.y = 7.15;
        this.wallRunTime = 1.15;
        this.cameraRoll += this.wallSide * 0.08;
        this.audio.movement('jump');
      }
    }

    if (canMove && !sliding) {
      const targetSpeed = (
        wantsSprint && moveZ > 0 && !this.focused
          ? 8.4
          : this.focused
            ? 4.5
            : 6.4
      ) * this.movementScale;
      const targetX = WISH.x * targetSpeed;
      const targetZ = WISH.z * targetSpeed;
      const acceleration = this.grounded ? (WISH.lengthSq() ? 36 : 25) : 8.5;
      this.velocity.x = moveToward(this.velocity.x, targetX, acceleration * dt);
      this.velocity.z = moveToward(this.velocity.z, targetZ, acceleration * dt);
    } else if (!canMove) {
      this.velocity.x = moveToward(this.velocity.x, 0, 18 * dt);
      this.velocity.z = moveToward(this.velocity.z, 0, 18 * dt);
    } else if (sliding) {
      this.velocity.x += WISH.x * 2.4 * dt;
      this.velocity.z += WISH.z * 2.4 * dt;
      const slideFriction = this.grounded ? 2.2 : 0.4;
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      const next = Math.max(0, speed - slideFriction * dt);
      if (speed > 0.001) {
        this.velocity.x *= next / speed;
        this.velocity.z *= next / speed;
      }
    }

    const movement = this.arena.moveBody(this, dt, {
      radius: 0.42,
      height: bodyHeight,
      stepHeight: 0.47,
    });
    if (movement.hitWall && sliding) {
      this.slideTime = Math.min(this.slideTime, 0.15);
      this.addShake(0.08, 0.1);
    }

    if (this.grounded) {
      this.airTime = 0;
      if (!this.wasGrounded && wasAirTime > 0.18) {
        const strength = clamp(wasAirTime / 0.9, 0.4, 1.3);
        this.landKick = Math.min(0.24, 0.055 * strength);
        this.audio.movement('land', strength);
        this.addShake(0.025 * strength, 0.08);
      }
    } else {
      this.airTime += dt;
    }

    const newHorizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && newHorizontalSpeed > 1 && !sliding) {
      const stride = wantsSprint ? 1.42 : 1;
      this.stepCycle += dt * newHorizontalSpeed * 0.32 * stride;
      if (Math.floor(this.stepCycle * 2) > Math.floor(this.lastStepCycle * 2)) {
        this.audio.movement('step', clamp(newHorizontalSpeed / 7, 0.45, 1));
      }
      this.lastStepCycle = this.stepCycle;
    }

    this.updateView(dt, {
      speed: newHorizontalSpeed,
      sprinting: wantsSprint && moveZ > 0 && !this.focused && newHorizontalSpeed > 5,
      sliding,
      wallRunning: canWallRun,
      moving: WISH.lengthSq() > 0,
    });
    this.syncCamera(dt);

    const actions = {
      fire: this.wantsToFire(),
      reload: this.pressed.has('KeyR'),
      sliding,
      wallRunning: canWallRun,
      sprinting: wantsSprint && moveZ > 0 && newHorizontalSpeed > 5,
      speed: newHorizontalSpeed,
    };
    if (BOW_WEAPONS.has(this.weaponType) && this.buttonReleased.has(0)) {
      this.bowDrawTime = 0;
    }
    this.pressed.clear();
    this.buttonPressed.clear();
    this.buttonReleased.clear();
    this.mouseDelta.set(0, 0);
    return actions;
  }

  updateView(delta, movement) {
    const bobStrength = movement.moving && this.grounded ? clamp(movement.speed / 7, 0, 1) : 0;
    const bobFrequency = movement.sprinting ? 1.28 : 1;
    const phase = this.stepCycle * Math.PI * 2 * bobFrequency;
    const targetBob = Math.sin(phase) * 0.018 * bobStrength;
    this.bob = damp(this.bob, targetBob, 13, delta);
    this.landKick = damp(this.landKick, 0, 13, delta);
    this.recoil = damp(this.recoil, 0, 14, delta);
    this.recoilSide = damp(this.recoilSide, 0, 12, delta);
    this.weaponKick = damp(this.weaponKick, 0, 18, delta);
    this.inspect = Math.max(0, this.inspect - delta * 1.8);
    this.shotFrameTime = Math.max(0, this.shotFrameTime - delta);
    if (this.reloading) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - delta);
      if (this.reloadRemaining <= 0 && !this.reloadServerControlled) {
        this.finishReload();
      }
    }

    this.sway.x = damp(this.sway.x, clamp(-this.mouseDelta.x * 0.0005, -0.045, 0.045), 15, delta);
    this.sway.y = damp(this.sway.y, clamp(-this.mouseDelta.y * 0.00045, -0.04, 0.04), 15, delta);

    const focusAmount = this.focused ? 1 : 0;
    const targetX = 0.45 * (1 - focusAmount) + 0.01 * focusAmount;
    const targetY = -0.31 * (1 - focusAmount) - 0.215 * focusAmount;
    const targetZ = -0.66 + this.weaponKick * 0.042 + (movement.sprinting ? 0.09 : 0);
    const inspectRotation = this.inspect > 0
      ? Math.sin((1 - this.inspect) * Math.PI) * 0.48
      : 0;
    this.viewRoot.position.x = damp(this.viewRoot.position.x, targetX + this.sway.x, 15, delta);
    this.viewRoot.position.y = damp(
      this.viewRoot.position.y,
      targetY + this.bob - this.landKick + this.sway.y,
      15,
      delta,
    );
    this.viewRoot.position.z = damp(this.viewRoot.position.z, targetZ, 18, delta);
    this.viewRoot.rotation.x = damp(
      this.viewRoot.rotation.x,
      -0.035 - this.recoil * 0.065 + (movement.sprinting ? -0.25 : 0) + this.sway.y * 0.8,
      15,
      delta,
    );
    this.viewRoot.rotation.y = damp(
      this.viewRoot.rotation.y,
      -0.035 + this.recoilSide * 0.055 + inspectRotation + this.sway.x,
      15,
      delta,
    );
    this.viewRoot.rotation.z = damp(
      this.viewRoot.rotation.z,
      movement.sprinting ? -0.22 : inspectRotation * 0.22 - this.sway.x * 0.5,
      13,
      delta,
    );
    if (this.viewmodelSprite) {
      const weaponMotion = VIEWMODEL_MOTION[this.weaponType] ?? VIEWMODEL_MOTION.knives;
      let actionX = 0;
      let actionY = 0;
      let actionRotate = 0;
      let actionScale = 1;
      const frame = this.updateViewmodelAnimation(delta);
      if (this.weaponType === 'greatsword' && frame === 'fire') {
        const frameCount = this.viewmodelAnimation.frameCount('fire');
        const sweep = greatswordSweepForFrame(
          this.viewmodelAnimation.frameIndex,
          frameCount,
        );
        actionX = sweep.x;
        actionY = sweep.y;
        actionRotate = sweep.rotate;
        actionScale = sweep.scale;
      } else if (this.reloading) {
        const progress = 1 - this.reloadRemaining / Math.max(0.001, this.reloadDuration);
        const arc = Math.sin(progress * Math.PI);
        actionX = arc * -34;
        actionY = arc * 64;
        actionRotate = arc * weaponMotion.reloadRotate;
      } else if (this.shotFrameTime > 0) {
        const attack = clamp(this.shotFrameTime / 0.12, 0, 1);
        actionX = attack * weaponMotion.fireX;
        actionY = attack * weaponMotion.fireY;
        actionRotate = attack * weaponMotion.fireRotate;
        actionScale = 1 + attack * (this.weaponType === 'fireball' || this.weaponType === 'ember' ? 0.055 : 0.018);
      } else if (BOW_WEAPONS.has(this.weaponType) && this.bowDrawTime > 0) {
        const draw = clamp(this.bowDrawTime / BOW_FULL_DRAW, 0, 1);
        actionX = -12 * draw;
        actionY = 5 * draw;
        actionScale = 1 + draw * 0.012;
      }
      if (BOW_WEAPONS.has(this.weaponType)) {
        actionX += bowRightSideOffset(frame, globalThis.innerWidth);
      }
      this.viewmodelSprite.classList.toggle('is-firing', this.shotFrameTime > 0);
      this.viewmodelSprite.classList.toggle('is-reloading', this.reloading);
      this.viewmodelSprite.classList.toggle('is-drawing', frame === 'draw');
      this.viewmodelSprite.classList.toggle('is-sprinting', movement.sprinting);
      this.viewmodelSprite.classList.toggle('is-moving', movement.moving && this.grounded);
      this.viewmodelSprite.style.setProperty('--vm-x', `${this.sway.x * 240}px`);
      const viewmodelY = (-this.bob + this.landKick + this.weaponKick * 0.02) * 420;
      this.viewmodelSprite.style.setProperty('--vm-y', `${viewmodelY}px`);
      this.viewmodelSprite.style.setProperty(
        '--vm-rotate',
        `${(this.sway.x * -38 + (movement.sprinting ? -5 : 0)).toFixed(2)}deg`,
      );
      this.viewmodelSprite.style.setProperty('--vm-action-x', `${actionX.toFixed(2)}px`);
      this.viewmodelSprite.style.setProperty('--vm-action-y', `${actionY.toFixed(2)}px`);
      this.viewmodelSprite.style.setProperty('--vm-action-rotate', `${actionRotate.toFixed(2)}deg`);
      this.viewmodelSprite.style.setProperty('--vm-action-scale', actionScale.toFixed(3));
      this.viewmodelSprite.style.setProperty('--vm-scale', this.focused ? '0.86' : '1');
      this.viewmodelAnchorMotion = {
        actionY,
        actionScale,
        viewmodelY,
        rotation: actionRotate + this.sway.x * -38 +
          (movement.sprinting ? -5 : 0) +
          (this.weaponType === 'greatsword' ? -7 : 0),
      };
      this.updateViewmodelBottomAnchor();
      this.viewmodelLayer?.classList.toggle('active', this.viewRoot.visible && !this.dead);
    }
  }

  syncCamera(delta) {
    const sliding = this.slideTime > 0;
    const targetHeight = sliding ? 0.88 : 1.64;
    this.cameraHeight = damp(this.cameraHeight, targetHeight, sliding ? 18 : 10, delta);
    const targetRoll = this.wallSide * -0.17;
    this.cameraRoll = damp(this.cameraRoll, targetRoll, 8, delta);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      this.shake = damp(this.shake, 0, 8, delta);
    } else {
      this.shake = damp(this.shake, 0, 18, delta);
    }
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;
    const shakeZ = (Math.random() - 0.5) * this.shake * 0.5;
    const bobY = Math.abs(this.bob) * 0.45;
    this.camera.position.set(
      this.position.x + shakeX,
      this.position.y + this.cameraHeight + bobY + shakeY,
      this.position.z + shakeZ,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      this.pitch + this.recoil * 0.003,
      this.yaw,
      this.cameraRoll + Math.sin(this.stepCycle * Math.PI * 2) * 0.008 + shakeZ,
    );
    const targetFov = this.focused
      ? this.weaponType === 'longbow' || this.weaponType === 'crossbow'
        ? 48
        : 59
      : this.slideTime > 0 || Math.hypot(this.velocity.x, this.velocity.z) > 7.7
        ? 79
        : 73;
    const nextFov = damp(this.camera.fov, targetFov, 9, delta);
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
