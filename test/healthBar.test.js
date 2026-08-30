import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BotController } from '../src/game/BotController.js';
import {
  HEALTH_BAR_COLORS,
  HEALTH_BAR_STYLE,
  createHealthBarTexture,
  renderHealthBarPixels,
  updateHealthBarTexture,
} from '../src/game/healthBar.js';

function pixelColor(data, width, x, y) {
  const offset = (y * width + x) * 4;
  return (
    (data[offset] << 16) |
    (data[offset + 1] << 8) |
    data[offset + 2]
  );
}

test('Win98 health progress pixels keep every fill pixel inside the trough', () => {
  const { width, height, inset, fill } = HEALTH_BAR_STYLE;
  for (const ratio of [-1, 0, 0.01, 0.3, 0.72, 1, 2, Number.NaN]) {
    const data = new Uint8Array(width * height * 4);
    const metrics = renderHealthBarPixels(data, ratio);
    let fillPixelCount = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        assert.equal(data[offset + 3], 255);
        if (pixelColor(data, width, x, y) !== fill) continue;
        fillPixelCount += 1;
        assert.ok(x >= inset && x < width - inset);
        assert.ok(y >= inset && y < height - inset);
        assert.ok(x >= metrics.fillBounds.left && x < metrics.fillBounds.right);
      }
    }

    assert.ok(metrics.fillPixels >= 0);
    assert.ok(metrics.fillPixels <= metrics.fillCapacity);
    assert.equal(fillPixelCount, metrics.fillPixels * (height - inset * 2));
  }
});

test('health progress texture updates in place with nearest-neighbor Win98 edges', () => {
  const texture = createHealthBarTexture(1);
  const data = texture.image.data;
  const initialId = texture.uuid;

  const metrics = updateHealthBarTexture(texture, 0.72);

  assert.equal(texture.uuid, initialId);
  assert.equal(texture.name, 'win98-character-health-progress');
  assert.equal(texture.magFilter, THREE.NearestFilter);
  assert.equal(texture.minFilter, THREE.NearestFilter);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(metrics.ratio, 0.72);
  assert.equal(metrics.fillPixels, Math.round(metrics.fillCapacity * 0.72));
  assert.equal(
    pixelColor(data, HEALTH_BAR_STYLE.width, 0, 0),
    HEALTH_BAR_STYLE.shadow,
  );
  assert.equal(
    pixelColor(
      data,
      HEALTH_BAR_STYLE.width,
      HEALTH_BAR_STYLE.width - 1,
      HEALTH_BAR_STYLE.height - 1,
    ),
    HEALTH_BAR_STYLE.light,
  );
});

test('relationship colors update in place even when the health ratio is unchanged', () => {
  const texture = createHealthBarTexture(0.72, HEALTH_BAR_COLORS.ally);
  const fillX = HEALTH_BAR_STYLE.inset + 1;
  const fillY = HEALTH_BAR_STYLE.inset + 1;

  assert.equal(
    pixelColor(texture.image.data, HEALTH_BAR_STYLE.width, fillX, fillY),
    HEALTH_BAR_COLORS.ally,
  );

  const metrics = updateHealthBarTexture(
    texture,
    0.72,
    HEALTH_BAR_COLORS.enemy,
  );
  assert.equal(metrics.fill, HEALTH_BAR_COLORS.enemy);
  assert.equal(
    pixelColor(texture.image.data, HEALTH_BAR_STYLE.width, fillX, fillY),
    HEALTH_BAR_COLORS.enemy,
  );
});

test('moving and turning a fighter preserves one stable health-bar sprite', () => {
  const bot = new BotController(new THREE.Scene(), {}, {});
  bot.health = 72;
  bot.updateHealthBar();

  const bar = bot.healthBar;
  const material = bar.material;
  const texture = material.map;
  const localPosition = bar.position.clone();
  const scale = bar.scale.clone();

  assert.equal(bar.isSprite, true);
  assert.equal(bar.children.length, 0);
  assert.equal(material.depthWrite, false);
  assert.equal(material.fog, false);
  assert.equal(bar.userData.relationship, 'enemy');
  assert.equal(texture.userData.fill, HEALTH_BAR_COLORS.enemy);

  for (let frame = 0; frame < 24; frame += 1) {
    bot.position.set(frame * 0.13, Math.sin(frame * 0.2) * 0.05, frame * -0.07);
    bot.root.rotation.y = frame * 0.31;
    bot.velocity.set(Math.cos(frame) * 5, 0, Math.sin(frame) * 5);
    bot.animate(1 / 30, bot.velocity, true);
    bot.root.updateMatrixWorld(true);

    assert.equal(bot.healthBar, bar);
    assert.equal(bar.material, material);
    assert.equal(bar.material.map, texture);
    assert.deepEqual(bar.position.toArray(), localPosition.toArray());
    assert.deepEqual(bar.scale.toArray(), scale.toArray());
    assert.equal(bar.userData.ratio, 0.72);
    assert.ok(bar.userData.fillPixels <= bar.userData.fillCapacity);

    const worldPosition = bar.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(worldPosition.x - bot.position.x) < 1e-9);
    assert.ok(Math.abs(worldPosition.y - (bot.position.y + localPosition.y)) < 1e-9);
    assert.ok(Math.abs(worldPosition.z - bot.position.z) < 1e-9);
  }
});
