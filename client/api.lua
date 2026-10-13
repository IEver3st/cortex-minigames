-- Public client exports. One canonical implementation (Session.begin) behind thin wrappers.
--
-- Play / PlaySequence yield until the terminal result: call them from a thread (CreateThread,
-- a command handler or an event handler), never from a resource's main chunk.
-- If cortex-minigames stops while you are waiting, it cannot resume you. Use Begin with the
-- caller helper (@cortex-minigames/caller.lua) when you need a guaranteed fail-closed result.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Session = CortexMinigames.Session
local RESOURCE = GetCurrentResourceName()

local function invoker()
    return GetInvokingResource() or RESOURCE
end

local function rejected(options, problem, sequence)
    local game = sequence and 'sequence' or (type(options) == 'table' and type(options.game) == 'string' and options.game:sub(1, 32)) or 'unknown'
    local result = Schema.makeResult(nil, game, 'rejected', problem.reason)
    if sequence then result.steps = {} end
    result.error = { field = problem.field, message = problem.message } -- actionable detail for the developer
    return result
end

local function start(owner, options, sequence, onDone)
    local spec, problem
    if sequence then spec, problem = Schema.normalizeSequence(options, 'client')
    else spec, problem = Schema.normalizeOptions(options, 'client') end
    if not spec then return false, rejected(options, problem, sequence) end
    return Session.begin(owner, spec, onDone)
end

local function play(options, sequence)
    local owner = invoker()
    local done = promise.new()
    local ok, value = start(owner, options, sequence, function(result) done:resolve(result) end)
    if not ok then return value end
    return Citizen.Await(done)
end

---@param options table
---@return table result MinigameResult
exports('Play', function(options) return play(options, false) end)

---@param options table sequence options with `steps`
---@return table result aggregate MinigameResult with a `steps` list
exports('PlaySequence', function(options) return play(options, true) end)

--- Nonblocking. Returns { accepted = true, sessionId } or { accepted = false, result }.
--- `onComplete(result)` runs exactly once for accepted sessions.
exports('Begin', function(options, onComplete)
    local owner = invoker()
    local sequence = type(options) == 'table' and options.steps ~= nil
    local callable = type(onComplete) == 'function' or (type(onComplete) == 'table' and getmetatable(onComplete) and getmetatable(onComplete).__call)
    if not callable then
        return { accepted = false, result = rejected(options, { reason = 'invalid_options', field = 'onComplete', message = 'onComplete must be a function' }, sequence) }
    end
    local ok, value = start(owner, options, sequence, function(result) onComplete(result) end)
    if not ok then return { accepted = false, result = value } end
    return { accepted = true, sessionId = value.id }
end)

---@return boolean ok, string? detail
exports('Cancel', function(sessionId, reason)
    if type(sessionId) ~= 'string' or #sessionId > 40 then return false, 'not_found' end
    return Session.cancel(invoker(), sessionId, reason)
end)

---@return boolean busy, table? meta
exports('IsBusy', function()
    local s = Session.active()
    if not s then return false, nil end
    local owner = invoker()
    return true, {
        kind = s.kind,
        state = s.state,
        game = s.run and s.run.spec.game or nil,
        mine = s.owner == owner,
        sessionId = s.owner == owner and s.id or nil,
    }
end)

exports('ListGames', function()
    local out = {}
    for _, game in ipairs(Schema.catalog.games) do
        out[#out + 1] = {
            id = game.id, version = game.version, name = game.name, inputs = game.inputs,
            presentation = game.presentation, params = game.params, presets = game.presets, metrics = game.metrics,
        }
    end
    return out
end)

exports('GetVersion', function()
    return {
        resource = GetResourceMetadata(RESOURCE, 'version', 0),
        api = Schema.API_VERSION,
        protocol = Schema.PROTOCOL,
        rng = Schema.catalog.rngVersion,
    }
end)
