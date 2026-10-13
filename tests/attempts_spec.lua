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
H.tick(A.get('heist', id).ttlMs + 50)
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

local S = CortexMinigames.Schema
local function upvalue(name)
    for i = 1, 60 do
        local n, v = debug.getupvalue(A.start, i)
        if not n then return nil end
        if n == name then return v end
    end
end
local function minFor(game) return S.games[game].minDurationMs end

-- The server clock must cover successful gameplay even when the claimed duration fits its slack.
local function reportAtElapsed(spec, payload, elapsed)
    H.time = H.time + 1000 -- keep each scenario outside the prior event-rate window
    local attemptId, results = start(1, spec)
    H.ok(attemptId, 'clock scenario starts')
    ack(1, attemptId, true)
    H.time = H.time + elapsed
    complete(1, attemptId, payload)
    H.eq(#results, 1, 'clock scenario delivers exactly once')
    return results[1].result
end

for _, game in ipairs({ 'timing', 'pressure', 'circuit_route' }) do
    local minimum = minFor(game)
    for _, elapsed in ipairs({ 0, minimum - 1 }) do
        local result = reportAtElapsed({ game = game }, success({ durationMs = minimum }), elapsed)
        H.eq(result.status, 'error', game .. ': server clock below minimum rejects success')
        H.eq(result.reason, 'invalid_report', game .. ': early success is invalid_report')
    end
    local result = reportAtElapsed({ game = game }, success({ durationMs = minimum }), minimum)
    H.eq(result.status, 'success', game .. ': exact server minimum accepted')
    H.eq(result.durationMs, minimum, game .. ': reported minimum preserved')
end
local fastAssay = reportAtElapsed({ game = 'timing' }, success({ durationMs = 573 }), 1223)
H.eq(fastAssay.status, 'success', 'normal short Mining assay accepted')

for _, terminal in ipairs({
    { status = 'failed', reason = 'missed', grade = 'fail' },
    { status = 'timeout', reason = 'time_expired', grade = 'fail' },
    { status = 'cancelled', reason = 'player_cancelled' },
    { status = 'error', reason = 'invalid_report' },
}) do
    terminal.durationMs = 0
    local result = reportAtElapsed({ game = 'timing' }, terminal, 0)
    H.eq(result.status, terminal.status, 'immediate ' .. terminal.status .. ' remains accepted')
    H.eq(result.reason, terminal.reason, 'immediate terminal reason preserved')
end

local shortSequence = { steps = { { game = 'timing', id = 'a' }, { game = 'mash', id = 'b' } } }
local function clockStep(sid, game, fields)
    local entry = success({ id = sid, game = game, durationMs = minFor(game), attempts = 1 })
    for k, v in pairs(fields or {}) do entry[k] = v end
    return entry
end
local function clockSequence(fields)
    local payload = success({ durationMs = 0, steps = { clockStep('a', 'timing'), clockStep('b', 'mash') } })
    for k, v in pairs(fields or {}) do payload[k] = v end
    return payload
end
local sequenceMinimum = minFor('timing') + minFor('mash')
for _, elapsed in ipairs({ 0, sequenceMinimum - 1 }) do
    local result = reportAtElapsed(shortSequence, clockSequence(), elapsed)
    H.eq(result.reason, 'invalid_report', 'composed successes require the sum of their server minima')
end
local exactSequence = reportAtElapsed(shortSequence, clockSequence(), sequenceMinimum)
H.eq(exactSequence.status, 'success', 'composed exact server minimum accepted')
H.eq(exactSequence.durationMs, sequenceMinimum, 'composed duration rebuilt at minimum')

-- A cancelled sequence may contain prior successes, which still need enough server time.
for _, elapsed in ipairs({ 0, minFor('timing') - 1, minFor('timing') }) do
    local result = reportAtElapsed(shortSequence, clockSequence({
        status = 'cancelled', reason = 'player_cancelled', steps = { clockStep('a', 'timing') },
    }), elapsed)
    H.eq(result.status, elapsed < minFor('timing') and 'error' or 'cancelled', 'cancelled sequence checks completed successes')
end
local noSteps = reportAtElapsed(shortSequence, clockSequence({ status = 'cancelled', reason = 'player_cancelled', steps = {} }), 0)
H.eq(noSteps.status, 'cancelled', 'instant sequence cancellation before play accepted')

local optionalFailure = { steps = { { game = 'timing', id = 'a', onFail = 'retry', retries = 2 }, { game = 'pressure', id = 'b', required = false, onFail = 'continue' } } }
local mixedPayload = clockSequence({ steps = {
    clockStep('a', 'timing', { attempts = 3 }),
    clockStep('b', 'pressure', { status = 'failed', reason = 'overstressed', grade = 'fail', durationMs = 0 }),
} })
local mixedResult = reportAtElapsed(optionalFailure, mixedPayload, minFor('timing'))
H.eq(mixedResult.status, 'success', 'failed optional steps and retries add no unproven success minimum')
local requiredFailure = { steps = { { game = 'timing', id = 'a' }, { game = 'pressure', id = 'b' } } }
mixedPayload.status, mixedPayload.reason, mixedPayload.grade = 'failed', 'overstressed', 'fail'
mixedPayload.steps[1].attempts = 1
for _, elapsed in ipairs({ minFor('timing') - 1, minFor('timing') }) do
    local result = reportAtElapsed(requiredFailure, mixedPayload, elapsed)
    H.eq(result.status, elapsed < minFor('timing') and 'error' or 'failed', 'failed sequence checks prior successes only')
end

-- Plausibility is measured from creation: an ack the server processes late cannot fail an honest result.
id, delivered = start(1)
H.time = H.time + 3000
ack(1, id, true)
complete(1, id, success({ durationMs = 2000 }))
H.eq(delivered[1].result.status, 'success', 'late-processed ack keeps an honest result')

-- Cancelled / error reports never keep the client's score.
id, delivered = start(1)
ack(1, id, true)
H.time = H.time + 1000
complete(1, id, { status = 'cancelled', reason = 'player_cancelled', score = 100, grade = 'perfect', mistakes = 0, durationMs = 500 })
H.eq(delivered[1].result.status, 'cancelled', 'cancel delivered'); H.eq(delivered[1].result.score, nil, 'cancel score dropped')

-- Sequences: numbers are rebuilt from the steps; steps must fit the server's clock.
local function step(sid, game, fields)
    local e = { id = sid, game = game, status = 'success', reason = 'completed', score = 60, grade = 'pass', attempts = 1, durationMs = minFor(game) + 100, mistakes = 2, metrics = {} }
    for k, v in pairs(fields or {}) do e[k] = v end
    return e
end
id, delivered = start(1, { steps = { { game = 'timing', id = 'a', onFail = 'retry', retries = 2 }, { game = 'pressure', id = 'b', required = false, onFail = 'continue' }, { game = 'timing', id = 'c', seed = 77 } } })
ack(1, id, true)
H.time = H.time + 20000
complete(1, id, { status = 'success', reason = 'completed', score = 100, grade = 'perfect', mistakes = 0, durationMs = 0, steps = {
    step('a', 'timing', { attempts = 2, score = 80, grade = 'good' }),
    step('b', 'pressure', { status = 'failed', reason = 'overstressed', grade = 'fail' }),
    step('c', 'timing', { score = 91, grade = 'good', mistakes = 0 }),
} })
local r = delivered[1].result
H.eq(r.status, 'success', 'optional failure tolerated server-side')
H.eq(r.score, 86, 'aggregate score rebuilt from steps'); H.eq(r.grade, 'good', 'aggregate grade rebuilt')
H.eq(r.mistakes, 4, 'aggregate mistakes rebuilt')
H.eq(r.durationMs, minFor('timing') * 2 + minFor('pressure') + 300, 'aggregate duration rebuilt')
H.eq(r.metrics.retries, 1, 'retries metric'); H.eq(r.metrics.failedRequired, 0, 'failedRequired metric'); H.eq(r.metrics.completed, 2, 'completed metric')
H.eq(delivered[1].info.seed, nil, 'no single seed for sequences'); H.eq(delivered[1].info.seeds and delivered[1].info.seeds.c, 77, 'fixed step seed listed')
id, delivered = start(1, { steps = { { game = 'timing', id = 'a' } } })
ack(1, id, true)
H.time = H.time + 1000
complete(1, id, { status = 'success', reason = 'completed', grade = 'pass', durationMs = 10, steps = { step('a', 'timing', { durationMs = 99999 }) } })
H.eq(delivered[1].result.reason, 'invalid_report', 'step longer than server elapsed rejected')
id, delivered = start(1, { steps = { { game = 'pin_tension', required = false }, { game = 'pressure', required = false } } })
ack(1, id, true)
H.time = H.time + 1000
complete(1, id, { status = 'success', reason = 'completed', grade = 'pass', durationMs = 0, steps = {} })
H.eq(delivered[1].result.reason, 'invalid_report', 'all-optional success with nothing played rejected')
id, delivered = start(1, { steps = { { game = 'timing', id = 'a' }, { game = 'pressure', id = 'b' } } })
ack(1, id, true)
H.time = H.time + 5000
complete(1, id, { status = 'cancelled', reason = 'player_cancelled', durationMs = minFor('timing') + 100, mistakes = 2, steps = { step('a', 'timing') } })
r = delivered[1].result
H.eq(r.status, 'cancelled', 'mid-sequence escape accepted'); H.eq(r.game, 'sequence', 'aggregate game'); H.eq(#r.steps, 1, 'played steps kept')
H.eq(r.score, nil, 'cancelled sequence has no score'); H.eq(r.metrics.steps, 2, 'metrics.steps')

-- Expiry uses the shared budget, which already counts feedback and step gaps.
local seq8 = { feedbackMs = 1500, practice = 'never', steps = {} }
for i = 1, 3 do seq8.steps[i] = { game = 'timing', onFail = 'retry', retries = 1 } end
id = start(1, seq8)
H.eq(A.get('heist', id).ttlMs, S.budgetMs(S.normalizeSequence(seq8, 'server')) + Config.Session.startupTimeoutMs + Config.Server.expirySlackMs, 'ttl = shared budget + startup + slack')
A.cancel('heist', id)

-- An attempt that is never acknowledged frees the player after the ack window.
id, delivered = start(1)
H.tick(Config.Session.startupTimeoutMs + (Config.Server.ackSlackMs or 15000) + 50)
H.eq(delivered[1] and delivered[1].result.status, 'error', 'unacked attempt ends'); H.eq(delivered[1] and delivered[1].result.reason, 'ui_startup_timeout', 'ui_startup_timeout')
H.eq(lastClient('cortex-minigames:attempt:cancel').args[1], id, 'client told to stop')
H.ok(start(1), 'player free after ack timeout')
A.cancel('heist', lastClient('cortex-minigames:attempt:start').args[1])

-- Drop and stop deliver outside the attempt table traversal; counters always match live attempts.
for i = 10, 30 do H.players[i] = 'p' .. i; H.fire('playerJoining', i) end
for i = 21, 30 do start(i, nil, 'background') end
local handed, retried
id = A.start('heist', 10, { game = 'timing' }, function(result)
    handed = A.start('heist', 11, { game = 'timing' }, function() end)
    retried = A.start('heist', 10, { game = 'timing' }, function() end)
end)
local okDrop, problem = pcall(H.fire, 'playerDropped', 10)
H.eq(okDrop, true, 'drop survives a callback that starts attempts ' .. tostring(problem or ''))
H.ok(handed, 'handoff to another player works during a drop')
H.eq(retried, false, 'no new attempt for the dropping player')
H.eq(upvalue('perPlayer')[10], nil, 'dropped player has no live count')
H.eq(upvalue('perPlayer')[11], 1, 'handoff counted')
A.cancel('heist', handed)
H.fire('playerJoining', 10)
H.ok(start(10), 'reconnected player can start')
local okStop = pcall(H.fire, 'onResourceStop', nil, 'background')
H.eq(okStop, true, 'owner stop survives')
H.eq(upvalue('perOwner').background, 0, 'owner count back to zero')

-- CancelAttempt stays idempotent for an owner while other owners churn.
local mine = start(12, nil, 'quiet')
A.cancel('quiet', mine)
for _ = 1, 300 do A.cancel('busy', (start(13, nil, 'busy'))) end
local okc2, detail2 = A.cancel('quiet', mine)
H.eq(okc2, true, 'quiet owner still idempotent'); H.eq(detail2, 'already_finished', 'already_finished after churn')

-- Self stop: a callback that starts attempts cannot break the stop or leave work behind.
A.start('heist', 14, { game = 'timing' }, function() A.start('heist', 15, { game = 'timing' }, function() end) end)
local okSelf, selfProblem = pcall(H.fire, 'onResourceStop', nil, 'cortex-minigames')
H.eq(okSelf, true, 'self stop survives ' .. tostring(selfProblem or ''))
H.eq(upvalue('total'), 0, 'nothing alive after self stop')

H.done('attempts_spec')
