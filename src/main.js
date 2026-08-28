import './styles.css';
import { Game } from './game/Game.js';

const canvas = document.getElementById('world');
const errorScreen = document.getElementById('error-screen');
const errorDetail = document.getElementById('error-detail');

try {
  if (!canvas || !window.WebGL2RenderingContext) {
    throw new Error('WebGL 2 is required to run LARP.');
  }
  const context = canvas.getContext('webgl2', {
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    depth: true,
    stencil: false,
  });
  if (!context) {
    throw new Error('Your browser could not create a WebGL 2 rendering context.');
  }
  // Three.js creates its own renderer context after this capability check.
  const game = new Game(canvas);
  Object.defineProperty(window, '__LARP_GAME__', {
    value: game,
    configurable: false,
    enumerable: false,
    writable: false,
  });
} catch (error) {
  console.error(error);
  errorDetail.textContent =
    error instanceof Error ? error.message : 'The game failed to initialize.';
  errorScreen.classList.add('active');
}
