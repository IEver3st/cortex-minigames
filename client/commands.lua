-- Player preference command (always available) and the development command (off by default).

CortexMinigames = CortexMinigames or {}

local Prefs = CortexMinigames.Prefs
local Session = CortexMinigames.Session

local function say(message)
    TriggerEvent('chat:addMessage', { args = { 'Minigames', message } })
end

local USAGE = 'volume 0-1 | mute on/off | motion auto/reduced/full | scale 0.75-1.5 | key <action> <KeyCode> | reset'

RegisterCommand(Config.PreferenceCommand, function(_, args)
    local what, value, extra = args[1], args[2], args[3]
    if what == 'volume' and tonumber(value) then Prefs.set({ volume = tonumber(value) })
    elseif what == 'mute' and (value == 'on' or value == 'off') then Prefs.set({ muted = value == 'on' })
    elseif what == 'motion' and (value == 'auto' or value == 'reduced' or value == 'full') then Prefs.set({ motion = value })
    elseif what == 'scale' and tonumber(value) then Prefs.set({ scale = tonumber(value) })
    elseif what == 'key' and Prefs.KEY_ACTIONS[value or ''] and type(extra) == 'string' and extra:match('^%w+$') then
        local keys = Prefs.get().keys
        keys[value] = extra
        Prefs.set({ keys = keys })
    elseif what == 'reset' then Prefs.reset()
    else
        return say(USAGE)
    end
    if CortexMinigames.Cortex.isLive() then say('Saved. Cortex Settings values take priority while cortex-lib runs.') else say('Saved.') end
    Session.pushPrefs()
end, false)

-- Development: `/minigame <game> [preset]` plays a local, rewardless game. Requires the server to
-- set `setr cortex_minigames_dev 1`; never enable it on a production server.
if GetConvarInt(Config.DevConvar, 0) == 1 then
    RegisterCommand('minigame', function(_, args)
        CreateThread(function()
            local result = exports[GetCurrentResourceName()]:Play({ game = args[1] or 'timing', preset = args[2] or 'normal', practice = 'always' })
            say(('%s → %s / %s score=%s'):format(result.game, result.status, result.reason, tostring(result.score)))
        end)
    end, false)
end
