-- Player preference command (always available) and the development command (off by default).

CortexMinigames = CortexMinigames or {}

local Prefs = CortexMinigames.Prefs
local Session = CortexMinigames.Session

local function say(message)
    TriggerEvent('chat:addMessage', { args = { 'Minigames', message } })
end

local USAGE = 'volume 0-1 | mute on/off | motion auto/reduced/full | scale 0.75-1.5 | key <action> <KeyCode> | reset'
local ACTIONS = 'up, down, left, right, primary, alt, prev, next, rotate'

local function number(value, min, max)
    local n = tonumber(value)
    return n and n == n and n >= min and n <= max and n or nil
end

--- Apply one preference change. Returns the reply: 'Saved.' only when something was stored.
local function apply(what, value, extra)
    if what == 'volume' then
        local n = number(value, 0, 1)
        if not n then return 'Volume must be a number from 0 to 1.' end
        Prefs.set({ volume = n })
    elseif what == 'mute' and (value == 'on' or value == 'off') then Prefs.set({ muted = value == 'on' })
    elseif what == 'motion' and (value == 'auto' or value == 'reduced' or value == 'full') then Prefs.set({ motion = value })
    elseif what == 'scale' then
        local n = number(value, 0.75, 1.5)
        if not n then return 'Scale must be a number from 0.75 to 1.5.' end
        Prefs.set({ scale = n })
    elseif what == 'key' then
        if not Prefs.KEY_ACTIONS[value or ''] then return ('Unknown action. Actions: %s.'):format(ACTIONS) end
        local ok, why = Prefs.checkKey(extra)
        if why == 'reserved' then return ('%s is reserved and cannot be rebound.'):format(extra) end
        if not ok then return 'Not a key code. Use names like KeyE, Digit1, Numpad4, F5, Space or ShiftLeft.' end
        local keys = {}
        for action, code in pairs(Prefs.get().keys) do keys[action] = code end
        keys[value] = extra
        Prefs.set({ keys = keys })
        if Prefs.get().keys[value] ~= extra then return 'Not saved.' end
        return 'Saved. If another action used that key, the two swap.'
    elseif what == 'reset' then Prefs.reset()
    else
        return USAGE
    end
    return 'Saved.'
end

RegisterCommand(Config.PreferenceCommand, function(_, args)
    local reply = apply(args[1], args[2], args[3])
    if reply:sub(1, 5) ~= 'Saved' then return say(reply) end
    if CortexMinigames.Cortex.isLive() then reply = reply .. ' Cortex Settings values take priority while cortex-lib runs.' end
    say(reply)
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
