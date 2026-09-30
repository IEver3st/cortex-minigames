-- Client examples. Every command runs inside a thread because Play/PlaySequence yield.
-- None of these results grants anything: local results are presentation only.

local minigames = exports['cortex-minigames']

local function say(text)
    TriggerEvent('chat:addMessage', { args = { 'demo', text } })
end

local function describe(result)
    return ('%s: %s / %s  score=%s grade=%s  %dms  mistakes=%d'):format(
        result.game, result.status, result.reason, tostring(result.score), tostring(result.grade), result.durationMs, result.mistakes)
end

-- 1. Quick check: a short timing check for a routine action.
RegisterCommand('demo_quick', function()
    CreateThread(function()
        local result = minigames:Play({ game = 'timing', preset = 'easy', titleKey = 'repair.breaker', instructionKey = 'repair.breaker.hint' })
        say(describe(result))
    end)
end, false)

-- 2. Signature game with custom params, context rules and the watchdog helper.
RegisterCommand('demo_signal', function()
    CreateThread(function()
        local ped = PlayerPedId()
        local result = CortexMinigamesCaller.play({
            game = 'signal_lock',
            preset = 'normal',
            title = 'Tune the receiver',
            timeoutMs = 20000,
            params = { channels = 2, dwellMs = 650 },
            presentation = { mode = 'focused' },
            -- Leaving 4 m or dying cancels; a caller check can end it on any gameplay change.
            cancel = {
                radius = { coords = GetEntityCoords(ped), maxDistance = 4.0 },
                check = function() return not IsPedInAnyVehicle(PlayerPedId(), false) end,
            },
        })
        if result.status == 'success' then
            say('Receiver tuned. ' .. describe(result))
        else
            say('Not tuned (' .. result.reason .. ').')
        end
    end)
end, false)

-- 3. QTE chain: react, alternate, then release in the zone.
RegisterCommand('demo_qte', function()
    CreateThread(function()
        local result = minigames:Play({
            game = 'qte',
            title = 'Brace the door',
            params = {
                mistakes = 1,
                leadMs = 500,
                prompts = {
                    { type = 'react', actions = { 'primary' }, windowMs = 700, minDelayMs = 700, maxDelayMs = 2000 },
                    { type = 'alternate', actions = { 'left', 'right' }, windowMs = 2600, count = 8 },
                    { type = 'release', actions = { 'primary' }, windowMs = 1000, durationMs = 1400, targetStart = 0.55, targetWidth = 0.18 },
                },
            },
        })
        say(describe(result))
    end)
end, false)

-- 4. The three example compositions. Long sequences are for meaningful tasks, not routine ones.
local COMPOSITIONS = {
    electrical = {
        title = 'Electrical repair',
        steps = {
            { id = 'identify', game = 'sequence', preset = 'normal', title = 'Identify the fault' },
            { id = 'route', game = 'circuit_route', preset = 'normal', title = 'Reroute the circuit', onFail = 'retry', retries = 1 },
            { id = 'stabilise', game = 'pressure', preset = 'normal', title = 'Stabilise the feed' },
        },
    },
    receiver = {
        steps = {
            { id = 'tune', game = 'signal_lock', preset = 'normal', title = 'Tune the receiver' },
            { id = 'match', game = 'wave_match', preset = 'normal', title = 'Match the carrier', onFail = 'continue', required = false },
            { id = 'confirm', game = 'qte', title = 'Confirm', params = { prompts = { { type = 'release', actions = { 'primary' }, windowMs = 1200, durationMs = 1400, targetStart = 0.55, targetWidth = 0.2 } } } },
        },
    },
    mechanical = {
        steps = {
            { id = 'pins', game = 'pin_tension', preset = 'normal', title = 'Set the pins' },
            { id = 'sync', game = 'pulse_sync', preset = 'normal', title = 'Sync the tumblers' },
            { id = 'bolt', game = 'timing', preset = 'normal', title = 'Throw the bolt' },
        },
    },
}

RegisterCommand('demo_sequence', function(_, args)
    local composition = COMPOSITIONS[args[1] or 'electrical']
    if not composition then return say('Use: electrical, receiver or mechanical') end
    CreateThread(function()
        local result = CortexMinigamesCaller.playSequence({ steps = composition.steps, deadlineMs = 120000 })
        say(describe(result))
        for index, step in ipairs(result.steps or {}) do
            say(('  %d. %s %s/%s attempts=%d'):format(index, step.id, step.status, step.reason, step.attempts))
        end
    end)
end, false)

-- 5. Callback form, and cancellation by the owning resource.
RegisterCommand('demo_callback', function(_, args)
    local response = minigames:Begin({ game = 'pattern_rebuild', preset = 'easy' }, function(result)
        say('callback → ' .. describe(result))
    end)
    if not response.accepted then return say('Rejected: ' .. response.result.reason) end
    say('Started ' .. response.sessionId)
    if args[1] == 'cancel' then
        SetTimeout(2500, function()
            local ok, detail = minigames:Cancel(response.sessionId, 'demo timeout')
            say(('Cancel → %s %s'):format(tostring(ok), tostring(detail or '')))
        end)
    end
end, false)

-- 6. Server-issued attempt: the server decides eligibility and what success is worth.
RegisterCommand('demo_attempt', function()
    TriggerServerEvent('cortex-minigames-demo:requestRepair')
end, false)

RegisterNetEvent('cortex-minigames-demo:notify', function(text) say(text) end)

-- Discovery: what this server supports.
RegisterCommand('demo_list', function()
    local version = minigames:GetVersion()
    say(('cortex-minigames %s (api %d)'):format(version.resource, version.api))
    for _, game in ipairs(minigames:ListGames()) do
        say(('  %s v%d [%s]'):format(game.id, game.version, table.concat(game.inputs, ', ')))
    end
end, false)
