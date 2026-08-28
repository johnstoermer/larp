# LARP

LARP is a fast online browser FPS built like a classic Doom-era game: a true
3D arena made from simple geometry, low-resolution photographic textures,
camera-facing character cutouts, directional photo projectiles, and a fixed
first-person photographic weapon layer.

The battlefield is Battle Village, a compact mirrored three-lane map inspired
by the competitive flow of small two-home arena maps. Red and blue timber
houses face across a cover-filled center while hedge and tent lanes provide
fast flanks. The visual presentation combines ordinary stock-photo realism
with glossy, beveled, skeuomorphic 2010 iPhone-era menus and HUD panels.

## Play modes

The primary mode is a live, server-authoritative 1v1 duel. Quick Match,
five-letter private-room codes, shareable invite links, local movement
prediction, server reconciliation, buffered opponent interpolation,
lag-compensated hit registration, and a 20-second reconnect hold follow the
real-time multiplayer conventions used on herm.cool. A complete practice
match against the Questmaster bot is also available from the title screen.

Win two takes to claim a round and four rounds to win the match.

## Arsenal

- Throwing knives
- Ashwood shortbow
- Ember gauntlet
- Oaken crossbow
- Storm wand
- Yew longbow
- Steel greatsword
- Fireball tome

Every weapon has separate first-person idle, firing, and reload images. Both
bows also have individual draw images: hold the left mouse button to draw and
release it to loose the arrow. Each weapon has a distinct forward-facing
third-person fighter photograph. Arrows, bolts, and knives use individual
photographic plane meshes aligned with their travel direction in 3D space.

## Controls

- `WASD` move
- `Mouse` aim
- `Left mouse` attack; hold and release for bows
- `Right mouse` focus
- `Shift` sprint
- `Space` jump / wall-run
- `Control` or `C` slide
- `R` reload
- `Escape` pause

## Multiplayer

The Node/WebSocket server simulates at 30 Hz and broadcasts snapshots at 20
Hz. It owns match time, phases, scores, health, ammunition, reloads, pickups,
fire cadence, hit tests, fireball simulation, overtime, and disconnect
forfeits. Browsers predict only their own motion, reconcile against accepted
input sequences, and interpolate their opponent.

- Quick Match pairs two waiting players.
- Private Room creates a five-letter code and copyable invite URL.
- Reloading the page or briefly losing the socket reclaims the same session.
- `/api/status` exposes aggregate health without player-identifying data.

See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for the authority model.

## Development

```sh
npm install
npm run dev
```

Run the unit, build, browser, multiplayer, performance, and load checks:

```sh
npm test
npm run build
npm run test:browser
npm run test:multiplayer
npm run test:performance
npm run test:load
npm run visual:review
```

Serve the production build on port 8080:

```sh
npm start
```

## Deployment

The included `Dockerfile` and `fly.toml` deploy one authoritative process to
Fly.io because active rooms live in process memory:

```sh
flyctl deploy
```

All raster art was generated for this project as individual photographic
assets—no sprite sheets or texture atlases are used. See
[docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) for the asset inventory and
generation briefs.
