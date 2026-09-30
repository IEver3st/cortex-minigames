-- Client half of server-issued attempts. The server's spec is validated again with the shared
-- schema, played through the normal session runtime, and the bounded result is reported back.
-- Local resources cannot cancel these sessions: their owner is the server.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Session = CortexMinigames.Session
local OWNER = '@server'
local sessions = {} -- attemptId → session id

local function ack(attemptId, accepted, reason)
    TriggerServerEvent('cortex-minigames:attempt:ack', attemptId, accepted, reason)
end

RegisterNetEvent('cortex-minigames:attempt:start', function(attemptId, options)
    if type(attemptId) ~= 'string' or #attemptId ~= 32 or type(options) ~= 'table' then return end
    local sequence = options.steps ~= nil
    local spec, problem
    if sequence then spec, problem = Schema.normalizeSequence(options, 'server')
    else spec, problem = Schema.normalizeOptions(options, 'server') end
    if not spec then return ack(attemptId, false, problem.reason) end
    local ok, value = Session.begin(OWNER, spec, function(result)
        sessions[attemptId] = nil
        TriggerServerEvent('cortex-minigames:attempt:complete', attemptId, Schema.copyPlain(result))
    end)
    if not ok then return ack(attemptId, false, value.reason) end
    sessions[attemptId] = value.id
    ack(attemptId, true)
end)

RegisterNetEvent('cortex-minigames:attempt:cancel', function(attemptId)
    local sessionId = type(attemptId) == 'string' and sessions[attemptId] or nil
    if not sessionId then return end
    Session.cancelActive('server_cancelled', function(s) return s.id == sessionId and s.owner == OWNER end)
end)
