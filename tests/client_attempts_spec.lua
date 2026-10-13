local H = dofile('tests/support.lua')
H.loadClient()
local S = CortexMinigames.Schema
local gen = H.call('boot', {}).data.gen
local ID = string.rep('a', 32)

local function lastServer(name)
    for i = #H.serverEvents, 1, -1 do if H.serverEvents[i].name == name then return H.serverEvents[i] end end
end

-- A server attempt plays through the normal runtime and reports a bounded result.
local options = S.toOptions(S.normalizeOptions({ game = 'timing', seed = 5 }, 'server'))
H.fire('cortex-minigames:attempt:start', nil, ID, options)
local ack = lastServer('cortex-minigames:attempt:ack')
H.eq(ack.args[1], ID, 'ack id'); H.eq(ack.args[2], true, 'accepted')
local msg = H.last('open')
H.eq(msg.spec.seed, 5, 'server seed used')
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = true, timeoutMs = 6000 })
H.call('began', { protocol = 1, gen = gen, sid = msg.sid })

-- Local resources cannot cancel a server-owned session.
H.invoking = 'some-script'
local busy, meta = H.exports.IsBusy()
H.eq(busy, true, 'busy with server attempt'); H.eq(meta.mine, false, 'not owned locally')
H.invoking = nil

H.call('complete', { protocol = 1, gen = gen, sid = msg.sid, status = 'success', reason = 'completed', score = 80, grade = 'good', mistakes = 0, durationMs = 900, metrics = {} })
local done = lastServer('cortex-minigames:attempt:complete')
H.eq(done.args[1], ID, 'complete id'); H.eq(done.args[2].status, 'success', 'result reported')

-- Server cancel reaches only the matching session.
H.fire('cortex-minigames:attempt:start', nil, ID, options)
H.fire('cortex-minigames:attempt:cancel', nil, string.rep('b', 32))
H.ok(CortexMinigames.Session.active() ~= nil, 'unrelated cancel ignored')
H.fire('cortex-minigames:attempt:cancel', nil, ID)
done = lastServer('cortex-minigames:attempt:complete')
H.eq(done.args[2].reason, 'server_cancelled', 'server cancel')

-- A malformed server spec is refused with a reason, before any UI opens.
local opens = #H.sent
H.fire('cortex-minigames:attempt:start', nil, ID, { game = 'timing', params = { rounds = 50 } })
ack = lastServer('cortex-minigames:attempt:ack')
H.eq(ack.args[2], false, 'refused'); H.eq(ack.args[3], 'invalid_params', 'reason sent')
H.eq(#H.sent, opens, 'no UI opened')

-- Busy client refuses a second attempt.
H.invoking = 'local'
H.exports.Begin({ game = 'timing' }, function() end)
H.invoking = nil
H.fire('cortex-minigames:attempt:start', nil, string.rep('c', 32), options)
ack = lastServer('cortex-minigames:attempt:ack')
H.eq(ack.args[3], 'busy', 'busy refusal')
H.invoking = 'local'
H.exports.Cancel(CortexMinigames.Session.active().id)
H.invoking = nil
H.tick(10)

-- End to end: the server accepts the client's aggregate for every way a sequence can end.
dofile('server/attempts.lua')
local A = CortexMinigames.Attempts
H.players[1] = 'p1'; H.fire('playerJoining', 1)
for g in pairs(S.games) do CortexMinigames.Prefs.get().practiced[g] = true end
local cc, sc = #H.clientEvents, #H.serverEvents
local function pump()
    while cc < #H.clientEvents or sc < #H.serverEvents do
        while cc < #H.clientEvents do
            cc = cc + 1
            local e = H.clientEvents[cc]
            H.fire(e.name, nil, table.unpack(S.copyPlain(e.args), 1, 3))
        end
        while sc < #H.serverEvents do
            sc = sc + 1
            local e = H.serverEvents[sc]
            H.fire(e.name, 1, table.unpack(S.copyPlain(e.args), 1, 3))
        end
    end
end
local function uiStep(fields)
    local m = H.last('open')
    H.call('ready', { protocol = 1, gen = gen, sid = m.sid, ok = true, timeoutMs = 8000 })
    H.call('began', { protocol = 1, gen = gen, sid = m.sid })
    if not fields then return m end
    local data = { protocol = 1, gen = gen, sid = m.sid, status = 'success', reason = 'completed', score = 90, grade = 'good', mistakes = 0, durationMs = S.games[m.spec.game].minDurationMs + 200, metrics = {} }
    for k, v in pairs(fields) do data[k] = v end
    H.time = H.time + data.durationMs
    H.call('complete', data)
    H.tick(Config.Session.defaultFeedbackMs + Config.Session.stepGapMs + 20)
    return m
end
local steps = { { game = 'timing', id = 'a' }, { game = 'pressure', id = 'b' } }
local endings = {
    { 'escape', 'cancelled', 'player_cancelled', function(m) H.call('cancel', { protocol = 1, gen = gen, sid = m.sid }) end },
    { 'fault', 'error', 'ui_error', function(m) H.call('fault', { protocol = 1, gen = gen, sid = m.sid, message = 'boom' }) end },
    { 'death', 'cancelled', 'player_died', function() H.dead = true; H.tick(Config.Session.contextIntervalMs + 20); H.dead = false end },
    { 'logout', 'cancelled', 'logged_out', function() TriggerEvent('QBCore:Client:OnPlayerUnload') end },
}
for _, case in ipairs(endings) do
    local got = {}
    local attemptId = A.start('heist', 1, { steps = steps }, function(result) got[#got + 1] = result end)
    pump()
    uiStep({})
    local m = uiStep()
    case[4](m)
    pump()
    H.eq(got[1] and got[1].status, case[2], 'e2e ' .. case[1] .. ': status')
    H.eq(got[1] and got[1].reason, case[3], 'e2e ' .. case[1] .. ': reason (not invalid_report)')
    H.eq(got[1] and got[1].game, 'sequence', 'e2e ' .. case[1] .. ': aggregate')
    H.eq(got[1] and #got[1].steps, 1, 'e2e ' .. case[1] .. ': played step kept')
    H.eq(A.get('heist', attemptId), nil, 'e2e ' .. case[1] .. ': attempt closed')
    H.tick(10)
end
local got = {}
A.start('heist', 1, { steps = steps, cancel = { escape = 'fail' } }, function(result) got[#got + 1] = result end)
pump(); uiStep({}); local m = uiStep()
H.call('cancel', { protocol = 1, gen = gen, sid = m.sid }); pump()
H.eq(got[1] and got[1].reason, 'abandoned', 'e2e abandoned accepted'); H.eq(got[1] and got[1].score, 90, 'e2e abandoned keeps step score')
got = {}
A.start('heist', 1, { steps = steps }, function(result) got[#got + 1] = result end)
pump(); uiStep({}); uiStep({}); pump()
H.eq(got[1] and got[1].status, 'success', 'e2e full sequence succeeds'); H.eq(got[1] and got[1].metrics.retries, 0, 'e2e retries metric')
H.tick(10)

H.done('client_attempts_spec')
