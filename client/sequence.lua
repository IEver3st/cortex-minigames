-- Sequences: a bounded, linear list of steps under one owner, one focus hold and one deadline.
--
-- Step failure policy (player failure = status 'failed' or 'timeout'):
--   stop      the sequence ends as failed/step_failed
--   continue  the step is recorded as failed and the next step runs; if the step is required,
--             aggregate success becomes impossible but the remaining steps still report metrics
--   retry     the step reruns (fresh seed unless the caller fixed one) up to `retries` more times,
--             then behaves like `stop`
-- Cancellation, errors and rejections end the whole sequence immediately with that status.

CortexMinigames = CortexMinigames or {}

local Schema = CortexMinigames.Schema
local Sequence = {}

local function Session() return CortexMinigames.Session end

local function estimateDeadline(spec)
    local total = 0
    for _, step in ipairs(spec.steps) do
        local attempts = 1 + (step.retries or 0)
        -- Per attempt: gameplay budget, plus room for the ready cue or a first-use practice card and feedback.
        total = total + attempts * (Schema.estimateTimeout(step) + 8000 + (step.feedbackMs or 0) + Config.Session.stepGapMs)
    end
    return math.min(Config.Bounds.maxSequenceDeadlineMs, total)
end

function Sequence.start(s)
    s.stepIndex = 1
    s.attempt = 0
    s.steps = {}
    s.impossible = false
    s.retriesUsed = 0
    s.deadlineAt = GetGameTimer() + (s.spec.deadlineMs or estimateDeadline(s.spec))
    Sequence.runStep(s)
end

function Sequence.runStep(s)
    if s.terminal then return end
    local step = s.spec.steps[s.stepIndex]
    s.attempt = s.attempt + 1
    Session().openRun(s, step, { index = s.stepIndex, total = #s.spec.steps })
end

--- Aggregate result for the whole sequence so far.
function Sequence.aggregate(s, status, reason)
    local scores, completed, mistakes, duration, failedRequired = {}, 0, 0, 0, 0
    for index, entry in ipairs(s.steps or {}) do
        mistakes = mistakes + (entry.mistakes or 0)
        duration = duration + (entry.durationMs or 0)
        if entry.status == 'success' then
            completed = completed + 1
            if entry.score then scores[#scores + 1] = entry.score end
        elseif s.spec.steps[index].required then
            failedRequired = failedRequired + 1
        end
    end
    local score = nil
    if #scores > 0 then
        local sum = 0
        for _, value in ipairs(scores) do sum = sum + value end
        score = math.floor(sum / #scores + 0.5)
    end
    local result = Schema.makeResult(s.id, 'sequence', status, reason)
    -- Scores only mean something for played-out sequences, never for cancelled or broken ones.
    result.score = (status == 'success' or status == 'failed' or status == 'timeout') and score or nil
    result.mistakes = mistakes
    result.durationMs = duration
    result.grade = Schema.gradeFor(status, result.score, mistakes)
    result.metrics = { steps = #s.spec.steps, completed = completed, retries = s.retriesUsed or 0, failedRequired = failedRequired }
    result.steps = s.steps or {}
    return result
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
        return Session().finish(s, Sequence.aggregate(s, status, stepResult.reason))
    end
    if status ~= 'success' then
        if step.onFail == 'retry' and s.attempt <= step.retries then
            s.retriesUsed = s.retriesUsed + 1
            return later(s, function() Sequence.runStep(s) end)
        end
        if step.onFail ~= 'continue' then
            return Session().finish(s, Sequence.aggregate(s, 'failed', 'step_failed'))
        end
        if step.required then s.impossible = true end
    end
    if s.stepIndex >= #s.spec.steps then
        if s.impossible then return Session().finish(s, Sequence.aggregate(s, 'failed', 'step_failed')) end
        return Session().finish(s, Sequence.aggregate(s, 'success', 'completed'))
    end
    s.stepIndex = s.stepIndex + 1
    s.attempt = 0
    later(s, function() Sequence.runStep(s) end)
end

CortexMinigames.Sequence = Sequence
