-- Server-issued attempts. Only a server resource can create one. The server owns whether an
-- attempt exists and may affect gameplay; the calling resource owns what it is worth.
--
-- Flow: caller → StartAttempt → client plays locally → client reports → validation ladder →
-- atomic claim → onComplete(result, info) delivered to the owning resource only.
--
-- A client-reported success cannot prove a human solved a client-side game. These checks bind the
-- report to the right player, attempt, time window and shape; they are not anticheat.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Log = CortexMinigames.Log
local RESOURCE = GetCurrentResourceName()
local EVENT_START = 'cortex-minigames:attempt:start'
local EVENT_CANCEL = 'cortex-minigames:attempt:cancel'
local ALL_STATUSES = { success = true, failed = true, timeout = true, cancelled = true, error = true, rejected = true }

local Attempts = {}
local attempts = {}        -- id → attempt (pending/running only)
local recent = {}          -- finished id → owner, for idempotent CancelAttempt
local recentByOwner = {}   -- owner → its own finished ids, oldest first (a busy owner never evicts another's)
local recentOwners = {}    -- owners in first-seen order, bounding the total
local RECENT_PER_OWNER, RECENT_OWNERS = 256, 64
local perPlayer, perOwner, total = {}, {}, 0
local tokens, tokenCounter = {}, 0 -- per-connection identity: a reused server id never inherits
local rates = {}
local dropping = {}        -- sources whose drop is being processed: no new attempts for them
local stopping = false

math.randomseed(os.time() + GetGameTimer())

local function now() return GetGameTimer() end

local function newId()
    local parts = {}
    for i = 1, 4 do parts[i] = ('%08x'):format(math.random(0, 0x7fffffff) ~ (i == 4 and (os.time() & 0x7fffffff) or 0)) end
    local id = table.concat(parts)
    return attempts[id] and newId() or id
end

local function tokenFor(src)
    if not tokens[src] then
        tokenCounter = tokenCounter + 1
        tokens[src] = tokenCounter
    end
    return tokens[src]
end

--- Per-player event budget. Returns false when the player is over the limit.
local function allow(src)
    local t = now()
    local rate = rates[src]
    if not rate or t - rate.start >= 1000 then
        rates[src] = { start = t, count = 1 }
        return true
    end
    rate.count = rate.count + 1
    if rate.count > Config.Server.eventRate then
        Log.warn('attempt.rate_limited', { source = src })
        return false
    end
    return true
end

local function remember(a)
    local list = recentByOwner[a.owner]
    if not list then
        list = {}
        recentByOwner[a.owner] = list
        recentOwners[#recentOwners + 1] = a.owner
        if #recentOwners > RECENT_OWNERS then
            local gone = table.remove(recentOwners, 1)
            for _, id in ipairs(recentByOwner[gone]) do recent[id] = nil end
            recentByOwner[gone] = nil
        end
    end
    recent[a.id] = a.owner
    list[#list + 1] = a.id
    if #list > RECENT_PER_OWNER then recent[table.remove(list, 1)] = nil end
end

--- The only place counters go down, once per attempt, so they always match live attempts.
local function release(a)
    if not attempts[a.id] then return end
    attempts[a.id] = nil
    total = total - 1
    perPlayer[a.src] = math.max(0, (perPlayer[a.src] or 1) - 1)
    perOwner[a.owner] = math.max(0, (perOwner[a.owner] or 1) - 1)
    remember(a)
end

--- Atomically claim the attempt, then deliver to its owner. Claiming happens before any external
--- code runs, so a concurrent or duplicate report can never deliver twice.
local function deliver(a, result, silent)
    if a.state == 'claimed' or a.state == 'closed' then return false end
    a.state = silent and 'closed' or 'claimed'
    release(a)
    if silent then return true end
    result.sessionId = a.id
    result.attemptId = a.id
    local info = {
        attemptId = a.id, source = a.src, owner = a.owner, kind = a.kind, game = a.game, preset = a.preset,
        seed = a.seed, seeds = a.seeds, elapsedMs = a.startedAt and (now() - a.startedAt) or 0,
    }
    Log.info('attempt.deliver', { id = a.id, owner = a.owner, status = result.status, reason = result.reason })
    local ok, problem = pcall(a.onComplete, result, info)
    if not ok then Log.error('attempt.callback_failed', { id = a.id, owner = a.owner, error = tostring(problem) }) end
    return true
end

local function makeResult(a, status, reason)
    if a.kind == 'sequence' then return Schema.aggregateSequence(a.id, a.spec, {}, status, reason) end
    return Schema.makeResult(a.id, a.game, status, reason)
end

local function isCallable(value)
    local kind = type(value)
    return kind == 'function' or (kind == 'table' and getmetatable(value) ~= nil and getmetatable(value).__call ~= nil)
end

--- Caller-fixed step seeds by step id, or nil. Unfixed steps draw a fresh seed per attempt on the client.
local function stepSeeds(spec)
    local seeds
    for _, step in ipairs(spec.steps) do
        if step.seed then
            seeds = seeds or {}
            seeds[step.id] = step.seed
        end
    end
    return seeds
end

---------------------------------------------------------------------------------------------------
-- Exports (server only)

--- Create a privileged attempt for one player.
---@return string|false attemptId, string? reason, table? detail
function Attempts.start(owner, playerSource, rawSpec, onComplete)
    local src = tonumber(playerSource)
    if not src or src <= 0 or src ~= math.floor(src) or GetPlayerName(src) == nil or dropping[src] then return false, 'invalid_player' end
    if stopping then return false, 'capacity' end
    if not isCallable(onComplete) then return false, 'invalid_options', { field = 'onComplete', message = 'onComplete must be a function' } end
    if (perPlayer[src] or 0) >= Config.Server.maxActivePerPlayer then return false, 'busy' end
    if total >= Config.Server.maxActiveTotal or (perOwner[owner] or 0) >= Config.Server.maxActivePerOwner then return false, 'capacity' end

    local sequence = type(rawSpec) == 'table' and rawSpec.steps ~= nil
    local spec, problem
    if sequence then spec, problem = Schema.normalizeSequence(rawSpec, 'server')
    else spec, problem = Schema.normalizeOptions(rawSpec, 'server') end
    if not spec then return false, problem.reason, { field = problem.field, message = problem.message } end
    if not sequence then spec.seed = spec.seed or math.random(0, Schema.MAX_SEED) end -- recorded for diagnostics

    local id = newId()
    -- Same budget as the client's own deadline (Schema.budgetMs), plus startup and slack.
    local ttl = Schema.budgetMs(spec) + Config.Session.startupTimeoutMs + Config.Server.expirySlackMs
    local a = {
        id = id, src = src, token = tokenFor(src), owner = owner, kind = sequence and 'sequence' or 'single',
        spec = spec, game = sequence and 'sequence' or spec.game, preset = spec.preset, seed = spec.seed,
        seeds = sequence and stepSeeds(spec) or nil,
        createdAt = now(), ttl = ttl, bucket = GetPlayerRoutingBucket(src), state = 'pending', onComplete = onComplete,
    }
    attempts[id] = a
    total = total + 1
    perPlayer[src] = (perPlayer[src] or 0) + 1
    perOwner[owner] = (perOwner[owner] or 0) + 1

    -- A client that never acknowledges (UI missing, ack lost) frees the player early.
    SetTimeout(Config.Session.startupTimeoutMs + (Config.Server.ackSlackMs or 15000), function()
        if attempts[id] == a and a.state == 'pending' then
            Log.warn('attempt.ack_timeout', { id = id, source = a.src })
            TriggerClientEvent(EVENT_CANCEL, a.src, id)
            deliver(a, makeResult(a, 'error', 'ui_startup_timeout'))
        end
    end)
    SetTimeout(ttl, function()
        if attempts[id] == a and (a.state == 'pending' or a.state == 'running') then
            TriggerClientEvent(EVENT_CANCEL, a.src, id)
            deliver(a, makeResult(a, 'cancelled', 'attempt_expired'))
        end
    end)
    TriggerClientEvent(EVENT_START, src, id, Schema.toOptions(spec))
    Log.info('attempt.start', { id = id, owner = owner, game = a.game, seed = a.seed or 0 })
    return id
end

function Attempts.cancel(owner, attemptId, reason)
    if type(attemptId) ~= 'string' then return false, 'not_found' end
    local a = attempts[attemptId]
    if not a then
        if recent[attemptId] == nil then return false, 'not_found' end
        if recent[attemptId] ~= owner then return false, 'not_owner' end
        return true, 'already_finished'
    end
    if a.owner ~= owner then return false, 'not_owner' end
    Log.info('attempt.cancel', { id = a.id, reason = type(reason) == 'string' and reason:sub(1, 32) or 'none' })
    TriggerClientEvent(EVENT_CANCEL, a.src, a.id)
    deliver(a, makeResult(a, 'cancelled', 'server_cancelled'))
    return true
end

function Attempts.get(owner, attemptId)
    local a = type(attemptId) == 'string' and attempts[attemptId] or nil
    if not a or a.owner ~= owner then return nil end
    return { attemptId = a.id, state = a.state, source = a.src, game = a.game, preset = a.preset, ageMs = now() - a.createdAt, ttlMs = a.ttl }
end

---------------------------------------------------------------------------------------------------
-- Client reports. Validation ladder: source captured first → types and sizes → attempt exists →
-- same player and connection → state → expiry → routing bucket → result shape → plausibility.

local function reject(src, event, fields)
    fields = fields or {}
    fields.source = src
    Log.warn(event, fields)
end

--- Validate a sequence report against the attempt's own step list. The client's status and reason
--- are kept; score, grade, mistakes, duration and metrics are rebuilt from the steps with the same
--- rules the client uses (Schema.aggregateSequence).
local function normalizeSequenceReport(payload, a)
    local spec = a.spec
    local aggregate, problem = Schema.normalizeReport({
        status = payload.status, reason = payload.reason, score = payload.score, grade = payload.grade,
        mistakes = payload.mistakes, durationMs = payload.durationMs, metrics = {},
    }, a.id, spec.steps[1].game, Config.Bounds.maxSequenceDeadlineMs, ALL_STATUSES)
    if not aggregate then return nil, problem end
    local listed, count = Schema.isDenseArray(payload.steps or {}, #spec.steps)
    if not listed then return nil, { field = 'steps' } end
    local steps = {}
    for index = 1, count do
        local entry, step = payload.steps[index], spec.steps[index]
        if type(entry) ~= 'table' or entry.id ~= step.id or entry.game ~= step.game then return nil, { field = 'steps.id' } end
        if not Schema.isInt(entry.attempts) or entry.attempts < 1 or entry.attempts > 1 + step.retries then return nil, { field = 'steps.attempts' } end
        local stepResult, stepProblem = Schema.normalizeReport(entry, a.id, step.game, Config.Bounds.maxSequenceDeadlineMs, ALL_STATUSES)
        if not stepResult then return nil, stepProblem end
        stepResult.id, stepResult.attempts = step.id, entry.attempts
        stepResult.apiVersion, stepResult.sessionId = nil, nil
        steps[index] = stepResult
    end
    -- Success needs every step played, every required step passed, and at least one pass.
    if aggregate.status == 'success' and not Schema.sequenceCanSucceed(spec, steps) then return nil, { field = 'status' } end
    return Schema.aggregateSequence(a.id, spec, steps, aggregate.status, aggregate.reason)
end

--- Reported play time must fit in the time the server has seen since it created the attempt
--- (per step and in total). Successful runs also require their canonical minimum on the server
--- clock; duration slack applies only to reported time's upper bound, never this floor.
local function plausible(a, result, elapsed)
    local limit = elapsed + Config.Server.durationSlackMs
    if result.durationMs > limit then return false end
    local minimumElapsed = 0
    if a.kind == 'sequence' then
        for index, entry in ipairs(result.steps) do
            if entry.durationMs > limit then return false end
            if entry.status == 'success' then
                local minimum = Schema.games[a.spec.steps[index].game].minDurationMs
                if entry.durationMs < minimum then return false end
                minimumElapsed = minimumElapsed + minimum
            end
        end
    elseif result.status == 'success' then
        minimumElapsed = Schema.games[a.game].minDurationMs
        if result.durationMs < minimumElapsed then return false end
    end
    return elapsed >= minimumElapsed
end

RegisterNetEvent('cortex-minigames:attempt:ack', function(attemptId, accepted, reason)
    local src = source
    if not allow(src) then return end
    if type(attemptId) ~= 'string' or #attemptId ~= 32 or type(accepted) ~= 'boolean' then return reject(src, 'attempt.bad_ack') end
    local a = attempts[attemptId]
    if not a or a.src ~= src or a.token ~= tokens[src] then return reject(src, 'attempt.ack_wrong_player') end
    if a.state ~= 'pending' then return reject(src, 'attempt.ack_out_of_order') end
    if accepted then
        a.state = 'running'
        a.startedAt = now()
        return
    end
    local why = type(reason) == 'string' and Schema.reasons.rejected[reason] and reason or 'invalid_options'
    deliver(a, makeResult(a, 'rejected', why))
end)

RegisterNetEvent('cortex-minigames:attempt:complete', function(attemptId, payload)
    local src = source
    if not allow(src) then return end
    if type(attemptId) ~= 'string' or #attemptId ~= 32 or type(payload) ~= 'table' then return reject(src, 'attempt.malformed') end
    local a = attempts[attemptId]
    if not a then return reject(src, 'attempt.unknown_or_finished') end
    if a.src ~= src or a.token ~= tokens[src] then return reject(src, 'attempt.wrong_player') end
    if a.state ~= 'running' then return reject(src, 'attempt.finish_without_start') end
    -- Measured from creation: the client cannot start earlier, and a late-processed ack cannot
    -- shrink the window an honest result has to fit in.
    local elapsed = now() - a.createdAt
    if now() - a.createdAt > a.ttl then
        TriggerClientEvent(EVENT_CANCEL, src, a.id)
        return deliver(a, makeResult(a, 'cancelled', 'attempt_expired'))
    end
    if GetPlayerRoutingBucket(src) ~= a.bucket then
        return deliver(a, makeResult(a, 'cancelled', 'context_check'))
    end
    local result, problem
    if a.kind == 'sequence' then result, problem = normalizeSequenceReport(payload, a)
    else result, problem = Schema.normalizeReport(payload, a.id, a.game, a.spec.timeoutMs or Config.Bounds.maxTimeoutMs, ALL_STATUSES) end
    if not result then
        reject(src, 'attempt.invalid_report', { field = problem and problem.field or '?' })
        return deliver(a, makeResult(a, 'error', 'invalid_report'))
    end
    if not plausible(a, result, elapsed) then
        reject(src, 'attempt.implausible', { id = a.id })
        return deliver(a, makeResult(a, 'error', 'invalid_report'))
    end
    deliver(a, result)
end)

---------------------------------------------------------------------------------------------------
-- Lifecycle

AddEventHandler('playerJoining', function()
    local src = source
    tokens[src] = nil
    tokenFor(src)
end)

--- Live attempts matching `predicate`, copied out first: owner callbacks run during delivery and
--- may start or cancel attempts, which must never disturb the traversal.
local function snapshot(predicate)
    local list = {}
    for _, a in pairs(attempts) do
        if predicate(a) then list[#list + 1] = a end
    end
    return list
end

AddEventHandler('playerDropped', function()
    local src = source
    dropping[src] = true
    for _, a in ipairs(snapshot(function(a) return a.src == src end)) do
        deliver(a, makeResult(a, 'cancelled', 'logged_out'))
    end
    dropping[src] = nil
    tokens[src], rates[src] = nil, nil
    -- release() counted each delivered attempt down, so perPlayer already matches live attempts.
    if (perPlayer[src] or 0) == 0 then perPlayer[src] = nil end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == RESOURCE then
        -- Best effort: owners may still receive this while the runtime is stopping.
        stopping = true
        for _, a in ipairs(snapshot(function() return true end)) do
            TriggerClientEvent(EVENT_CANCEL, a.src, a.id)
            deliver(a, makeResult(a, 'cancelled', 'resource_stopping'))
        end
        return
    end
    for _, a in ipairs(snapshot(function(a) return a.owner == resource end)) do
        TriggerClientEvent(EVENT_CANCEL, a.src, a.id)
        deliver(a, nil, true) -- owner is gone: close without delivery
    end
end)

local function owner() return GetInvokingResource() or RESOURCE end

exports('StartAttempt', function(playerSource, spec, onComplete) return Attempts.start(owner(), playerSource, spec, onComplete) end)
exports('CancelAttempt', function(attemptId, reason) return Attempts.cancel(owner(), attemptId, reason) end)
exports('GetAttempt', function(attemptId) return Attempts.get(owner(), attemptId) end)
exports('GetVersion', function()
    return { resource = GetResourceMetadata(RESOURCE, 'version', 0), api = Schema.API_VERSION, protocol = Schema.PROTOCOL }
end)

CortexMinigames.Attempts = Attempts
