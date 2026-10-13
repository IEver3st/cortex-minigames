-- Server-issued attempt with caller revalidation, idempotent commit and a fail-closed watchdog.
-- Qbox is used only when qbx_core is running; the minigame itself needs no framework.

local REWARD_ENABLED = false -- the demo never pays unless you opt in
local REWARD = 150
local COOLDOWN_MS = 60000
local BREAKER = vector3(-47.3, -1757.6, 29.4) -- example location; move it to your own job site
local MAX_DISTANCE = 6.0

local cooldowns = {}
local pending = {}   -- attemptId → { source }
local committed = {} -- attemptId → true (idempotency)

local function notify(src, text) TriggerClientEvent('cortex-minigames-demo:notify', src, text) end

local function nearBreaker(src)
    local ped = GetPlayerPed(src)
    if ped == 0 then return false end
    return #(GetEntityCoords(ped) - BREAKER) <= MAX_DISTANCE
end

RegisterNetEvent('cortex-minigames-demo:requestRepair', function()
    local src = source -- capture before any yield
    local now = GetGameTimer()
    if cooldowns[src] and now - cooldowns[src] < COOLDOWN_MS then return notify(src, 'Breaker is cooling down.') end
    if not nearBreaker(src) then return notify(src, 'Stand at the breaker first.') end

    local attemptId, reason, detail = exports['cortex-minigames']:StartAttempt(src, {
        game = 'timing',
        preset = 'normal',
        titleKey = 'repair.breaker',
        cancel = { radius = { coords = BREAKER, maxDistance = MAX_DISTANCE } },
    }, function(result, info)
        if not pending[info.attemptId] then return end -- the watchdog below already closed it
        pending[info.attemptId] = nil
        -- The result only says the attempt finished this way. Recheck everything mutable now.
        if result.status ~= 'success' then return notify(info.source, 'Repair failed: ' .. result.reason) end
        if GetPlayerName(info.source) == nil or not nearBreaker(info.source) then return end
        if committed[info.attemptId] then return end
        committed[info.attemptId] = true
        cooldowns[info.source] = GetGameTimer()
        if REWARD_ENABLED and GetResourceState('qbx_core') == 'started' then
            -- Fixed server-side amount; the client score never decides money.
            exports.qbx_core:AddMoney(info.source, 'cash', REWARD, 'breaker-repair:' .. info.attemptId)
        end
        notify(info.source, ('Breaker repaired (score %s).'):format(tostring(result.score)))
    end)

    if not attemptId then
        return notify(src, ('Cannot start: %s %s'):format(reason, detail and detail.message or ''))
    end
    pending[attemptId] = { source = src }
end)

-- Watchdog: if cortex-minigames stops, its own `cancelled/resource_stopping` delivery is best
-- effort and may run before or after this handler. Fail closed here; whichever runs second is ignored.
AddEventHandler('onResourceStop', function(resource)
    if resource ~= 'cortex-minigames' then return end
    for attemptId, entry in pairs(pending) do
        pending[attemptId] = nil
        notify(entry.source, 'Repair interrupted.')
    end
end)

AddEventHandler('playerDropped', function()
    cooldowns[source] = nil
end)
