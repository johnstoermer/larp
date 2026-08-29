import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DEFAULT_ARGS = Object.freeze([
  '--enable-webgl',
  '--ignore-gpu-blocklist',
]);

function configuredExecutablePath() {
  return (
    process.env.LARP_CHROMIUM_EXECUTABLE_PATH ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    ''
  ).trim();
}

/**
 * Launch Playwright's bundled Chromium unless an explicit executable override
 * is supplied. The override is useful for production-browser spot checks, but
 * keeping the bundled browser as the default makes QA portable and repeatable.
 */
export function launchChromium({ forceSoftwareWebgl = true, ...options } = {}) {
  const executablePath = configuredExecutablePath();
  const args = [
    ...DEFAULT_ARGS,
    ...(forceSoftwareWebgl ? ['--use-angle=swiftshader'] : []),
    ...(options.args ?? []),
  ];
  return chromium.launch({
    headless: true,
    ...options,
    args,
    ...(executablePath ? { executablePath } : {}),
  });
}

export function pathFromUrl(url) {
  return fileURLToPath(url);
}
