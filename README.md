# LARP

LARP is a fast online browser FPS built like a classic Doom-era game: a true
3D arena made from simple geometry, low-resolution photographic textures,
camera-facing character cutouts, directional photo projectiles, and a fixed
first-person photographic weapon layer.

The battlefield is Battle Village, a compact mirrored three-lane map inspired
by the competitive flow of small two-home arena maps. Red and blue timber
houses face across a cover-filled center while hedge and tent lanes provide
fast flanks. The visual presentation combines awkward direct-flash 2010 phone
photography—ordinary heavier hobbyists, thick glasses, thrift-store costumes,
and homemade foam/cardboard props—with a square-edged Windows 98 interface
built directly on 98.css.

## Play modes

Arena is a live, server-authoritative 1v1 duel. Quick Match,
five-letter private-room codes, shareable invite links, local movement
prediction, server reconciliation, buffered opponent interpolation,
lag-compensated hit registration, and a 20-second reconnect hold follow the
real-time multiplayer conventions used on herm.cool. A complete practice
match against the Questmaster bot is also available from the title screen.

Arena 2v2 uses the same Battle Village map, pickups, takes, and rounds with
two teams of two. Server-controlled bots fill open team slots immediately,
and joining players replace them without interrupting the match.

Win two takes to claim a round and four rounds to win the match.

War has two separate 20v20 matches on a 240-by-200 open field. Humans choose a
class and replace deterministic bots, which keep both teams at 20. Control is
won by holding the central point to reach 100%, with a contested overtime grace
at the end. Team Deathmatch is won by the first team to reach 100 kills. Both
modes use five-second respawns and contain no field pickups.

## Arsenal

- Throwing knives
- Ashwood shortbow
- Ember gauntlet
- Oaken crossbow
- Storm wand
- Yew longbow
- EVA-foam greatsword
- Fireball tome

Every weapon has one first-person idle image plus a stepped firing sequence.
Throwing knives are ammo-free and repeat once per second while the left mouse
button is held; they never enter a reload. Magazine-based ranged weapons have
three reload poses. Both bows instead
have three draw frames and automatically nock their next arrow without ammo or
reload bookkeeping: hold the left mouse button to draw and release it to loose
the arrow. The greatsword is
a true ammo-free melee weapon with a dedicated six-frame windup, broad swing,
impact, follow-through, and recovery sequence; it never reloads. Each weapon
also has idle, walk, attack, hit, and non-graphic death photographs for its
ordinary costumed LARPer.

The instant a shot enters the world, the corresponding first- and third-person
attack cutouts contain no detached projectile. Arrows, bolts, knives, and the
fireball therefore appear exactly once as world-space effects, never doubled
inside the photographic player layer.

For weapons that do use ammunition, pulling the trigger on an empty magazine
starts a reload automatically whenever reserve ammunition remains. Throwing
knives, bows, and the greatsword stay exempt because they are intentionally
ammo-free.

## Controls

- `WASD` move
- `Mouse` aim
- `Left mouse` attack; hold for throwing knives, hold and release for bows
- `Right mouse` focus
- `Shift` sprint
- `Space` jump / wall-run
- `Control` or `C` slide
- `R` reload
- `Tab` hold scoreboard (kills, deaths, assists)
- `Escape` pause

## Multiplayer

The Node/WebSocket server broadcasts Arena at 30 Hz and each 40-slot War
simulation at 10 Hz. It owns
match time, phases, scores, health, ammunition, reloads, pickups,
fire cadence, hit tests, fireball simulation, overtime, and disconnect
forfeits. Browsers predict only their own motion, reconcile against accepted
input sequences, and interpolate their opponent.

- Quick Match pairs two waiting players.
- Private Room creates a five-letter code and copyable invite URL.
- Reloading the page or briefly losing the socket reclaims the same session.
- Practice and online play share the same forgiving photographed-character
  body/head hit profile, while world cover still blocks the shot first.
- Disposable movement, snapshot, and cosmetic attack messages yield to
  reliable match state and targeted knockback if a WebSocket is backpressured.
- `/api/status` exposes aggregate health without player-identifying data.

See [docs/MULTIPLAYER.md](docs/MULTIPLAYER.md) for the authority model.

## Development

```sh
npm install
npm run dev
```

Run the complete unit, asset-integrity, build, browser, multiplayer,
performance, load, and visual-review suite. The command starts and stops its
own production server:

```sh
npm run qa:all
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
