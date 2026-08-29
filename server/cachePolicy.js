import path from 'node:path';

export function cacheControlForFile(filePath) {
  const normalized = String(filePath).split(path.sep).join('/');
  if (normalized.endsWith('.html') || normalized.includes('/assets/larp/')) {
    return 'no-cache';
  }
  return 'public, max-age=31536000, immutable';
}
