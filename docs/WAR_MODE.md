# War mode

War has two separate 20-versus-20 variants on one large map: Control and Team
Deathmatch. Arena offers one-versus-one and two-versus-two matches on its
existing maps and rules, and shares protocol version 7 while retaining its
weapons, pickups, rounds, and reconnect behavior.

## Rules and source basis

The public publisher descriptions establish the parts of the rules that War
uses directly:

- Blizzard describes Overwatch Control as both teams fighting to capture one
  objective and then holding it to score, normally in a best-of-three match:
  [Overwatch 2 – Season 13: Spellbinder](https://overwatch.blizzard.com/en-us/news/24146047/).
- NetEase states that the first side to reach 100% capture progress wins a
  Domination match:
  [Marvel Rivals Version 20250912 Patch Notes](https://www.marvelrivals.com/gameupdate/20250904/41548_1257695.html).
- NetEase documents overtime and a 0.5-second grace period at its end:
  [Marvel Rivals Version 20250221 Patch Notes](https://www.marvelrivals.com/m/gameupdate/20250218/41548_1212474.html).
- NetEase has shipped an 18-versus-18 mode using Domination rules, supporting
  the use of this objective format for a larger match:
  [Marvel Rivals Version 20251127 Patch Notes](https://www.marvelrivals.com/gameupdate/20251126/41548_1273366.html).

Those official pages give the high-level mode, victory threshold, and overtime
grace, but they do not publicly specify every timing and edge case. The
following are explicit LARP implementation choices, not claims about hidden
Overwatch or Marvel Rivals internals:

1. Control is one round on one large map. It does not use best-of-three because
   a single 40-player round fits the current room and map architecture cleanly.
2. The central point is neutral and locked for the first 15 seconds.
3. An uncontested team captures it in 8 seconds. Extra bodies do not accelerate
   capture. A neutral contest pauses capture at its current value.
4. The owner gains one percentage point per second, including while contested,
   until the overtime rule prevents the result.
5. An enemy takeover requires the owner to leave the point and the enemy to
   complete a fresh 8-second capture. A returning owner clears partial enemy
   takeover progress.
6. Once the owner reaches 99%, an enemy on the point starts overtime. Overtime
   remains active while the contest is valid. When it clears, a 0.5-second
   grace timer drains; enemy re-entry resets that timer.
7. A team wins only after reaching 100% while no valid overtime contest remains.
   A completed takeover cancels the former owner's overtime rather than
   awarding that team a delayed win.

The pure `WarControl` state machine and its tests are the executable rule
definition. The server, not a browser, supplies occupancy and owns capture,
percentage, overtime, and the result.

Team Deathmatch is a separate one-round variant on the same map. Control-point
occupancy and percentage do not score in this mode. Only enemy eliminations add
to the team score, and the first team to reach 100 kills wins.

## Match structure

- Two teams contain exactly 20 slots each. An online human takes one team slot;
  every unoccupied slot is immediately controlled by a deterministic bot.
- A disconnected human's slot becomes a bot so a team never loses a body.
  Reconnection with the same session token reclaims that slot within 20 seconds.
- A player chooses one of the complete Arena roster before joining: Throwing
  Knives, Shortbow, Ember Gauntlet, Crossbow, Greatsword, Lightning, Longbow,
  or Fireball Tome. The selected class defines health, speed, weapon, damage,
  cadence, range, magazine, reserve, and reload timing.
- Throwing Knives deal 16 damage and repeat once per second while primary fire is held.
  Throwing Knives, Shortbow, Longbow, and Greatsword remain ammo-free. The four
  magazine-based classes keep their Arena magazine, reserve, and reload rules; an empty
  trigger starts a reload when reserve remains. Fireball Tome remains a moving
  server projectile and applies splash damage only when that projectile hits.
- War has no field weapon pickups. Class changes apply at the next spawn.
- Death starts a 5-second respawn timer and then returns the combatant to its
  team grid. Scoring, damage, deaths, assists, respawns, and bot decisions are
  all server authoritative.

## Performance boundaries

The server represents 40 combatants as plain state records and advances bots at
a deterministic fixed 10 Hz. It does not construct 40 client `BotController`
objects. One room snapshot is encoded once and shared with connected clients at
10 Hz. Frames above 1 KiB negotiate low-latency WebSocket compression, while
snapshots and visual attack events may be dropped for a backpressured socket.
The 40-client stress gate requires every client to receive the expected
snapshots while averaging no more than 80 KB/s of measured wire traffic. The
production process admits one room per War mode, for at most two simultaneous
War rooms, so a connection burst cannot allocate unbounded 40-bot simulations
on the 256 MiB machine.

The browser keeps all 40 network records and owns a pool of 39 lightweight
fighter cutouts for every remote combatant; the local player remains the
first-person viewmodel. A 190-unit safety cull still rejects actors beyond the
entire playable field, while full attack/hit animation is limited to 72 units
and health blocks to 58 units. A health block is suppressed inside 4 units or
behind the camera so a near-plane projection cannot create a giant clipped bar;
the fighter itself remains visible. Far actors retain idle, walk, and death state,
so the central battle can visibly contain all 40 combatants without running 40
heavyweight controllers. Health textures are rewritten only when their ratio
changes.

## Map and vegetation

The War field is 240 by 200 world units with mirrored team spawn grids, open
routes, simple box cover, hard boundary collision, and one unobstructed central
point used by Control. Team Deathmatch ignores the point. Neither mode contains
pickup locations.

Trees and bushes are never camera-facing sprites. Each placement is a fixed
group of exactly two identical transparent photo planes intersecting at 90
degrees; from above the geometry forms an X. Runtime code never changes those
plane yaws. The shipped alpha assets are:

- `public/assets/larp/war/tree.webp`: one complete, roughly radial deciduous
  tree, full trunk and canopy, 3:4 source aspect.
- `public/assets/larp/war/bush.webp`: one complete, roughly radial scrub bush,
  4:3 source aspect.

Both have true transparent corners, 8–12% safety gutters, no baked ground or
cast-shadow patch, and the same realistic quirky 2010 iPhone-photo treatment as
the rest of LARP. The tree ships at 896 by 1024 and the bush at 1024 by 768.
The loader retains a transparent one-pixel fallback if a deployment ever omits
either file, so a missing cutout cannot create a black or white rectangle.
