# Cookout 2

Cookout 2 is a fast browser FPS assembled like a classic ray-era shooter: a
true 3D backyard made from simple geometry, low-resolution photographic
textures, camera-facing photo cutouts, sprite projectiles, and a frame-animated
photographic weapon layer fixed over the first-person view.

The main mode is a live, server-authoritative 1v1 duel. Quick Match, five-letter
private room codes, shareable invite links, local prediction, server
reconciliation, buffered opponent interpolation, lag-compensated hit
registration, and a 20-second reconnect hold follow the conventions used by
the other real-time multiplayer games on herm.cool. A full practice match
against the Grillmaster bot is available from the title screen.

Three rotating cookout arenas, eight weapons, reloading, sprinting, sliding,
wall-running, air control, spatial audio, dynamic lighting, and a multi-round
match loop round out the game. Win two takes to claim a round and four rounds
to win the cookout.

## Multiplayer

The Node/WebSocket server simulates at 30 Hz and broadcasts snapshots at 20 Hz.
It owns the match clock, phases, scores, health, ammunition, reloads, pickups,
rate-of-fire validation, hit tests, projectile simulation, overtime, and
disconnect forfeits. Browsers predict only their own motion, reconcile against
accepted input sequences, and interpolate their opponent.

- Quick Match pairs two waiting players.
- Private Room creates a five-letter code and copyable invite URL.
- Reloading or briefly losing the socket reclaims the same session and slot.
- `/api/status` exposes aggregate service health without player-identifying
  information.

## Controls

- `WASD` move
- `Mouse` aim
- `Left mouse` fire
- `Right mouse` focus
- `Shift` sprint
- `Space` jump / wall-run
- `Control` or `C` slide
- `R` reload
- `Escape` pause

## Development

```sh
npm install
npm run dev
```

Run the test suite and production build:

```sh
npm test
npm run build
```

With the production server running, browser and load checks are available:

```sh
npm run test:browser
npm run test:multiplayer
npm run test:performance
npm run test:load
```

Serve the production build on port 8080:

```sh
npm start
```

## Deployment

The included `Dockerfile` and `fly.toml` deploy the production server to
Fly.io. The deployment keeps one authoritative process warm because active
rooms live in that process:

```sh
flyctl deploy
```

## Art direction

All shipped raster art was generated for this project with a photographic
stock-image treatment. No illustrated, painterly, cartoon, or intentionally
pixel-art assets are used. See [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md)
for the asset inventory and generation briefs.
