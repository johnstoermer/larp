import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARP_ASSET_REVISION,
  versionLarpAssetUrl,
} from '../src/game/assetUrl.js';
import { cacheControlForFile } from '../server/cachePolicy.js';

test('every stable LARP artwork URL receives one shared revision', () => {
  assert.equal(
    versionLarpAssetUrl('/assets/larp/props/wooden-cart.webp'),
    `/assets/larp/props/wooden-cart.webp?v=${LARP_ASSET_REVISION}`,
  );
  assert.equal(
    versionLarpAssetUrl('/assets/larp/cover.webp?size=small#crop'),
    `/assets/larp/cover.webp?size=small&v=${LARP_ASSET_REVISION}#crop`,
  );
  const alreadyVersioned = '/assets/larp/cover.webp?v=manual';
  assert.equal(versionLarpAssetUrl(alreadyVersioned), alreadyVersioned);
  assert.equal(versionLarpAssetUrl('/assets/index-abc123.js'), '/assets/index-abc123.js');
});

test('LARP art revalidates while content-hashed bundles remain immutable', () => {
  assert.equal(cacheControlForFile('/srv/dist/index.html'), 'no-cache');
  assert.equal(cacheControlForFile('/srv/dist/assets/larp/pickups/shortbow.webp'), 'no-cache');
  assert.equal(
    cacheControlForFile('/srv/dist/assets/index-abc123.js'),
    'public, max-age=31536000, immutable',
  );
});
