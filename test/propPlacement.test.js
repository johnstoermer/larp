import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BATTLE_VILLAGE_PROP_COLLIDERS,
  BATTLE_VILLAGE_PROP_PLANES,
  MAPS as NETWORK_MAPS,
} from '../server/multiplayer/config.js';
import {
  FIXED_PHOTO_PROP_PLANE_DEPTH,
  fixedPhotoPropCollisionBounds,
  quantizeFixedPhotoPropYaw,
  rotatedFootprintExtents,
} from '../shared/warSceneryGeometry.js';
import {
  bodyIntersectsWorld,
  firstWorldHit,
} from '../server/multiplayer/geometry.js';
import {
  Arena,
  PHOTO_PROP_LAYOUTS,
  PHOTO_PROP_MINIMUM_GAP,
  TITLE_ATTRACT_PROP_EXCLUSION_BOUNDS,
  horizontalBoundsGap,
  photoPropClearanceFromBounds,
  photoPropFootprintBounds,
  photoPropPairClearance,
  pointToHorizontalBoundsGap,
} from '../src/game/Arena.js';

const PROP_COLLIDER_KEYS = new Set(
  Object.values(BATTLE_VILLAGE_PROP_COLLIDERS).map((bounds) => JSON.stringify(bounds)),
);

// The floor is not cover, and the seven new invisible physical footprints are
// deliberately not rendered. Everything else in this list has a visible mesh.
const VISIBLE_COVER_BOUNDS = NETWORK_MAPS[0].colliders
  .slice(1)
  .filter((bounds) => !PROP_COLLIDER_KEYS.has(JSON.stringify(bounds)));

const NAV_NODES = Object.freeze([
  [0, 16], [-8, 15], [8, 15], [-15, 13], [15, 13],
  [0, 9.5], [-9, 8], [9, 8], [-17, 5], [17, 5],
  [0, 5], [-9, 3.5], [9, 3.5], [-18, 0], [18, 0],
  [0, -5], [-9, -3.5], [9, -3.5], [-17, -5], [17, -5],
  [0, -9.5], [-9, -8], [9, -8], [-15, -13], [15, -13],
  [0, -16], [-8, -15], [8, -15],
]);

function boundsFromBox3(box) {
  return [
    box.min.x, box.min.y, box.min.z,
    box.max.x, box.max.y, box.max.z,
  ];
}

function assertBoundsApproximately(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-6,
      `${message}: component ${index} was ${actual[index]}, expected ${expected[index]}`,
    );
  }
}

test('all seven photos keep their old visible covers and receive distinct authoritative hitboxes', () => {
  assert.equal(PHOTO_PROP_LAYOUTS.length, 7);
  assert.equal(new Set(PHOTO_PROP_LAYOUTS.map((prop) => prop.name)).size, 7);

  const networkBounds = new Set(
    NETWORK_MAPS[0].colliders.map((bounds) => JSON.stringify(bounds)),
  );
  for (const prop of PHOTO_PROP_LAYOUTS) {
    assert.deepEqual(
      prop.collisionBounds,
      BATTLE_VILLAGE_PROP_COLLIDERS[prop.name],
      `${prop.name}: wrong authoritative prop hitbox`,
    );
    assert.deepEqual(
      prop.collisionBounds,
      fixedPhotoPropCollisionBounds(
        prop.position,
        prop.width,
        prop.collisionHeight,
        prop.yaw,
      ),
      `${prop.name}: collider does not enclose its yawed thin photo plane`,
    );
    assert.equal(prop.position, BATTLE_VILLAGE_PROP_PLANES[prop.name].position);
    assert.equal(prop.yaw, quantizeFixedPhotoPropYaw(prop.yaw));
    const [expectedX, expectedZ] = rotatedFootprintExtents(
      prop.width,
      FIXED_PHOTO_PROP_PLANE_DEPTH,
      prop.yaw,
    );
    assert.ok(Math.abs(prop.collisionBounds[3] - prop.collisionBounds[0] - expectedX) < 1e-10);
    assert.ok(Math.abs(prop.collisionBounds[5] - prop.collisionBounds[2] - expectedZ) < 1e-10);
    assert.ok(
      Math.min(
        prop.collisionBounds[3] - prop.collisionBounds[0],
        prop.collisionBounds[5] - prop.collisionBounds[2],
      ) <= 0.081,
      `${prop.name}: fixed photo wall is thicker than 8.1 cm`,
    );
    assert.ok(
      networkBounds.has(JSON.stringify(prop.coverBounds)),
      `${prop.name}: original visible cover moved or disappeared`,
    );
    assert.ok(
      networkBounds.has(JSON.stringify(prop.collisionBounds)),
      `${prop.name}: free-standing hitbox missing from authority map`,
    );
    assert.notDeepEqual(
      prop.coverBounds,
      prop.collisionBounds,
      `${prop.name}: photo still uses the visible cover as its hitbox`,
    );
    assert.ok(prop.visibleBottomRatio > 0, `${prop.name}: missing alpha-aware ground anchor`);
    assert.ok(prop.visibleBottomRatio < 0.25, `${prop.name}: invalid ground anchor`);
  }
});

test('every fixed photo plane and hitbox clears visible cover and the title actor', () => {
  for (const prop of PHOTO_PROP_LAYOUTS) {
    for (const [coverIndex, coverBounds] of VISIBLE_COVER_BOUNDS.entries()) {
      const visualGap = photoPropClearanceFromBounds(prop, coverBounds);
      const hitboxGap = horizontalBoundsGap(prop.collisionBounds, coverBounds);
      assert.ok(
        visualGap >= PHOTO_PROP_MINIMUM_GAP,
        `${prop.name}: rotating photo footprint is ${visualGap.toFixed(3)} from cover ${coverIndex}`,
      );
      assert.ok(
        hitboxGap >= PHOTO_PROP_MINIMUM_GAP,
        `${prop.name}: hitbox is ${hitboxGap.toFixed(3)} from cover ${coverIndex}`,
      );
    }

    const titleVisualGap = photoPropClearanceFromBounds(
      prop,
      TITLE_ATTRACT_PROP_EXCLUSION_BOUNDS,
    );
    const titleHitboxGap = horizontalBoundsGap(
      prop.collisionBounds,
      TITLE_ATTRACT_PROP_EXCLUSION_BOUNDS,
    );
    assert.ok(
      titleVisualGap >= PHOTO_PROP_MINIMUM_GAP,
      `${prop.name}: visual enters title-attract battle by ${titleVisualGap.toFixed(3)}`,
    );
    assert.ok(
      titleHitboxGap >= PHOTO_PROP_MINIMUM_GAP,
      `${prop.name}: hitbox enters title-attract battle by ${titleHitboxGap.toFixed(3)}`,
    );
  }
});

test('free-standing photos and hitboxes remain separated from each other', () => {
  for (let firstIndex = 0; firstIndex < PHOTO_PROP_LAYOUTS.length; firstIndex += 1) {
    const first = PHOTO_PROP_LAYOUTS[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < PHOTO_PROP_LAYOUTS.length; secondIndex += 1) {
      const second = PHOTO_PROP_LAYOUTS[secondIndex];
      const visualGap = photoPropPairClearance(first, second);
      const hitboxGap = horizontalBoundsGap(first.collisionBounds, second.collisionBounds);
      assert.ok(
        visualGap >= PHOTO_PROP_MINIMUM_GAP,
        `${first.name}/${second.name}: billboard footprints only ${visualGap.toFixed(3)} apart`,
      );
      assert.ok(
        hitboxGap >= PHOTO_PROP_MINIMUM_GAP,
        `${first.name}/${second.name}: hitboxes only ${hitboxGap.toFixed(3)} apart`,
      );
    }
  }
});

test('prop hitboxes leave every spawn, pickup and bot navigation node clear', () => {
  const protectedPoints = [
    ...NETWORK_MAPS[0].spawns.map(([x, , z]) => ({ x, z, gap: 2, name: 'spawn' })),
    ...NETWORK_MAPS[0].pickups.map(([x, , z, weapon]) => ({
      x, z, gap: 1, name: `${weapon} pickup`,
    })),
    ...NAV_NODES.map(([x, z], index) => ({ x, z, gap: 0.75, name: `nav ${index}` })),
  ];

  for (const prop of PHOTO_PROP_LAYOUTS) {
    for (const point of protectedPoints) {
      const gap = pointToHorizontalBoundsGap(point.x, point.z, prop.collisionBounds);
      assert.ok(
        gap >= point.gap,
        `${prop.name}: ${point.name} has only ${gap.toFixed(3)} hitbox clearance`,
      );
    }
  }
});

test('Arena photo planes keep their authored position and yaw when cameras move', () => {
  const arena = new Arena(new THREE.Scene(), {});
  assert.equal(arena.photoProps.length, PHOTO_PROP_LAYOUTS.length);

  const initial = arena.photoProps.map(({ sprite }) => ({
    position: sprite.position.clone(),
    scale: sprite.scale.clone(),
    quaternion: sprite.quaternion.clone(),
  }));
  const opposingCameras = [
    new THREE.Vector3(0, 1.64, 20),
    new THREE.Vector3(0, 1.64, -20),
    new THREE.Vector3(20, 1.64, 0),
    new THREE.Vector3(-20, 1.64, 0),
  ];
  for (const camera of opposingCameras) arena.update(1, 1 / 60, camera);

  for (const [index, runtimeProp] of arena.photoProps.entries()) {
    const layout = PHOTO_PROP_LAYOUTS[index];
    assert.equal(runtimeProp.sprite.name, `individual-photo-prop-${layout.name}`);
    assert.equal(runtimeProp.sprite.type, 'Mesh', `${layout.name}: not a fixed plane mesh`);
    assert.equal(runtimeProp.sprite.userData.fixedPhotoProp, true);
    assert.equal(runtimeProp.sprite.userData.fixedYaw, layout.yaw);
    assert.equal(runtimeProp.sprite.material.side, THREE.DoubleSide);
    assert.equal(runtimeProp.sprite.geometry.type, 'PlaneGeometry');
    assert.equal(runtimeProp.sprite.geometry.parameters.width, layout.width);
    assert.equal(runtimeProp.sprite.geometry.parameters.height, layout.height);
    assert.deepEqual(runtimeProp.sprite.position.toArray(), initial[index].position.toArray());
    assert.deepEqual(runtimeProp.sprite.scale.toArray(), initial[index].scale.toArray());
    assert.deepEqual(runtimeProp.sprite.quaternion.toArray(), initial[index].quaternion.toArray());
    assert.deepEqual(
      [runtimeProp.sprite.position.x, layout.position[1], runtimeProp.sprite.position.z],
      layout.position,
      `${layout.name}: photo world position drifted`,
    );
    assert.deepEqual(runtimeProp.footprintBounds, photoPropFootprintBounds(layout));

    // Plane lower edge includes transparent source padding. The first opaque
    // source row remains grounded two centimetres above the floor.
    const visibleBottom = runtimeProp.sprite.position.y
      - layout.height / 2
      + layout.visibleBottomRatio * layout.height;
    assert.ok(Math.abs(visibleBottom - 0.02) < 1e-8, `${layout.name}: photo floats`);
  }
});

test('Battle Village renders no roof meshes', () => {
  const arena = new Arena(new THREE.Scene(), {});
  const roofNodes = [];
  arena.root.traverse((node) => {
    if (/roof/i.test(node.name)) roofNodes.push(node.name);
  });
  assert.deepEqual(roofNodes, []);
  assert.equal(arena.materials.roof.name, 'photo-roof-shingles');
});

test('every moved collider blocks bodies and shots without rendering a proxy box', () => {
  const arena = new Arena(new THREE.Scene(), {});
  arena.root.updateMatrixWorld(true);

  for (const [index, runtimeProp] of arena.photoProps.entries()) {
    const layout = PHOTO_PROP_LAYOUTS[index];
    const bounds = layout.collisionBounds;
    const center = new THREE.Vector3(
      (bounds[0] + bounds[3]) / 2,
      0.02,
      (bounds[2] + bounds[5]) / 2,
    );
    const proxy = runtimeProp.collisionProxy;
    assert.equal(proxy.name, `invisible-photo-prop-collision-${layout.name}`);
    assert.equal(proxy.userData.invisiblePropCollision, true);
    assert.equal(proxy.material.transparent, true);
    assert.equal(proxy.material.opacity, 0);
    assert.equal(proxy.material.colorWrite, false);
    assert.equal(proxy.material.depthWrite, false);
    assert.equal(proxy.castShadow, false);
    assert.equal(proxy.receiveShadow, false);
    assert.ok(arena.raycastMeshes.includes(proxy), `${layout.name}: proxy cannot stop local shots`);

    const proxyBounds = new THREE.Box3().setFromObject(proxy);
    assertBoundsApproximately(boundsFromBox3(proxyBounds), bounds, `${layout.name}: proxy bounds`);

    const overlap = arena.getOverlaps(center, 0.2, 1.7, []);
    assert.ok(
      overlap.some((box) => {
        const actual = boundsFromBox3(box);
        return actual.every((value, component) => Math.abs(value - bounds[component]) < 1e-8);
      }),
      `${layout.name}: local movement passes through the prop`,
    );
    assert.equal(
      bodyIntersectsWorld(0, center.toArray()),
      true,
      `${layout.name}: server movement passes through the prop`,
    );

    const shotOrigin = [bounds[0] - 1, (bounds[1] + bounds[4]) / 2, center.z];
    const authorityHit = firstWorldHit(0, shotOrigin, [1, 0, 0], 2);
    assert.equal(authorityHit.hit, true, `${layout.name}: server projectile passes through`);
    assert.ok(
      Math.abs(authorityHit.distance - 1) < 1e-8,
      `${layout.name}: unexpected server hit distance ${authorityHit.distance}`,
    );

    const localRay = new THREE.Raycaster(
      new THREE.Vector3(...shotOrigin),
      new THREE.Vector3(1, 0, 0),
      0,
      2,
    );
    const localHits = localRay.intersectObject(proxy, false);
    assert.ok(localHits.length > 0, `${layout.name}: local ray passes through`);
    assert.ok(
      Math.abs(localHits[0].distance - 1) < 1e-6,
      `${layout.name}: unexpected local hit distance ${localHits[0].distance}`,
    );
  }

  const visibleCollisionBackings = arena.root.children.filter((child) =>
    child.userData.invisiblePropCollision && (
      child.material.colorWrite !== false || child.material.opacity !== 0
    ));
  assert.deepEqual(visibleCollisionBackings, [], 'a prop collision proxy can draw a backing');
});

test('the original visible cover meshes remain in their exact original world bounds', () => {
  const arena = new Arena(new THREE.Scene(), {});
  arena.root.updateMatrixWorld(true);
  for (const layout of PHOTO_PROP_LAYOUTS) {
    const cover = arena.root.getObjectByName(layout.coverName);
    assert.ok(cover, `${layout.name}: original cover mesh missing`);
    assert.equal(cover.userData.invisiblePropCollision, undefined);
    const actual = boundsFromBox3(new THREE.Box3().setFromObject(cover));
    assertBoundsApproximately(actual, layout.coverBounds, `${layout.name}: original cover moved`);
  }
});
