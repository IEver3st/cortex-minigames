-- Sequences: a bounded, linear list of steps under one owner, one focus hold and one deadline.
--
-- Step failure policy (player failure = status 'failed' or 'timeout'):
--   stop      the sequence ends as failed/step_failed
--   continue  the step is recorded as failed and the next step runs; if the step is required,
--             aggregate success becomes impossible but the remaining steps still report metrics
--   retry     the step reruns (fresh seed unless the caller fixed one) up to `retries` more times,
--             then behaves like `stop`
-- Cancellation, errors and rejections end the whole sequence immediately with that status.
-- Success needs every required step passed and at least one step passed.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Sequence = {}

local function Session() return CortexMinigames.Session end

function Sequence.start(s)
    s.stepIndex = 1
    s.attempt = 0
    s.steps = {}
    -- Same budget the server uses for the attempt's expiry (Schema.budgetMs).
    s.deadlineAt = GetGameTimer() + Schema.budgetMs(s.spec)
    Sequence.runStep(s)
end

function Sequence.runStep(s)
    if s.terminal then return end
    local step = s.spec.steps[s.stepIndex]
    s.attempt = s.attempt + 1
    Session().openRun(s, step, { index = s.stepIndex, total = #s.spec.steps })
end

--- Aggregate result for the whole sequence so far (shared rules: Schema.aggregateSequence).
function Sequence.aggregate(s, status, reason)
    return Schema.aggregateSequence(s.id, s.spec, s.steps or {}, status, reason)
end

local function record(s, stepResult)
    local step = s.spec.steps[s.stepIndex]
    s.steps[s.stepIndex] = {
        id = step.id,
        game = step.game,
        status = stepResult.status,
        reason = stepResult.reason,
        score = stepResult.score,
        grade = stepResult.grade,
        attempts = s.attempt,
        durationMs = (s.steps[s.stepIndex] and s.steps[s.stepIndex].durationMs or 0) + (stepResult.durationMs or 0),
        mistakes = (s.steps[s.stepIndex] and s.steps[s.stepIndex].mistakes or 0) + (stepResult.mistakes or 0),
        metrics = stepResult.metrics,
    }
end

local function later(s, fn)
    local gap = (s.spec.feedbackMs or 0) + Config.Session.stepGapMs
    SetTimeout(gap, function()
        if Session().active() == s and not s.terminal then fn() end
    end)
end

function Sequence.onStepResult(s, stepResult)
    local step = s.spec.steps[s.stepIndex]
    record(s, stepResult)
    local status = stepResult.status
    if status == 'cancelled' or status == 'error' or status == 'rejected' then
        local result = Sequence.aggregate(s, status, stepResult.reason)
        result.error = stepResult.error
        return Session().finish(s, result)
    end
    if status ~= 'success' then
        if step.onFail == 'retry' and s.attempt <= step.retries then
            return later(s, function() Sequence.runStep(s) end)
        end
        if step.onFail ~= 'continue' then
            return Session().finish(s, Sequence.aggregate(s, 'failed', 'step_failed'))
        end
    end
    if s.stepIndex >= #s.spec.steps then
        if not Schema.sequenceCanSucceed(s.spec, s.steps) then return Session().finish(s, Sequence.aggregate(s, 'failed', 'step_failed')) end
        return Session().finish(s, Sequence.aggregate(s, 'success', 'completed'))
    end
    s.stepIndex = s.stepIndex + 1
    s.attempt = 0
    later(s, function() Sequence.runStep(s) end)
end

CortexMinigames.Sequence = Sequence
