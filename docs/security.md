# Security model

## What a result means

A result says how an interaction ended. It is never permission to award value.

- **Local results** (`Play`, `Begin`, `PlaySequence`) come from the player's own client and are
  presentation only. Use them for local feedback, or report them to a server flow that already
  authorized the attempt.
- **Server attempts** bind a result to one player connection, one owning resource, one spec, one
  time window and one delivery. They still cannot prove a human legitimately solved a client-side
  game: a modified client can report a plausible success. A nonce, seed, transcript or recomputed
  score does not remove that limitation. Do not promise cheat-proof skill checks.

The server owns whether an attempt exists and may affect gameplay. The calling resource owns what it
is worth. Never let the client's score set money, item quantity or permanent state without your own
bounded server policy (the demo pays a fixed amount and only when explicitly enabled).

## Boundaries

| Boundary | Direction | Trust | Checks |
| --- | --- | --- | --- |
| Client exports (`Play`, `Begin`, …) | caller resource → cortex-minigames (same client) | caller is a local resource | Invoking resource captured; options schema-validated, unknown keys rejected; ownership for `Cancel`/`IsBusy`. |
| NUI messages | Lua → CEF | trusted source, parsed defensively | Protocol version, resource generation, session id; malformed dropped. |
| NUI callbacks | CEF → Lua | untrusted | Protocol, generation, current session id and state; report validated against the catalog (status, reason, grade consistency, bounded numbers, metric allowlist); every callback replies exactly once. |
| `cortex-minigames:attempt:start` / `:cancel` | server → one client | server-originated | Client re-validates the spec with the same schema before any UI opens. |
| `cortex-minigames:attempt:ack` / `:complete` | client → server | hostile | See the ladder below. |
| `StartAttempt` / `CancelAttempt` / `GetAttempt` | server resource → cortex-minigames | server resource | Owner captured; player must be connected; per-player, per-owner and global caps; schema validation; client-only rules (`entity`, `check`) refused. |

## Server validation ladder

For every `ack` and `complete`:

1. `source` captured before anything else. Per-player event budget (`Config.Server.eventRate`/s);
   excess dropped, logging rate limited.
2. Types: 32-character attempt id, table payload, boolean `accepted`.
3. The attempt exists and is still pending or running (claimed, expired and cancelled attempts are
   gone: replays and duplicates do nothing).
4. Same server id **and** same connection token. Tokens are assigned per connection on
   `playerJoining`, so a reused numeric id never inherits an old attempt.
5. State order: `complete` needs a prior accepted `ack` (finish-without-start is refused).
6. Expiry: server clock, set at creation from the spec's budget plus startup and slack.
7. Routing bucket unchanged since creation; otherwise `cancelled/context_check`.
8. Shape: status/reason from the closed vocabulary, grade consistent with status and score, bounded
   score, mistakes and duration, allowlisted metrics. Sequences: step ids and games must match the
   issued spec in order, attempts within the retry bound, and an aggregate success needs every
   required step to have succeeded.
9. Plausibility: reported duration ≤ server-measured elapsed time + `durationSlackMs`; a success
   needs both reported duration and server-measured elapsed time to reach the game's
   `minDurationMs`. For sequences, elapsed time must cover the sum of the successful steps'
   minimums, including successes recorded before a failure or cancellation. Upper-bound slack
   never reduces this server-clock floor. Minimums are coarse catalog bounds, not proof of play.
10. **Atomic claim**: the attempt is marked claimed and removed before `onComplete` runs, so
    concurrent reports can never deliver twice. Delivery goes to the owning resource only.

Invalid reports become `error/invalid_report` deliveries, never silent successes.

## Lifecycle

| Event | Result |
| --- | --- |
| Attempt expires | Client told to cancel; owner gets `cancelled/attempt_expired`; late reports ignored. |
| Player drops | Owner gets `cancelled/logged_out`; token cleared. |
| Owner resource stops | Its attempts close without delivery; clients told to cancel. |
| cortex-minigames stops | Best-effort `cancelled/resource_stopping` to owners while stopping; nothing is promised after. Callers must fail closed on `onResourceStop('cortex-minigames')`. |
| Server `CancelAttempt` | Owner only; client told to cancel; `cancelled/server_cancelled`; idempotent. |

## Caller responsibilities

Before `StartAttempt`: eligibility, permissions, cooldown, target validity. When the interaction is
tied to an entity, validate the network id, current existence and type, proximity, routing bucket and
world state yourself. In `onComplete`: recheck everything mutable (player still online and in range,
target still valid), then commit idempotently keyed by `info.attemptId`.

cortex-minigames adds no world polling, no shared entities, no spectator state and no global
replication.

## Client-side notes

- Supplied strings render as text (Svelte text nodes), never HTML.
- QTE definitions and all parameters are data: allowlisted actions, bounded numbers and enums. No
  executable strings, event names or callbacks are ever accepted from NUI or the network.
- Seeds are not secrets or proof of legitimacy.
- Logs never include identifiers or payload bodies and are rate limited per event.
