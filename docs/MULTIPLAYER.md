# Multiplayer architecture

LARP runs one authoritative match process on Fly.io. The browser never submits
damage, scores, ammunition totals, pickup outcomes, or control-point ownership.
Protocol version 7 is the shared wire contract for the browser client,
automated load clients, and server. War messages are additive, mode-scoped
messages so an Arena client never enters the 40-player path accidentally.

## Session flow

1. The client opens `/ws` and sends its protocol version, callsign, and opaque
   reconnect token.
2. Arena quick play enters a FIFO queue. Private play reserves a five-character
   field code until a second player joins.
3. The room selects the deterministic Battle Village map and loadout seed.
4. Both clients load the arena and report readiness before the intro begins.
5. The server advances match phases and sends fresh snapshots at 30 Hz.
6. A dropped socket freezes match time for up to 20 seconds. Reconnecting with
   the same token restores the player, room, and slot.

Arena 2v2 joins a live four-slot Battle Village room immediately. Two slots
belong to each team, server bots fill every open slot, and later humans replace
bots in balanced team order. Unlike the duel queue, a 2v2 disconnect hands the
slot to a bot so the other three combatants keep playing; the reconnect token
reserves that exact slot for 20 seconds.

War play instead joins an available 20-versus-20 room for the selected mode
immediately. Control scores by holding the central point; Team Deathmatch is
first to 100 kills. A human replaces one deterministic bot in a balanced team
slot, and bots continue to fill all other slots. A disconnect hands that slot
back to its bot, so the larger match never pauses. The session token reclaims
the same slot on reconnect. `WAR_MODE.md` records the exact scoring, class,
respawn, map, and performance choices.

## Authority boundaries

The server owns:

- round, take, overtime, and result transitions;
- health, deaths, ammunition, reload timing, weapons, and pickups;
- fire cadence and shot-sequence validation;
- automatic reload initiation when an ammo-based weapon receives an empty
  trigger request and still has reserve ammunition;
- deterministic weapon spread;
- historical player positions for bounded lag compensation;
- world occlusion plus shared photographed-character body and head hit tests;
- fireball movement, splash occlusion, self-damage, and impulse;
- movement sanity checks, arena bounds, and collision rejection.

For Arena 2v2 the same authority also owns balanced team allocation, bot
takeover, ally-damage rejection, assist credit, and the rule that a take ends
only when both members of one team are eliminated.

For War the server additionally owns team allocation, class validation,
20-versus-20 bot fill, fixed-tick bot movement and aim, respawns, mode scoring,
and the result. In Control it also owns point occupancy, capture ownership,
percentage, and overtime. War has no field weapon pickups.

The client owns:

- immediate local movement prediction;
- bow hold/release input and viewmodel animation;
- weapon recoil, audio, photographic projectiles, and effects;
- buffered opponent interpolation and short extrapolation;
- correction against the server-acknowledged input sequence.

War clients additionally own only local prediction and a bounded 39-cutout
render pool: one lightweight cutout for every possible remote slot while the
local slot uses its first-person viewmodel. The client receives all 40 plain
records, distance-culls beyond the field, and reduces animation and health-bar
work with distance; it never runs 40 heavyweight bot controllers.

Practice and multiplayer both import one hit profile: a `0.68`-radius body
sphere centered `0.96` units above the feet and a `0.38`-radius head sphere
centered at `1.75`. The world trace is resolved first, so the more forgiving
character silhouette never permits a shot through cover.

## Operational limits

Inbound messages are capped at 4 KiB and 100 messages per second per session.
The limiter runs before JSON parsing, emits one warning per rate window, and
closes a client that sustains 200 messages per second. Outbound WebSocket
frames larger than 1 KiB use level-one per-message deflate without context
takeover; small input, ping, and match-control frames avoid compression work.

Client state, War snapshots, and cosmetic attack/explosion broadcasts are
disposable when a socket is already backpressured. Authoritative deaths,
reloads, match transitions, and each affected player's fireball impulse remain
reliable; knockback is sent directly to that player rather than depending on a
droppable visual event. WebSocket control ping/pong supplies the server-owned
RTT used for bounded lag compensation. The HUD separately reports a rolling
median of application round trips so an isolated main-thread stall does not
masquerade as a persistent route problem.

The single 256 MiB process admits at most 120 concurrent WebSockets and one
40-slot room per War mode, for at most two simultaneous War rooms. Overflow in
a full mode receives a capacity response instead of allocating another 40-bot
simulation. Fly uses matching 100/120 soft and hard connection limits.
`/api/status` reports room, queue, connection, traffic, dropped realtime
messages, and tick-drift metrics without exposing player identities.
