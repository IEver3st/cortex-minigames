-- Caller-side helper with a watchdog. Load it in YOUR resource's client scripts:
--
--   client_scripts { '@cortex-minigames/caller.lua', 'client.lua' }
--
-- It wraps the nonblocking Begin export so that a result always arrives, even when
-- cortex-minigames is missing or stops mid-game (the exported Play cannot resume you once its
-- runtime is gone). Missing dependency → rejected/dependency_missing; stopped → cancelled/
-- resource_stopping. Gameplay therefore fails closed instead of waiting forever.

CortexMinigamesCaller = CortexMinigamesCaller or {}

local TARGET = 'cortex-minigames'
local waiting = {}

local function synthetic(game, status, reason)
    return {
        apiVersion = 1, sessionId = nil, game = game or 'unknown', status = status, reason = reason,
        score = nil, grade = nil, durationMs = 0, mistakes = 0, metrics = {},
        steps = game == 'sequence' and {} or nil,
    }
end

local function run(options)
    local game = type(options) == 'table' and (options.game or 'sequence') or 'unknown'
    if GetResourceState(TARGET) ~= 'started' then return synthetic(game, 'rejected', 'dependency_missing') end
    local done = promise.new()
    local entry = { promise = done, game = game }
    local ok, response = pcall(function()
        return exports[TARGET]:Begin(options, function(result)
            if waiting[entry] then
                waiting[entry] = nil
                done:resolve(result)
            end
        end)
    end)
    if not ok or type(response) ~= 'table' then return synthetic(game, 'rejected', 'dependency_missing') end
    if not response.accepted then return response.result end
    entry.sessionId = response.sessionId
    waiting[entry] = true
    return Citizen.Await(done)
end

--- Same contract as exports['cortex-minigames']:Play, with a guaranteed result.
function CortexMinigamesCaller.play(options) return run(options) end

--- Same contract as PlaySequence, with a guaranteed result.
function CortexMinigamesCaller.playSequence(options) return run(options) end

AddEventHandler('onClientResourceStop', function(resource)
    if resource ~= TARGET then return end
    for entry in pairs(waiting) do
        waiting[entry] = nil
        local result = synthetic(entry.game, 'cancelled', 'resource_stopping')
        result.sessionId = entry.sessionId
        entry.promise:resolve(result)
    end
end)
