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
H.eq(response.result.game, 'sequence', 'sequence rejection reports game sequence')

-- Every ending of a sequence returns the aggregate shape with the steps recorded so far.
for g in pairs(CortexMinigames.Schema.games) do CortexMinigames.Prefs.get().practiced[g] = true end
local two = { { game = 'timing', id = 'a' }, { game = 'pressure', id = 'b' } }
local function readyStep()
    local m = H.last('open')
    H.call('ready', { protocol = 1, gen = gen, sid = m.sid, ok = true, timeoutMs = 8000 })
    return m
end
local function intoStep2(options)
    local resp, res = begin(options or { steps = two })
    playStep('success', 'completed'); gap()
    return resp, res, readyStep()
end
local function aggregateShape(label, r, status, reason)
    H.eq(r and r.game, 'sequence', label .. ': game sequence')
    H.eq(r and r.status, status, label .. ': status'); H.eq(r and r.reason, reason, label .. ': reason')
    H.eq(r and r.steps and #r.steps, 1, label .. ': steps so far'); H.eq(r and r.steps and r.steps[1].id, 'a', label .. ': step id')
    H.eq(r and r.metrics.steps, 2, label .. ': metrics.steps'); H.eq(r and r.metrics.completed, 1, label .. ': metrics.completed')
    H.eq(r and r.durationMs, 1000, label .. ': aggregate duration')
    H.eq(H.focus.focused, false, label .. ': focus released')
end
local endings = {
    { 'escape', 'cancelled', 'player_cancelled', function(m) H.call('began', { protocol = 1, gen = gen, sid = m.sid }); H.call('cancel', { protocol = 1, gen = gen, sid = m.sid }) end },
    { 'context', 'cancelled', 'player_died', function() H.dead = true; H.tick(Config.Session.contextIntervalMs + 20); H.dead = false end },
    { 'logout', 'cancelled', 'logged_out', function() TriggerEvent('qbx_core:client:playerLoggedOut') end },
    { 'caller stop', 'cancelled', 'caller_stopped', function() TriggerEvent('onClientResourceStop', 'caller') end },
    { 'UI reboot', 'error', 'ui_error', function() H.call('boot', {}) end },
    { 'UI fault', 'error', 'ui_error', function(m) H.call('fault', { protocol = 1, gen = gen, sid = m.sid, message = 'boom' }) end },
    { 'stall before start', 'error', 'ui_startup_timeout', function() H.tick(CortexMinigames.Schema.READY_MS + 50) end },
}
for _, case in ipairs(endings) do
    local _, res, m = intoStep2()
    case[4](m)
    aggregateShape(case[1], res[1], case[2], case[3])
end
local resp, res = intoStep2()
H.invoking = 'caller'; H.exports.Cancel(resp.sessionId); H.invoking = nil
aggregateShape('caller cancel', res[1], 'cancelled', 'caller_cancelled')
_, res = intoStep2({ steps = two, cancel = { escape = 'fail' } })
local m2 = H.last('open'); H.call('began', { protocol = 1, gen = gen, sid = m2.sid }); H.call('cancel', { protocol = 1, gen = gen, sid = m2.sid })
aggregateShape('escape as failure', res[1], 'failed', 'abandoned')
H.eq(res[1].score, 90, 'abandoned sequence keeps the played score')
CortexMinigames.Prefs.get().practiced.pressure = nil
_, res = intoStep2()
H.tick(Config.Session.practiceTimeoutMs + CortexMinigames.Schema.PRACTICE_GRACE_MS + 50)
aggregateShape('practice idle', res[1], 'cancelled', 'practice_idle')
_, res = intoStep2()
TriggerEvent('onResourceStop', 'cortex-minigames')
aggregateShape('resource stop', res[1], 'cancelled', 'resource_stopping')
for g in pairs(CortexMinigames.Schema.games) do CortexMinigames.Prefs.get().practiced[g] = true end

-- A step the UI refuses ends the sequence with the UI's rule code in error.
resp, res = begin({ steps = two })
playStep('success', 'completed'); gap()
H.call('ready', { protocol = 1, gen = gen, sid = H.last('open').sid, ok = false, reason = 'invalid_params', field = 'params', message = 'time_budget_too_short' })
H.eq(res[1].game, 'sequence', 'refused step: aggregate'); H.eq(res[1].error and res[1].error.message, 'time_budget_too_short', 'refused step: rule code kept')

-- Busy and focus rejections of a sequence report game 'sequence'.
resp = begin({ steps = two })
local busy = begin({ steps = two })
H.eq(busy.result.reason, 'busy', 'second sequence busy'); H.eq(busy.result.game, 'sequence', 'busy sequence reports sequence')
H.eq(busy.result.steps and #busy.result.steps, 0, 'busy sequence has an empty steps list')
H.invoking = 'caller'; H.exports.Cancel(resp.sessionId); H.invoking = nil
H.foreignFocus = true
local blocked = begin({ steps = two })
H.foreignFocus = false
H.eq(blocked.result.reason, 'focus_unavailable', 'foreign focus'); H.eq(blocked.result.game, 'sequence', 'focus rejection reports sequence')

-- The cursor follows each step's own needs.
resp = begin({ steps = { { game = 'timing' }, { game = 'trace' }, { game = 'mash' } } })
local s1 = readyStep(); H.eq(H.focus.cursor, false, 'compact keyboard step hides the cursor')
H.call('began', { protocol = 1, gen = gen, sid = s1.sid })
H.call('complete', { protocol = 1, gen = gen, sid = s1.sid, status = 'success', reason = 'completed', score = 90, grade = 'good', mistakes = 0, durationMs = 1000, metrics = {} })
gap(); readyStep(); H.eq(H.focus.cursor, true, 'pointer step shows the cursor')
H.invoking = 'caller'; H.exports.Cancel(resp.sessionId); H.invoking = nil

-- The overall deadline is the shared budget (Schema.budgetMs), which the server's expiry also uses.
local custom = { steps = { { game = 'timing', params = { rounds = 5, cyclesPerSec = 0.2 } } } }
resp = begin(custom)
local s = CortexMinigames.Session.active()
H.eq(s.deadlineAt - H.time, CortexMinigames.Schema.budgetMs(s.spec), 'deadline from shared budget')
H.ok(s.deadlineAt - H.time >= 60000, 'custom params leave room for a param-derived timeout')
H.invoking = 'caller'; H.exports.Cancel(resp.sessionId); H.invoking = nil

-- All-optional steps that all fail cannot make the sequence a success.
resp, res = begin({ steps = { { game = 'timing', required = false, onFail = 'continue' }, { game = 'timing', required = false, onFail = 'continue' } } })
playStep('failed', 'missed'); gap()
playStep('failed', 'missed')
H.eq(res[1].status, 'failed', 'no passed step fails'); H.eq(res[1].reason, 'step_failed', 'step_failed')
H.tick(10)

H.eq(H.threadCount(), 0, 'no loop left')
H.done('sequence_spec')
