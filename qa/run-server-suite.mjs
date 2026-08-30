import { spawn } from 'node:child_process';

const scripts = [
  'test:title',
  'test:browser',
  'test:hud',
  'test:multiplayer',
  'test:war',
  'test:war-tdm',
  'test:war-load',
  'test:war-performance',
  'test:performance',
  'test:load',
  'visual:review',
];

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const configuredUrl = (process.env.LARP_URL || '').trim();
const requestedPort = Number(process.env.LARP_QA_PORT || 4178);
const qaPort = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536
  ? requestedPort
  : 4178;
const baseUrl = configuredUrl || `http://127.0.0.1:${qaPort}`;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}.`));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`QA server exited before becoming healthy (${child.exitCode ?? child.signalCode}).`);
    }
    try {
      const response = await fetch(new URL('/healthz', url));
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`QA server did not become healthy at ${url}: ${lastError?.message || 'timeout'}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
}

let server;
try {
  if (!configuredUrl) {
    server = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PORT: String(qaPort) },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    server.once('error', (error) => {
      server.spawnError = error;
    });
    await waitForServer(baseUrl, server);
  }

  for (const script of scripts) {
    await run(npmCommand, ['run', script], {
      env: { ...process.env, LARP_URL: baseUrl },
    });
  }
} finally {
  await stopServer(server);
}
