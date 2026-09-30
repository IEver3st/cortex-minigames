-- Shared validation for client exports and server attempts. Rules come from shared/catalog.json,
-- which is generated from the UI's TypeScript registry, so Lua and the UI enforce one schema.
-- Cross-field contradictions (impossible budgets, targets below input precision) are checked by
-- the UI during the ready handshake, still before any focus is taken.

CortexMinigames = CortexMinigames or {}

local Schema = {}
Schema.API_VERSION = 1
Schema.PROTOCOL = 1
Schema.MAX_SEED = 2147483647

local STATUSES = { success = true, failed = true, cancelled = true, timeout = true, error = true, rejected = true }
local MODES = { auto = true, keyboard = true, mouse = true, controller = true }
local PRACTICE = { auto = true, always = true, never = true }
local MOTION = { inherit = true, reduced = true, full = true }
local ON_FAIL = { stop = true, continue = true, retry = true }
local GRADES = { perfect = true, good = true, pass = true }

local function loadCatalog()
    local raw = LoadResourceFile(GetCurrentResourceName(), 'shared/catalog.json')
    local ok, decoded = pcall(json.decode, raw or '')
    if not ok or type(decoded) ~= 'table' or type(decoded.games) ~= 'table' then
        error('cortex-minigames: shared/catalog.json is missing or invalid; run `bun run build` in web/')
    end
    return decoded
end

Schema.catalog = loadCatalog()
Schema.games = {}
for _, game in ipairs(Schema.catalog.games) do Schema.games[game.id] = game end
Schema.reasons = {}
for status, list in pairs(Schema.catalog.reasons) do
    local set = {}
    for _, reason in ipairs(list) do set[reason] = true end
    Schema.reasons[status] = set
end
Schema.presets = {}
for _, preset in ipairs(Schema.catalog.presets) do Schema.presets[preset] = true end

---------------------------------------------------------------------------------------------------
-- Primitive checks

local function isFinite(value)
    return type(value) == 'number' and value == value and value ~= math.huge and value ~= -math.huge
end

local function isInt(value)
    return isFinite(value) and value == math.floor(value)
end
Schema.isInt = isInt

local function toInt(value) return math.tointeger(value) or math.floor(value) end

--- Plain text, bounded in bytes, without control characters. Rendered as text by the UI.
local function text(value, max)
    if type(value) ~= 'string' or #value > max or value:find('%c') then return nil end
    return value
end
Schema.text = text

local function isDenseArray(value, maxItems)
    if type(value) ~= 'table' then return false end
    local count = 0
    for key in pairs(value) do
        if math.type(key) ~= 'integer' or key < 1 then return false end
        count = count + 1
        if count > maxItems then return false end
    end
    for index = 1, count do if value[index] == nil then return false end end
    return true, count
end
Schema.isDenseArray = isDenseArray

local function err(reason, field, message)
    return nil, { reason = reason, field = field, message = message }
end

local function copyPlain(value, depth)
    depth = depth or 0
    if depth > 4 then return nil end
    local kind = type(value)
    if kind == 'number' then return isFinite(value) and value or nil end
    if kind == 'string' or kind == 'boolean' then return value end
    if kind ~= 'table' then return nil end
    local out = {}
    for key, item in pairs(value) do
        if type(key) == 'string' or math.type(key) == 'integer' then out[key] = copyPlain(item, depth + 1) end
    end
    return out
end
Schema.copyPlain = copyPlain

---------------------------------------------------------------------------------------------------
-- Params

local checkScalar

local function validatePrompts(field, value, maxItems)
    local dense, count = isDenseArray(value, maxItems)
    if not dense or count < 1 then return ('%s must be a list of 1..%d prompts'):format(field, maxItems) end
    local qte = Schema.catalog.qte
    local types, actions = {}, {}
    for _, t in ipairs(qte.types) do types[t] = true end
    for _, a in ipairs(qte.actions) do actions[a] = true end
    local actionCount = {
        press = { 1, 1 }, hold = { 1, 1 }, release = { 1, 1 }, react = { 1, 1 }, tap = { 1, 1 },
        alternate = { 2, 2 }, chord = { 2, 3 },
    }
    local required = {
        press = { 'windowMs' }, hold = { 'windowMs', 'durationMs' }, release = { 'windowMs', 'durationMs' },
        alternate = { 'windowMs', 'count' }, chord = { 'windowMs' }, react = { 'windowMs' }, tap = { 'windowMs', 'count' },
    }
    for index = 1, count do
        local prompt = value[index]
        local path = ('%s[%d]'):format(field, index)
        if type(prompt) ~= 'table' then return path .. ' must be a table' end
        if not types[prompt.type] then return path .. '.type is not a prompt type' end
        local listed, n = isDenseArray(prompt.actions, 3)
        local bounds = actionCount[prompt.type]
        if not listed or n < bounds[1] or n > bounds[2] then return path .. '.actions has the wrong length' end
        local seen = {}
        for i = 1, n do
            local action = prompt.actions[i]
            if not actions[action] or seen[action] then return path .. '.actions contains an invalid or repeated action' end
            seen[action] = true
        end
        for key, item in pairs(prompt) do
            if key ~= 'type' and key ~= 'actions' then
                local spec = qte.fields[key]
                if not spec then return ('%s.%s is not a prompt field'):format(path, tostring(key)) end
                local problem = checkScalar(path .. '.' .. key, spec, item)
                if problem then return problem end
            end
        end
        for _, key in ipairs(required[prompt.type]) do
            if prompt[key] == nil then return ('%s.%s is required'):format(path, key) end
        end
    end
    return nil
end

checkScalar = function(field, spec, value)
    if spec.type == 'int' then
        if not isInt(value) then return field .. ' must be an integer' end
        if value < spec.min or value > spec.max then return ('%s must be %s..%s'):format(field, spec.min, spec.max) end
    elseif spec.type == 'number' then
        if not isFinite(value) then return field .. ' must be a finite number' end
        if value < spec.min or value > spec.max then return ('%s must be %s..%s'):format(field, spec.min, spec.max) end
    elseif spec.type == 'bool' then
        if type(value) ~= 'boolean' then return field .. ' must be a boolean' end
    elseif spec.type == 'enum' then
        for _, allowed in ipairs(spec.values) do if value == allowed then return nil end end
        return field .. ' is not an allowed value'
    elseif spec.type == 'prompts' then
        return validatePrompts(field, value, spec.maxItems)
    else
        return field .. ' has an unknown schema type'
    end
    return nil
end

--- Merge caller params over the preset and validate every field against the catalog.
function Schema.resolveParams(game, preset, overrides)
    if overrides ~= nil and type(overrides) ~= 'table' then return err('invalid_params', 'params', 'params must be a table') end
    local merged = copyPlain(game.presets[preset]) or {}
    for key, value in pairs(overrides or {}) do
        if type(key) ~= 'string' or not game.params[key] then
            return err('invalid_params', tostring(key), 'not a parameter of ' .. game.id)
        end
        merged[key] = copyPlain(value)
    end
    for key, spec in pairs(game.params) do
        if merged[key] == nil then return err('invalid_params', key, key .. ' is required') end
        local problem = checkScalar(key, spec, merged[key])
        if problem then return err('invalid_params', key, problem) end
    end
    return merged
end

---------------------------------------------------------------------------------------------------
-- Options

local COMMON = {
    title = true, instruction = true, titleKey = true, instructionKey = true, inputMode = true, presentation = true,
    cancel = true, audio = true, motion = true, practice = true, feedbackMs = true,
}
local GAME_KEYS = { game = true, preset = true, params = true, seed = true, timeoutMs = true }
local STEP_KEYS = { id = true, retries = true, onFail = true, required = true }

local function vectorOf(value)
    local kind = type(value)
    if kind ~= 'vector3' and kind ~= 'table' then return nil end
    local x, y, z = value.x, value.y, value.z
    if not (isFinite(x) and isFinite(y) and isFinite(z)) then return nil end
    return { x = x + 0.0, y = y + 0.0, z = z + 0.0 }
end

local function normalizeCancel(raw, side)
    local out = { escape = 'cancel', death = true }
    if raw == nil then return out end
    if type(raw) ~= 'table' then return err('invalid_options', 'cancel', 'cancel must be a table') end
    for key in pairs(raw) do
        if key ~= 'escape' and key ~= 'death' and key ~= 'radius' and key ~= 'entity' and key ~= 'maxDistance' and key ~= 'check' then
            return err('invalid_options', 'cancel.' .. tostring(key), 'unknown cancel rule')
        end
    end
    -- Escape can become a failed attempt, but it can never be disabled: the player must always get out.
    if raw.escape == 'fail' then out.escape = 'fail'
    elseif raw.escape ~= nil and raw.escape ~= true and raw.escape ~= 'cancel' then
        return err('invalid_options', 'cancel.escape', "escape must be 'cancel' or 'fail'; it cannot be disabled")
    end
    if raw.death ~= nil then
        if type(raw.death) ~= 'boolean' then return err('invalid_options', 'cancel.death', 'death must be a boolean') end
        out.death = raw.death
    end
    if raw.radius ~= nil then
        local radius = raw.radius
        local centre = type(radius) == 'table' and (radius.coords and vectorOf(radius.coords) or vectorOf(radius)) or nil
        local distance = type(radius) == 'table' and (radius.maxDistance or radius.distance) or nil
        if not centre or not isFinite(distance) or distance < 0.5 or distance > 200.0 then
            return err('invalid_options', 'cancel.radius', 'radius needs coords and maxDistance 0.5..200')
        end
        out.radius = { x = centre.x, y = centre.y, z = centre.z, maxDistance = distance + 0.0 }
    end
    if raw.entity ~= nil then
        if side ~= 'client' then return err('invalid_options', 'cancel.entity', 'entity handles are client-local') end
        if not isInt(raw.entity) or raw.entity <= 0 then return err('invalid_options', 'cancel.entity', 'entity must be a local handle') end
        out.entity = toInt(raw.entity)
        if raw.maxDistance ~= nil then
            if not isFinite(raw.maxDistance) or raw.maxDistance < 0.5 or raw.maxDistance > 200.0 then
                return err('invalid_options', 'cancel.maxDistance', 'maxDistance must be 0.5..200')
            end
            out.maxDistance = raw.maxDistance + 0.0
        end
    end
    if raw.check ~= nil then
        local kind = type(raw.check)
        -- Cross-resource function references arrive as tables with a __call metamethod.
        local callable = kind == 'function' or (kind == 'table' and getmetatable(raw.check) and getmetatable(raw.check).__call)
        if side ~= 'client' or not callable then return err('invalid_options', 'cancel.check', 'check must be a client function') end
        out.check = raw.check
    end
    return out
end

local function normalizeCommon(raw, out, side)
    local bounds = Config.Bounds
    if raw.title ~= nil then
        out.title = text(raw.title, 64)
        if not out.title then return err('invalid_options', 'title', 'title must be text up to 64 bytes') end
    elseif raw.titleKey ~= nil then
        out.title = CortexMinigames.Locale.key(raw.titleKey)
        if not out.title then return err('invalid_options', 'titleKey', 'unknown locale key') end
    end
    if raw.instruction ~= nil then
        out.instruction = text(raw.instruction, 140)
        if not out.instruction then return err('invalid_options', 'instruction', 'instruction must be text up to 140 bytes') end
    elseif raw.instructionKey ~= nil then
        out.instruction = CortexMinigames.Locale.key(raw.instructionKey)
        if not out.instruction then return err('invalid_options', 'instructionKey', 'unknown locale key') end
    end
    if raw.inputMode ~= nil and not MODES[raw.inputMode] then return err('invalid_options', 'inputMode', 'unknown input mode') end
    out.inputMode = raw.inputMode or out.inputMode or 'auto'

    local presentation = raw.presentation
    if presentation ~= nil then
        if type(presentation) ~= 'table' then return err('invalid_options', 'presentation', 'presentation must be a table') end
        if presentation.mode ~= nil and presentation.mode ~= 'compact' and presentation.mode ~= 'focused' then
            return err('invalid_options', 'presentation.mode', "mode must be 'compact' or 'focused'")
        end
        if presentation.anchor ~= nil and presentation.anchor ~= 'bottom' and presentation.anchor ~= 'center' then
            return err('invalid_options', 'presentation.anchor', "anchor must be 'bottom' or 'center'")
        end
        if presentation.scale ~= nil and (not isFinite(presentation.scale) or presentation.scale < 0.75 or presentation.scale > 1.5) then
            return err('invalid_options', 'presentation.scale', 'scale must be 0.75..1.5')
        end
        out.presentation = { mode = presentation.mode, anchor = presentation.anchor, scale = presentation.scale or 1.0 }
    end
    out.presentation = out.presentation or { scale = 1.0 }

    local cancel, problem = normalizeCancel(raw.cancel, side)
    if not cancel then return nil, problem end
    if raw.cancel ~= nil or not out.cancel then out.cancel = cancel end

    local audio = raw.audio
    if audio ~= nil then
        if type(audio) ~= 'table' or (audio.volume ~= nil and (not isFinite(audio.volume) or audio.volume < 0 or audio.volume > 1))
            or (audio.muted ~= nil and type(audio.muted) ~= 'boolean') then
            return err('invalid_options', 'audio', 'audio needs volume 0..1 and boolean muted')
        end
        out.audio = { volume = audio.volume or 1.0, muted = audio.muted == true }
    end
    out.audio = out.audio or { volume = 1.0, muted = false }

    if raw.motion ~= nil and not MOTION[raw.motion] then return err('invalid_options', 'motion', "motion must be 'inherit', 'reduced' or 'full'") end
    out.motion = raw.motion or out.motion or 'inherit'
    if raw.practice ~= nil and not PRACTICE[raw.practice] then return err('invalid_options', 'practice', "practice must be 'auto', 'always' or 'never'") end
    out.practice = raw.practice or out.practice or 'auto'
    if raw.feedbackMs ~= nil and (not isInt(raw.feedbackMs) or raw.feedbackMs < 0 or raw.feedbackMs > bounds.maxFeedbackMs) then
        return err('invalid_options', 'feedbackMs', ('feedbackMs must be 0..%d'):format(bounds.maxFeedbackMs))
    end
    out.feedbackMs = raw.feedbackMs and toInt(raw.feedbackMs) or out.feedbackMs or Config.Session.defaultFeedbackMs
    return out
end

local function normalizeGameFields(raw, out)
    local bounds = Config.Bounds
    local game = type(raw.game) == 'string' and Schema.games[raw.game] or nil
    if not game then return err('unknown_game', 'game', 'unknown game ' .. tostring(raw.game)) end
    if next(bounds.allowedGames) and not bounds.allowedGames[game.id] then
        return err('unknown_game', 'game', game.id .. ' is not enabled on this server')
    end
    local preset = raw.preset or 'normal'
    if not Schema.presets[preset] then return err('invalid_options', 'preset', 'unknown preset') end
    local params, problem = Schema.resolveParams(game, preset, raw.params)
    if not params then return nil, problem end
    if raw.seed ~= nil and (not isInt(raw.seed) or raw.seed < 0 or raw.seed > Schema.MAX_SEED) then
        return err('invalid_options', 'seed', 'seed must be 0..2147483647')
    end
    if raw.timeoutMs ~= nil and (not isInt(raw.timeoutMs) or raw.timeoutMs < bounds.minTimeoutMs or raw.timeoutMs > bounds.maxTimeoutMs) then
        return err('invalid_options', 'timeoutMs', ('timeoutMs must be %d..%d'):format(bounds.minTimeoutMs, bounds.maxTimeoutMs))
    end
    if out.inputMode ~= 'auto' then
        local supported = false
        for _, mode in ipairs(game.inputs) do if mode == out.inputMode then supported = true end end
        if not supported then return err('unsupported_input', 'inputMode', game.id .. ' does not support ' .. out.inputMode) end
    end
    out.game, out.preset, out.params = game.id, preset, params
    out.seed = raw.seed and toInt(raw.seed) or nil
    out.timeoutMs = raw.timeoutMs and toInt(raw.timeoutMs) or nil
    out.presentation.mode = out.presentation.mode or game.presentation
    out.presentation.anchor = out.presentation.anchor or (out.presentation.mode == 'compact' and 'bottom' or 'center')
    return out
end

--- Normalise a single-game options table. `side` is 'client' or 'server'.
function Schema.normalizeOptions(raw, side)
    if type(raw) ~= 'table' then return err('invalid_options', 'options', 'options must be a table') end
    for key in pairs(raw) do
        if not COMMON[key] and not GAME_KEYS[key] then return err('invalid_options', tostring(key), 'unknown option') end
    end
    local out, problem = normalizeCommon(raw, {}, side)
    if not out then return nil, problem end
    return normalizeGameFields(raw, out)
end

--- Normalise a sequence: shared options plus a bounded, linear list of steps. There are no jumps,
--- so cycles cannot exist; retries are bounded per step and the whole run has one deadline.
function Schema.normalizeSequence(raw, side)
    local bounds = Config.Bounds
    if type(raw) ~= 'table' then return err('invalid_sequence', 'options', 'options must be a table') end
    for key in pairs(raw) do
        if not COMMON[key] and key ~= 'steps' and key ~= 'deadlineMs' then return err('invalid_sequence', tostring(key), 'unknown option') end
    end
    local dense, count = isDenseArray(raw.steps, bounds.maxSequenceSteps)
    if not dense or count < 1 then
        return err('invalid_sequence', 'steps', ('steps must be a list of 1..%d steps'):format(bounds.maxSequenceSteps))
    end
    local shared, problem = normalizeCommon(raw, {}, side)
    if not shared then return nil, problem end
    if raw.deadlineMs ~= nil and (not isInt(raw.deadlineMs) or raw.deadlineMs < bounds.minTimeoutMs or raw.deadlineMs > bounds.maxSequenceDeadlineMs) then
        return err('invalid_sequence', 'deadlineMs', ('deadlineMs must be %d..%d'):format(bounds.minTimeoutMs, bounds.maxSequenceDeadlineMs))
    end
    local steps, ids = {}, {}
    for index = 1, count do
        local rawStep = raw.steps[index]
        local field = ('steps[%d]'):format(index)
        if type(rawStep) ~= 'table' then return err('invalid_sequence', field, 'step must be a table') end
        for key in pairs(rawStep) do
            if not GAME_KEYS[key] and not STEP_KEYS[key] and key ~= 'title' and key ~= 'instruction'
                and key ~= 'titleKey' and key ~= 'instructionKey' and key ~= 'presentation' then
                return err('invalid_sequence', field .. '.' .. tostring(key), 'unknown step option')
            end
        end
        local base = {
            inputMode = shared.inputMode, cancel = shared.cancel, audio = shared.audio, motion = shared.motion,
            practice = shared.practice, feedbackMs = shared.feedbackMs,
            presentation = rawStep.presentation == nil and shared.presentation and { scale = shared.presentation.scale } or nil,
        }
        local stepCommon = {
            title = rawStep.title, instruction = rawStep.instruction, titleKey = rawStep.titleKey,
            instructionKey = rawStep.instructionKey, presentation = rawStep.presentation,
        }
        local step, stepProblem = normalizeCommon(stepCommon, base, side)
        if not step then
            stepProblem.field = field .. '.' .. (stepProblem.field or '')
            return nil, stepProblem
        end
        step, stepProblem = normalizeGameFields(rawStep, step)
        if not step then
            stepProblem.field = field .. '.' .. (stepProblem.field or '')
            return nil, stepProblem
        end
        local id = rawStep.id == nil and ('step' .. index) or text(rawStep.id, 32)
        if not id or ids[id] then return err('invalid_sequence', field .. '.id', 'step ids must be unique text up to 32 bytes') end
        ids[id] = true
        if rawStep.retries ~= nil and (not isInt(rawStep.retries) or rawStep.retries < 0 or rawStep.retries > bounds.maxStepRetries) then
            return err('invalid_sequence', field .. '.retries', ('retries must be 0..%d'):format(bounds.maxStepRetries))
        end
        if rawStep.onFail ~= nil and not ON_FAIL[rawStep.onFail] then
            return err('invalid_sequence', field .. '.onFail', "onFail must be 'stop', 'continue' or 'retry'")
        end
        if rawStep.required ~= nil and type(rawStep.required) ~= 'boolean' then
            return err('invalid_sequence', field .. '.required', 'required must be a boolean')
        end
        step.id = id
        step.onFail = rawStep.onFail or 'stop'
        step.retries = step.onFail == 'retry' and toInt(rawStep.retries or 1) or 0
        step.required = rawStep.required ~= false
        steps[index] = step
    end
    shared.steps = steps
    shared.deadlineMs = raw.deadlineMs and toInt(raw.deadlineMs) or nil
    shared.kind = 'sequence'
    return shared
end

--- Best-effort default budget for a step when the caller gave none (preset default from the catalog).
function Schema.estimateTimeout(spec)
    if spec.timeoutMs then return spec.timeoutMs end
    local game = Schema.games[spec.game]
    local estimate = game and game.defaultTimeoutMs and game.defaultTimeoutMs[spec.preset] or Config.Bounds.maxTimeoutMs
    return math.min(Config.Bounds.maxTimeoutMs, math.max(Config.Bounds.minTimeoutMs, estimate))
end

--- Convert a normalised spec back into plain options (no functions, no entity handles), so a
--- server attempt reaches the client as data the client validates again with the same rules.
function Schema.toOptions(spec)
    local function common(from, to)
        to.title, to.instruction = from.title, from.instruction
        to.presentation = from.presentation and { mode = from.presentation.mode, anchor = from.presentation.anchor, scale = from.presentation.scale } or nil
        return to
    end
    local shared = common(spec, {
        inputMode = spec.inputMode, motion = spec.motion, practice = spec.practice, feedbackMs = spec.feedbackMs,
        audio = spec.audio and { volume = spec.audio.volume, muted = spec.audio.muted } or nil,
        cancel = spec.cancel and { escape = spec.cancel.escape, death = spec.cancel.death, radius = spec.cancel.radius } or nil,
    })
    if spec.kind == 'sequence' then
        shared.presentation = nil
        shared.deadlineMs = spec.deadlineMs
        shared.steps = {}
        for index, step in ipairs(spec.steps) do
            shared.steps[index] = common(step, {
                id = step.id, game = step.game, preset = step.preset, params = copyPlain(step.params), seed = step.seed,
                timeoutMs = step.timeoutMs, onFail = step.onFail, required = step.required,
                retries = step.onFail == 'retry' and step.retries or nil,
            })
        end
        return shared
    end
    shared.game, shared.preset, shared.params = spec.game, spec.preset, copyPlain(spec.params)
    shared.seed, shared.timeoutMs = spec.seed, spec.timeoutMs
    return shared
end

---------------------------------------------------------------------------------------------------
-- Results

--- The terminal result for paths that never reached a scored outcome.
function Schema.makeResult(sessionId, game, status, reason)
    return {
        apiVersion = Schema.API_VERSION,
        sessionId = sessionId,
        game = game or 'unknown',
        status = status,
        reason = reason,
        score = nil,
        grade = (status == 'failed' or status == 'timeout') and 'fail' or nil,
        durationMs = 0,
        mistakes = 0,
        metrics = {},
    }
end

local function gradeConsistent(status, grade, score, mistakes)
    if status ~= 'success' then return grade == 'fail' end
    if not GRADES[grade] then return false end
    if grade == 'perfect' then return score ~= nil and score >= 95 and mistakes == 0 end
    if grade == 'good' then return score ~= nil and score >= 75 end
    return true
end

function Schema.gradeFor(status, score, mistakes)
    if status == 'failed' or status == 'timeout' then return 'fail' end
    if status ~= 'success' then return nil end
    if score and score >= 95 and mistakes == 0 then return 'perfect' end
    if score and score >= 75 then return 'good' end
    return 'pass'
end

local function cleanMetrics(game, metrics)
    local out, count = {}, 0
    if type(metrics) ~= 'table' then return out end
    for key, kind in pairs(game.metrics or {}) do
        local value = metrics[key]
        if kind == 'boolean' and type(value) == 'boolean' then out[key] = value; count = count + 1
        elseif kind == 'number' and isFinite(value) then out[key] = value; count = count + 1 end
        if count >= 12 then break end
    end
    return out
end

--- Validate a scored report from the UI (or a client) for one game run. `allowed` limits statuses.
function Schema.normalizeReport(payload, sessionId, gameId, timeoutMs, allowed)
    local game = Schema.games[gameId]
    if type(payload) ~= 'table' or not game then return err('invalid_report', 'report', 'report must be a table') end
    local status, reason = payload.status, payload.reason
    allowed = allowed or { success = true, failed = true, timeout = true }
    if not STATUSES[status] or not allowed[status] then return err('invalid_report', 'status', 'status not allowed') end
    if type(reason) ~= 'string' or not Schema.reasons[status][reason] then return err('invalid_report', 'reason', 'unknown reason') end
    local score = payload.score
    if score ~= nil and (not isFinite(score) or score < 0 or score > 100) then return err('invalid_report', 'score', 'score must be 0..100') end
    local mistakes = payload.mistakes or 0
    if not isInt(mistakes) or mistakes < 0 or mistakes > 10000 then return err('invalid_report', 'mistakes', 'mistakes out of range') end
    local duration = payload.durationMs or 0
    if not isInt(duration) or duration < 0 or duration > (timeoutMs or Config.Bounds.maxTimeoutMs) + 250 then
        return err('invalid_report', 'durationMs', 'duration out of range')
    end
    score = score and math.floor(score + 0.5) or nil
    local grade = payload.grade
    if (status == 'success' or status == 'failed' or status == 'timeout') then
        if not gradeConsistent(status, grade, score, mistakes) then return err('invalid_report', 'grade', 'grade contradicts status or score') end
    else
        grade = nil
    end
    return {
        apiVersion = Schema.API_VERSION,
        sessionId = sessionId,
        game = game.id,
        status = status,
        reason = reason,
        score = score,
        grade = grade,
        durationMs = toInt(duration),
        mistakes = toInt(mistakes),
        metrics = cleanMetrics(game, payload.metrics),
    }
end

CortexMinigames.Schema = Schema
