# Multiplayer architecture

LARP runs one authoritative match process on Fly.io. The browser never submits
damage, scores, ammunition totals, or pickup outcomes. Protocol version 3 is
shared by the browser client, automated load clients, and server.

## Session flow

1. The client opens `/ws` and sends its protocol version, callsign, and opaque
   reconnect token.
2. Quick play enters a FIFO queue. Private play reserves a five-character
   field code until a second player joins.
3. The room selects the deterministic Battle Village map and loadout seed.
4. Both clients load the arena and report readiness before the intro begins.
5. The server advances match phases and sends fresh snapshots at 30 Hz.
6. A dropped socket freezes match time for up to 20 seconds. Reconnecting with
   the same token restores the player, room, and slot.

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

The client owns:

- immediate local movement prediction;
- bow hold/release input and viewmodel animation;
- weapon recoil, audio, photographic projectiles, and effects;
- buffered opponent interpolation and short extrapolation;
- correction against the server-acknowledged input sequence.

Practice and multiplayer both import one hit profile: a `0.68`-radius body
sphere centered `0.96` units above the feet and a `0.38`-radius head sphere
centered at `1.75`. The world trace is resolved first, so the more forgiving
character silhouette never permits a shot through cover.

## Operational limits

Messages are capped at 4 KiB and 100 messages per second per session.
WebSocket compression is disabled to avoid latency and memory overhead on
small real-time packets. Client state and server snapshots are disposable when
a socket is already backpressured: the next current state replaces stale
realtime data, while shots, damage, reloads, and match events remain reliable.
Only one application ping is outstanding at a time, and the HUD reports the
rolling median of the latest measured round trips so an isolated main-thread
stall does not masquerade as a persistent network route problem.

Fly connection concurrency is capped at 200, and `/api/status` reports room,
queue, connection, traffic, dropped realtime snapshots, and tick-drift metrics
without exposing player identities.
