export const LARP_ASSET_REVISION = 'photo-v4-20260829';

/**
 * Stable public filenames were previously served as immutable for a year.
 * Version every LARP art request so an art pass cannot be shadowed by an old
 * browser-cache entry. The server still asks clients to revalidate afterward.
 */
export function versionLarpAssetUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/assets/larp/')) return url;
  if (/[?&]v=/.test(url)) return url;

  const hashAt = url.indexOf('#');
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const separator = withoutHash.includes('?') ? '&' : '?';
  return `${withoutHash}${separator}v=${LARP_ASSET_REVISION}${hash}`;
}
