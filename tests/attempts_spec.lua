-- Server trust boundary: every rejection path from the brief's security matrix.
local H = dofile('tests/support.lua')
H.loadServer()
local A = CortexMinigames.Attempts

H.players[1] = 'alice'
H.players[2] = 'bob'
H.fire('playerJoining', 1)
H.fire('playerJoining', 2)

local function start(src, spec, owner)
    local delivered = {}
    local id, reason, detail = A.start(owner or 'heist', src, spec or { game = 'timing' }, function(result, info)
        delivered[#delivered + 1] = { result = result, info = info }
    end)
    return id, delivered, reason, detail
end

local function lastClient(name)
    for i = #H.clientEvents, 1, -1 do if H.clientEvents[i].name == name then return H.clientEvents[i] end end
end

local function ack(src, id, accepted, reason) H.fire('cortex-minigames:attempt:ack', src, id, accepted, reason) end
local function complete(src, id, payload) H.fire('cortex-minigames:attempt:complete', src, id, payload) end
local function success(fields)
    local payload = { status = 'success', reason = 'completed', score = 88, grade = 'good', mistakes = 0, durationMs = 900, metrics = { hits = 1 } }
    for k, v in pairs(fields or {}) do payload[k] = v end
    return payload
end

-- Happy path: only the target player receives the spec; the owner receives one result.
local id, delivered = start(1)
H.ok(id and #id == 32, 'attempt id issued')
local sent = lastClient('cortex-minigames:attempt:start')
H.eq(sent.target, 1, 'spec sent to that player only')
H.eq(sent.args[2].game, 'timing', 'plain options sent')
H.ok(sent.args[2].seed ~= nil, 'server records a seed')
ack(1, id, true)
H.time = H.time + 1500
complete(1, id, success())
H.eq(#delivered, 1, 'delivered once')
H.eq(delivered[1].result.status, 'success', 'success delivered')
H.eq(delivered[1].info.source, 1, 'info carries source')
H.eq(delivered[1].result.attemptId, id, 'attempt id on result')

-- Replay / duplicate completion after claim: ignored.
complete(1, id, success())
H.eq(#delivered, 1, 'replay ignored')

-- Wrong player cannot complete someone else's attempt.
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 1500
complete(2, id, success())
H.eq(#delivered, 0, 'wrong player rejected')
complete(1, id, success())
H.eq(#delivered, 1, 'right player still can')

-- Finish without start (no ack): rejected, attempt stays pending.
id, delivered = start(1)
complete(1, id, success())
H.eq(#delivered, 0, 'finish without start rejected')
A.cancel('heist', id)

-- Concurrent finalization: two reports in one turn deliver once.
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 1500
complete(1, id, success())
complete(1, id, success({ score = 99, grade = 'perfect' }))
H.eq(#delivered, 1, 'concurrent finalisation delivers once')

-- Malformed and oversize payloads.
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 1500
complete(1, 'x', success())
complete(1, id, 'not a table')
H.eq(#delivered, 0, 'malformed ignored')
complete(1, id, success({ status = 'success', reason = 'completed', grade = 'perfect', score = 10 }))
H.eq(delivered[1].result.status, 'error', 'contradictory report → error'); H.eq(delivered[1].result.reason, 'invalid_report', 'invalid_report')

-- Implausible timing: reported duration longer than server-measured time, or a success faster than the game allows.
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 200
complete(1, id, success({ durationMs = 5000 }))
H.eq(delivered[1].result.reason, 'invalid_report', 'duration beyond elapsed rejected')
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 1500
complete(1, id, success({ durationMs = 10 }))
H.eq(delivered[1].result.reason, 'invalid_report', 'impossibly fast success rejected')

-- Client-side rejection (busy) is delivered as rejected.
id, delivered = start(1)
ack(1, id, false, 'busy')
H.eq(delivered[1].result.status, 'rejected', 'client busy'); H.eq(delivered[1].result.reason, 'busy', 'busy reason')

-- Per-player cap and invalid specs never reach the client.
local ok1 = start(1)
local ok2, _, reason = start(1)
H.eq(ok2, false, 'second active attempt for same player refused'); H.eq(reason, 'busy', 'busy cap')
A.cancel('heist', ok1)
local bad, _, badReason, detail = start(1, { game = 'timing', cancel = { check = function() end } })
H.eq(bad, false, 'server cannot pass functions'); H.eq(badReason, 'invalid_options', 'invalid_options'); H.eq(detail.field, 'cancel.check', 'field reported')
bad, _, badReason = start(99)
H.eq(badReason, 'invalid_player', 'unknown player refused')

-- Expiry: an attempt that is never completed expires and tells the client to stop.
id, delivered = start(1, { game = 'timing', timeoutMs = 2000 })
ack(1, id, true)
H.tick(2000 + Config.Session.startupTimeoutMs + Config.Server.expirySlackMs + 50)
H.eq(delivered[1] and delivered[1].result.reason, 'attempt_expired', 'expiry delivered')
H.eq(lastClient('cortex-minigames:attempt:cancel').args[1], id, 'client told to cancel')
complete(1, id, success())
H.eq(#delivered, 1, 'stale result after expiry ignored')

-- Routing bucket change between start and finish.
id, delivered = start(1)
ack(1, id, true)
H.buckets[1] = 7
H.time = H.time + 1500
complete(1, id, success())
H.buckets[1] = nil
H.eq(delivered[1].result.reason, 'context_check', 'bucket change cancels')

-- Reconnect: a reused server id never inherits an old attempt.
id, delivered = start(2)
ack(2, id, true)
H.fire('playerDropped', 2)
H.eq(delivered[1].result.reason, 'logged_out', 'drop delivers cancellation')
H.fire('playerJoining', 2)
complete(2, id, success())
H.eq(#delivered, 1, 'new connection cannot finish old attempt')
local id2, delivered2 = start(2)
ack(2, id2, true)
H.time = H.time + 1500
complete(2, id2, success())
H.eq(delivered2[1].result.status, 'success', 'new connection works normally')

-- Cancel is owner-limited and idempotent.
id, delivered = start(1)
local okc, whyc = A.cancel('other', id)
H.eq(okc, false, 'other owner cannot cancel'); H.eq(whyc, 'not_owner', 'not_owner')
H.eq(A.cancel('heist', id), true, 'owner cancels')
local again, detailc = A.cancel('heist', id)
H.eq(again, true, 'idempotent'); H.eq(detailc, 'already_finished', 'already_finished')
H.eq(delivered[1].result.reason, 'server_cancelled', 'server_cancelled')
H.eq(A.get('other', id), nil, 'GetAttempt owner-limited')

-- Owner resource stops: attempts close without delivery and the client is told.
id, delivered = start(1)
H.fire('onResourceStop', nil, 'heist')
H.eq(#delivered, 0, 'stopped owner gets nothing')
H.eq(lastClient('cortex-minigames:attempt:cancel').args[1], id, 'client cancelled on owner stop')
id = start(1)
H.ok(id, 'player free again after owner stop')
A.cancel('heist', id)

-- Spam: over the per-second budget, extra reports are dropped.
id, delivered = start(1)
ack(1, id, true)
for _ = 1, 20 do complete(1, id, 'junk') end
H.time = H.time + 1500
H.eq(#delivered, 0, 'spam never delivers')
complete(1, id, success())
H.eq(#delivered, 1, 'legitimate report after the window still works')

-- Sequences: steps must match the issued spec; success needs every required step.
local seqSpec = { steps = { { game = 'timing', id = 'a' }, { game = 'pressure', id = 'b' } } }
id, delivered = start(1, seqSpec)
ack(1, id, true)
H.time = H.time + 5000
local stepOk = function(sid, game) return { id = sid, game = game, status = 'success', reason = 'completed', score = 80, grade = 'good', attempts = 1, durationMs = 1600, mistakes = 0 } end
complete(1, id, { status = 'success', reason = 'completed', score = 80, grade = 'good', mistakes = 0, durationMs = 3200, steps = { stepOk('a', 'timing'), stepOk('b', 'pressure') } })
H.eq(delivered[1].result.status, 'success', 'valid sequence accepted')
H.eq(#delivered[1].result.steps, 2, 'steps delivered')
id, delivered = start(1, seqSpec)
ack(1, id, true)
H.time = H.time + 5000
complete(1, id, { status = 'success', reason = 'completed', score = 80, grade = 'good', mistakes = 0, durationMs = 1600, steps = { stepOk('a', 'timing') } })
H.eq(delivered[1].result.reason, 'invalid_report', 'success missing a required step rejected')
id, delivered = start(1, seqSpec)
ack(1, id, true)
H.time = H.time + 5000
complete(1, id, { status = 'success', reason = 'completed', score = 80, grade = 'good', mistakes = 0, durationMs = 3200, steps = { stepOk('a', 'timing'), stepOk('b', 'circuit_route') } })
H.eq(delivered[1].result.reason, 'invalid_report', 'step game mismatch rejected')

H.done('attempts_spec')
