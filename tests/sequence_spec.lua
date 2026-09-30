local H = dofile('tests/support.lua')
H.loadClient()

local gen = H.call('boot', {}).data.gen

local function begin(options)
    H.invoking = 'caller'
    local results = {}
    local response = H.exports.Begin(options, function(result) results[#results + 1] = result end)
    H.invoking = nil
    return response, results
end

local function playStep(status, reason, fields)
    local msg = H.last('open')
    H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = true, timeoutMs = 8000 })
    H.call('began', { protocol = 1, gen = gen, sid = msg.sid })
    local data = { protocol = 1, gen = gen, sid = msg.sid, status = status, reason = reason, mistakes = 0, durationMs = 1000, metrics = {} }
    if status == 'success' then data.score, data.grade = 90, 'good' else data.score, data.grade = 20, 'fail' end
    for k, v in pairs(fields or {}) do data[k] = v end
    H.eq(H.call('complete', data).ok, true, 'step report accepted')
    return msg
end

local function gap() H.tick(Config.Session.defaultFeedbackMs + Config.Session.stepGapMs + 20) end

local three = { { game = 'sequence', id = 'identify' }, { game = 'circuit_route', id = 'route' }, { game = 'pressure', id = 'stabilise' } }

-- All steps succeed → success, focus held across steps, released once at the end.
local response, results = begin({ steps = three })
H.eq(response.accepted, true, 'sequence accepted')
local first = playStep('success', 'completed')
H.eq(first.spec.step.index, 1, 'step index sent'); H.eq(first.spec.step.total, 3, 'step total sent')
H.eq(H.focus.focused, true, 'focus held between steps')
gap(); playStep('success', 'completed')
gap(); playStep('success', 'completed')
H.eq(#results, 1, 'one aggregate result')
local r = results[1]
H.eq(r.status, 'success', 'aggregate success'); H.eq(r.game, 'sequence', 'aggregate game')
H.eq(#r.steps, 3, 'per-step results'); H.eq(r.steps[2].id, 'route', 'step ids kept')
H.eq(r.score, 90, 'aggregate score'); H.eq(r.metrics.completed, 3, 'completed count')
H.eq(r.durationMs, 3000, 'durations summed')
H.eq(H.focus.focused, false, 'focus released at end')

-- stop (default): the first failure ends the sequence.
response, results = begin({ steps = three })
playStep('success', 'completed'); gap()
playStep('failed', 'tests_exhausted')
H.eq(results[1].status, 'failed', 'stop fails'); H.eq(results[1].reason, 'step_failed', 'step_failed')
H.eq(#results[1].steps, 2, 'unplayed steps absent')

-- continue on a required step: remaining steps run, aggregate success is impossible.
response, results = begin({ steps = { { game = 'timing', onFail = 'continue' }, { game = 'timing' } } })
playStep('failed', 'missed'); gap()
playStep('success', 'completed')
H.eq(results[1].status, 'failed', 'required continue cannot succeed')
H.eq(results[1].metrics.failedRequired, 1, 'failed required counted')

-- continue on an optional step: aggregate can still succeed.
response, results = begin({ steps = { { game = 'timing', onFail = 'continue', required = false }, { game = 'timing' } } })
playStep('failed', 'missed'); gap()
playStep('success', 'completed')
H.eq(results[1].status, 'success', 'optional failure tolerated')

-- retry: bounded reruns with fresh seeds, then stop.
response, results = begin({ steps = { { game = 'timing', onFail = 'retry', retries = 2 } } })
local a = playStep('failed', 'missed'); gap()
local b = playStep('failed', 'missed'); gap()
H.ok(a.spec.seed ~= b.spec.seed, 'retry uses a fresh seed')
playStep('failed', 'missed')
H.eq(results[1].status, 'failed', 'exhausted retries fail')
H.eq(results[1].steps[1].attempts, 3, 'attempts counted')
H.eq(results[1].metrics.retries, 2, 'retries counted')
response, results = begin({ steps = { { game = 'timing', onFail = 'retry', retries = 1 } } })
playStep('failed', 'missed'); gap()
playStep('success', 'completed')
H.eq(results[1].status, 'success', 'retry can recover')

-- A step timeout counts as a player failure for the policy.
response, results = begin({ steps = { { game = 'timing', onFail = 'continue', required = false }, { game = 'timing' } } })
local msg = H.last('open')
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = true, timeoutMs = 2000 })
H.call('began', { protocol = 1, gen = gen, sid = msg.sid })
H.tick(2000 + Config.Session.hardGraceMs + 20)
H.eq(#results, 0, 'step timeout continues')
gap(); playStep('success', 'completed')
H.eq(results[1].status, 'success', 'sequence completes after timed-out optional step')
H.eq(results[1].steps[1].reason, 'hard_deadline', 'step timeout recorded')

-- Cancel between steps ends everything.
response, results = begin({ steps = three })
playStep('success', 'completed')
H.invoking = 'caller'
H.exports.Cancel(response.sessionId)
H.invoking = nil
gap()
H.eq(results[1].status, 'cancelled', 'cancel between steps')
H.eq(#results, 1, 'no further step after cancel')
H.eq(H.last('open').sid ~= nil, true, 'no reopen')

-- Overall deadline beats step deadlines.
response, results = begin({ steps = three, deadlineMs = 3000 })
msg = H.last('open')
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = true, timeoutMs = 8000 })
H.call('began', { protocol = 1, gen = gen, sid = msg.sid })
H.tick(3100)
H.eq(results[1].status, 'timeout', 'sequence deadline'); H.eq(results[1].reason, 'sequence_deadline', 'sequence_deadline')

-- An error inside a step ends the sequence with that error.
response, results = begin({ steps = three })
H.tick(Config.Session.startupTimeoutMs + 50)
H.eq(results[1].status, 'error', 'step error aborts'); H.eq(results[1].reason, 'ui_startup_timeout', 'error reason kept')

-- PlaySequence rejects malformed compositions synchronously.
response = begin({ steps = {} })
H.eq(response.result.reason, 'invalid_sequence', 'empty sequence rejected')

H.eq(H.threadCount(), 0, 'no loop left')
H.done('sequence_spec')
