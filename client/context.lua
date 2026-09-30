-- World-context rules checked while a session is active (every Config.Session.contextIntervalMs).
-- The caller still owns gameplay validation; these rules only end an interaction whose context
-- is gone. Returns a cancellation reason, or nil to continue.

CortexMinigames = CortexMinigames or {}

local Context = {}

local function distanceTo(ped, x, y, z)
    local coords = GetEntityCoords(ped)
    local dx, dy, dz = coords.x - x, coords.y - y, coords.z - z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

---@param rules table normalised cancel rules from Schema
function Context.check(rules)
    local ped = PlayerPedId()
    if rules.death ~= false and (IsEntityDead(ped) or IsPedFatallyInjured(ped)) then return 'player_died' end
    if IsPauseMenuActive() then return 'context_check' end
    local radius = rules.radius
    if radius and distanceTo(ped, radius.x, radius.y, radius.z) > radius.maxDistance then return 'left_area' end
    if rules.entity then
        if not DoesEntityExist(rules.entity) then return 'target_lost' end
        if rules.maxDistance then
            local coords = GetEntityCoords(rules.entity)
            if distanceTo(ped, coords.x, coords.y, coords.z) > rules.maxDistance then return 'left_area' end
        end
    end
    if rules.check then
        local ok, keep = pcall(rules.check)
        if not ok or keep == false then return 'context_check' end
    end
    return nil
end

CortexMinigames.Context = Context
