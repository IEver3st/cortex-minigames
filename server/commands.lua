-- Development command for server-issued attempts. Registered only when the dev convar is set,
-- and restricted to the console or the `cortex-minigames.dev` ace. No reward is attached.

if GetConvarInt(Config.DevConvar, 0) ~= 1 then return end

RegisterCommand('minigame_attempt', function(src, args)
    if src ~= 0 and not IsPlayerAceAllowed(src, 'cortex-minigames.dev') then return end
    local target = tonumber(args[1]) or src
    local id, reason, detail = CortexMinigames.Attempts.start(GetCurrentResourceName(), target, {
        game = args[2] or 'timing', preset = args[3] or 'normal',
    }, function(result, info)
        print(('[cortex-minigames] attempt %s → %s / %s score=%s elapsed=%dms'):format(
            info.attemptId, result.status, result.reason, tostring(result.score), info.elapsedMs))
    end)
    if not id then print(('[cortex-minigames] attempt rejected: %s %s'):format(reason, detail and detail.message or '')) end
end, false)
