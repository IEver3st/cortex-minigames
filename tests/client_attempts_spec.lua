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

H.done('client_attempts_spec')
