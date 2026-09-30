-- Session runtime: one foreground session per player, explicit states, one terminal path.
--
--   idle → preparing (open sent, waiting for the UI's ready) → ready (focus taken, start sent,
--   practice/cue running) → playing (gameplay clock running) → settling → closed
--
-- Timeouts, cancellation and context loss can end any nonterminal state. `finish` is the single
-- terminal path: the first caller wins, cleanup runs once, the result is delivered once.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Log = CortexMinigames.Log
local Prefs = CortexMinigames.Prefs
local Input = CortexMinigames.Input
local Context = CortexMinigames.Context

local Session = {}
local RESOURCE = GetCurrentResourceName()
local PROTOCOL = Schema.PROTOCOL
local READY_REASONS = { invalid_params = 'rejected', invalid_options = 'rejected', unknown_game = 'rejected', generation_failed = 'error' }

math.randomseed(GetGameTimer() + GetRandomIntInRange(0, 65535))
-- The resource generation token. The NUI echoes it on every callback, so messages from before a
-- restart (or from a UI that reloaded) can never touch a new session.
local generation = GetRandomIntInRange(1, 999999)
local counter = 0
local active = nil
local finished = {} -- recent session id → owner, for idempotent Cancel
local finishedOrder = {}

local function now() return GetGameTimer() end

local function send(kind, payload)
    payload = payload or {}
    payload.protocol, payload.type, payload.gen = PROTOCOL, kind, generation
    SendNUIMessage(payload)
end
Session.send = send

local function remember(id, owner)
    finished[id] = owner
    finishedOrder[#finishedOrder + 1] = id
    if #finishedOrder > 32 then finished[table.remove(finishedOrder, 1)] = nil end
end

local function releaseFocus(s)
    if not s.focus then return end
    s.focus = false
    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)
end

--- The single terminal path for a whole session.
function Session.finish(s, result)
    if not s or s.terminal then return false end
    s.terminal = result
    s.state = 'settling'
    local run = s.run
    if run and run.state ~= 'closed' then
        run.state = 'closed'
        send('close', { sid = run.sid, status = result.status, reason = result.reason, feedbackMs = s.spec.feedbackMs or 0 })
    end
    releaseFocus(s)
    Input.reset()
    if active == s then active = nil end
    remember(s.id, s.owner)
    s.state = 'closed'
    Log.info('session.finish', { id = s.id, owner = s.owner, game = result.game, status = result.status, reason = result.reason })
    local ok, problem = pcall(s.onDone, result)
    if not ok then Log.error('session.deliver_failed', { id = s.id, error = tostring(problem) }) end
    return true
end

--- Resolve one run (one game within the session). Sequences decide what happens next.
local function finishRun(s, result)
    local run = s.run
    if not run or run.state == 'done' or run.state == 'closed' or s.terminal then return end
    run.state = 'done'
    if s.kind == 'sequence' then
        -- Tell the UI now if Lua decided (deadline); UI-reported results are already showing.
        if not run.uiReported then send('close', { sid = run.sid, status = result.status, reason = result.reason, feedbackMs = s.spec.feedbackMs or 0 }) end
        CortexMinigames.Sequence.onStepResult(s, result)
    else
        Session.finish(s, result)
    end
end
Session.finishRun = finishRun

local function result(s, status, reason, game)
    return Schema.makeResult(s and s.id or nil, game or (s and s.run and s.run.spec.game) or (s and s.spec.game), status, reason)
end
Session.result = result

--- Open one game run inside session `s`. `step` is nil for single games.
function Session.openRun(s, spec, step)
    local prefs = Prefs.effective()
    counter = counter + 1
    local run = {
        sid = ('%s-%d'):format(s.id, counter),
        spec = spec,
        state = 'preparing',
        deadline = now() + Config.Session.startupTimeoutMs,
        seed = spec.seed or math.random(0, Schema.MAX_SEED),
    }
    local practice = spec.practice == 'always' or (spec.practice == 'auto' and not Prefs.hasPracticed(spec.game))
    run.practice = practice
    s.run = run
    send('open', {
        sid = run.sid,
        spec = {
            game = spec.game,
            preset = spec.preset,
            params = spec.params,
            seed = run.seed,
            timeoutMs = spec.timeoutMs,
            minTimeoutMs = Config.Bounds.minTimeoutMs,
            maxTimeoutMs = Config.Bounds.maxTimeoutMs,
            title = spec.title or '',
            instruction = spec.instruction or '',
            presentation = spec.presentation,
            practice = practice,
            feedbackMs = spec.feedbackMs,
            audio = { volume = math.min(spec.audio.volume, prefs.volume), muted = spec.audio.muted or prefs.muted },
            reducedMotion = spec.motion == 'reduced' or (spec.motion == 'inherit' and prefs.motion == 'reduced'),
            step = step,
        },
    })
    Log.info('run.open', { id = s.id, sid = run.sid, game = spec.game, seed = run.seed, preset = spec.preset })
end

local function wantsCursor(spec)
    if spec.inputMode == 'mouse' then return true end
    if spec.inputMode ~= 'auto' then return false end
    -- Pointer-gesture games (catalog `cursor`) need mouse motion in the UI even in a compact slip.
    local game = Schema.games[spec.game]
    return spec.presentation.mode == 'focused' or (game ~= nil and game.cursor == true)
end

---------------------------------------------------------------------------------------------------
-- Frame loop: exists only while a session is active.

local function emitPad(kind, action)
    local s = active
    if s and s.run then send('input', { sid = s.run.sid, kind = kind, action = action }) end
end

local function emitAxes(axes)
    local s = active
    if s and s.run then send('axes', { sid = s.run.sid, lx = axes.lx, ly = axes.ly, rt = axes.rt }) end
end

local function escapeResult(s)
    if s.spec.cancel.escape == 'fail' then return result(s, 'failed', 'abandoned') end
    return result(s, 'cancelled', 'player_cancelled')
end

local function loop(s)
    local nextContext = 0
    while active == s and not s.terminal do
        local t = now()
        local run = s.run
        if s.focus then
            Input.suppress()
            if run and (run.state == 'ready' or run.state == 'playing') and Input.poll(emitPad, emitAxes, t) then
                Session.finish(s, escapeResult(s))
                break
            end
        end
        if run and run.deadline and t >= run.deadline then
            if run.state == 'preparing' then
                Session.finish(s, result(s, 'error', 'ui_startup_timeout'))
            elseif run.state == 'ready' then
                Session.finish(s, result(s, run.practice and 'cancelled' or 'error', run.practice and 'practice_idle' or 'ui_startup_timeout'))
            elseif run.state == 'playing' then
                finishRun(s, result(s, 'timeout', 'hard_deadline'))
            end
        end
        if not s.terminal and s.deadlineAt and t >= s.deadlineAt then
            Session.finish(s, CortexMinigames.Sequence.aggregate(s, 'timeout', 'sequence_deadline'))
        end
        if not s.terminal and t >= nextContext then
            nextContext = t + Config.Session.contextIntervalMs
            local reason = Context.check(s.spec.cancel)
            if reason then Session.finish(s, result(s, 'cancelled', reason)) end
        end
        Wait(s.focus and 0 or 50)
    end
end

---------------------------------------------------------------------------------------------------
-- Public runtime API (used by exports, sequences and server attempts)

--- Start a normalised session. Returns true, session or false, rejectedResult. Never yields.
function Session.begin(owner, spec, onDone)
    local game = spec.kind == 'sequence' and spec.steps[1].game or spec.game
    if active then return false, Schema.makeResult(nil, game, 'rejected', 'busy') end
    if IsNuiFocused() or IsPauseMenuActive() then return false, Schema.makeResult(nil, game, 'rejected', 'focus_unavailable') end
    counter = counter + 1
    local s = {
        id = ('cmg-%d-%d'):format(generation, counter),
        owner = owner,
        kind = spec.kind == 'sequence' and 'sequence' or 'single',
        spec = spec,
        state = 'preparing',
        focus = false,
        onDone = onDone,
        startedAt = now(),
    }
    active = s
    CreateThread(function() loop(s) end)
    if s.kind == 'sequence' then CortexMinigames.Sequence.start(s) else Session.openRun(s, spec, nil) end
    return true, s
end

--- Cancel from a caller. Idempotent; limited to the owning resource.
function Session.cancel(owner, sessionId, reason)
    local s = active
    if s and s.id == sessionId then
        if s.owner ~= owner then return false, 'not_owner' end
        Log.info('session.cancel', { id = s.id, reason = type(reason) == 'string' and reason:sub(1, 32) or 'none' })
        Session.finish(s, result(s, 'cancelled', 'caller_cancelled'))
        return true
    end
    if finished[sessionId] ~= nil then
        if finished[sessionId] ~= owner then return false, 'not_owner' end
        return true, 'already_finished'
    end
    return false, 'not_found'
end

--- Internal cancel with a specific reason (server attempts, logout, stop).
function Session.cancelActive(reason, predicate)
    local s = active
    if s and (not predicate or predicate(s)) then return Session.finish(s, result(s, 'cancelled', reason)) end
    return false
end

function Session.active() return active end

function Session.pushPrefs()
    send('prefs', { prefs = Prefs.effective() })
end

---------------------------------------------------------------------------------------------------
-- NUI callbacks. Each acknowledges exactly once, including validation and exception paths.

local function handle(name, fn)
    RegisterNUICallback(name, function(data, cb)
        local replied = false
        local function reply(value)
            if replied then return end
            replied = true
            cb(value)
        end
        local ok, problem = pcall(fn, data, reply)
        if not ok then
            Log.error('nui.callback_failed', { name = name, error = tostring(problem) })
            reply({ ok = false, error = 'internal' })
        end
        reply({ ok = false, error = 'unhandled' })
    end)
end

--- The active session and run for a callback, or nil when the message is stale.
local function current(data)
    if type(data) ~= 'table' or data.protocol ~= PROTOCOL or data.gen ~= generation then return nil end
    local s = active
    if not s or s.terminal or not s.run or data.sid ~= s.run.sid then return nil end
    return s, s.run
end

handle('boot', function(_, reply)
    -- A boot while a session is live means the UI reloaded and lost its state: fail closed.
    local s = active
    if s and s.run and s.run.state ~= 'preparing' then Session.finish(s, result(s, 'error', 'ui_error')) end
    reply({ ok = true, data = { gen = generation, prefs = Prefs.effective(), strings = CortexMinigames.Locale.ui() } })
end)

handle('ready', function(data, reply)
    local s, run = current(data)
    if not s or run.state ~= 'preparing' then return reply({ ok = false, error = 'stale' }) end
    if data.ok ~= true then
        local reason = type(data.reason) == 'string' and data.reason or 'invalid_params'
        local status = READY_REASONS[reason] or 'rejected'
        if not READY_REASONS[reason] then reason = 'invalid_params' end
        Log.warn('run.rejected_by_ui', { id = s.id, reason = reason, field = type(data.field) == 'string' and data.field:sub(1, 48) or '', message = type(data.message) == 'string' and data.message:sub(1, 64) or '' })
        finishRun(s, result(s, status, reason))
        return reply({ ok = true })
    end
    local timeout = data.timeoutMs
    if not Schema.isInt(timeout) or timeout < Config.Bounds.minTimeoutMs or timeout > Config.Bounds.maxTimeoutMs
        or (run.spec.timeoutMs and timeout ~= run.spec.timeoutMs) then
        finishRun(s, result(s, 'error', 'invalid_report'))
        return reply({ ok = false, error = 'invalid_timeout' })
    end
    run.timeoutMs = timeout
    if not s.focus then
        -- Focus is taken only now: configuration is valid and the UI is ready to draw.
        if IsNuiFocused() then
            Session.finish(s, result(s, 'rejected', 'focus_unavailable'))
            return reply({ ok = false, error = 'focus_unavailable' })
        end
        SetNuiFocus(true, wantsCursor(run.spec))
        SetNuiFocusKeepInput(false)
        s.focus = true
    end
    run.state = 'ready'
    run.deadline = now() + (run.practice and Config.Session.practiceTimeoutMs or 4000)
    s.state = 'ready'
    send('start', { sid = run.sid })
    reply({ ok = true })
end)

handle('began', function(data, reply)
    local s, run = current(data)
    if not s or run.state ~= 'ready' then return reply({ ok = false, error = 'stale' }) end
    run.state = 'playing'
    s.state = 'playing'
    run.beganAt = now()
    run.deadline = run.beganAt + run.timeoutMs + Config.Session.hardGraceMs
    if data.practiced == true then Prefs.markPracticed(run.spec.game) end
    reply({ ok = true })
end)

handle('complete', function(data, reply)
    local s, run = current(data)
    if not s or run.state ~= 'playing' then return reply({ ok = false, error = 'stale' }) end
    local report, problem = Schema.normalizeReport(data, s.id, run.spec.game, run.timeoutMs)
    run.uiReported = true
    if not report then
        Log.warn('run.invalid_report', { id = s.id, field = problem.field })
        finishRun(s, result(s, 'error', 'invalid_report'))
        return reply({ ok = false, error = 'invalid_report' })
    end
    finishRun(s, report)
    reply({ ok = true })
end)

handle('cancel', function(data, reply)
    local s, run = current(data)
    if not s or (run.state ~= 'ready' and run.state ~= 'playing') then return reply({ ok = false, error = 'stale' }) end
    Session.finish(s, escapeResult(s))
    reply({ ok = true })
end)

handle('fault', function(data, reply)
    local s = current(data)
    if not s then return reply({ ok = false, error = 'stale' }) end
    Session.finish(s, result(s, 'error', 'ui_error'))
    reply({ ok = true })
end)

---------------------------------------------------------------------------------------------------
-- Lifecycle

AddEventHandler('onResourceStop', function(resource)
    if resource ~= RESOURCE then return end
    -- Results may still reach callers while this runtime is stopping; nothing is promised after.
    Session.cancelActive('resource_stopping')
    SetNuiFocus(false, false)
    SetNuiFocusKeepInput(false)
end)

AddEventHandler('onClientResourceStop', function(resource)
    if resource ~= RESOURCE and active and active.owner == resource then
        Session.cancelActive('caller_stopped')
    end
end)

for _, eventName in ipairs(Config.LogoutEvents) do
    RegisterNetEvent(eventName, function() Session.cancelActive('logged_out') end)
end

CortexMinigames.Cortex.onChange(Session.pushPrefs)
CortexMinigames.Session = Session
