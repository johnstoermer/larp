# Multiplayer architecture

Cookout 2 runs one authoritative match process on Fly.io. The browser never
submits damage, scores, ammunition totals, or pickup outcomes.

## Session flow

1. The client opens `/ws`, sends protocol version, callsign, and its opaque
   reconnect token.
2. Quick play enters a FIFO queue. Private play reserves a five-character
   field code until a second player joins.
3. The room selects a deterministic arena order and loadout seed.
4. Both clients load the arena and report readiness before the server begins
   the intro and countdown.
5. The server advances match phases at 30 Hz and sends snapshots at 20 Hz.
6. A dropped socket freezes match time for up to 20 seconds. Reconnecting with
   the same token restores the player, room, and slot.

## Authority boundaries

The server owns:

- round, take, overtime, and result transitions;
- health, deaths, ammunition, reload timing, weapons, and pickups;
- fire cadence and shot sequence validation;
- deterministic weapon spread;
- historical player positions for bounded lag compensation;
- world occlusion, body and head hit tests;
- rocket movement, splash occlusion, self-damage, and impulse;
- movement sanity checks, arena bounds, and collision rejection.

The client owns:

- immediate local movement prediction;
- view-model motion, recoil, audio, and effects;
- buffered opponent interpolation and short extrapolation;
- correction against the server-acknowledged input sequence.

## Operational limits

Messages are capped at 4 KiB and 100 messages per second per session.
WebSocket compression is intentionally disabled to avoid compression latency
and memory overhead on small real-time packets. Fly connection concurrency is
capped at 200, and `/api/status` reports room, queue, connection, traffic, and
tick-drift metrics.
