local H = dofile('tests/support.lua')
H.loadShared()
local S = CortexMinigames.Schema

-- Every catalog game and preset validates.
for _, game in ipairs(S.catalog.games) do
    for _, preset in ipairs(S.catalog.presets) do
        local spec, problem = S.normalizeOptions({ game = game.id, preset = preset }, 'client')
        H.ok(spec, ('%s/%s valid (%s)'):format(game.id, preset, problem and problem.message or ''))
    end
end
H.eq(#S.catalog.games, 13, 'twelve games plus qte in catalog')
H.ok(S.games.trace.cursor == true and S.games.mash.cursor == false, 'catalog marks pointer-gesture games')

-- Params: unknown keys, types and bounds are rejected before any focus.
local _, p = S.normalizeOptions({ game = 'timing', params = { speed = 1 } }, 'client')
H.eq(p.reason, 'invalid_params', 'unknown param rejected')
_, p = S.normalizeOptions({ game = 'timing', params = { rounds = 2.5 } }, 'client')
H.eq(p.reason, 'invalid_params', 'non-integer rejected')
_, p = S.normalizeOptions({ game = 'timing', params = { window = 9 } }, 'client')
H.eq(p.field, 'window', 'out of range field named')
_, p = S.normalizeOptions({ game = 'nope' }, 'client')
H.eq(p.reason, 'unknown_game', 'unknown game')
_, p = S.normalizeOptions({ game = 'timing', preset = 'insane' }, 'client')
H.eq(p.reason, 'invalid_options', 'unknown preset')
_, p = S.normalizeOptions({ game = 'timing', colour = 'red' }, 'client')
H.eq(p.reason, 'invalid_options', 'unknown option rejected')
_, p = S.normalizeOptions({ game = 'timing', timeoutMs = 5 }, 'client')
H.eq(p.field, 'timeoutMs', 'timeout bounds')
_, p = S.normalizeOptions({ game = 'timing', title = 'bad\nline' }, 'client')
H.eq(p.field, 'title', 'control characters rejected')
_, p = S.normalizeOptions({ game = 'timing', title = string.rep('x', 65) }, 'client')
H.eq(p.field, 'title', 'title length bound')
local spec = S.normalizeOptions({ game = 'timing', titleKey = 'repair.breaker' }, 'client')
H.eq(spec.title, 'Reset the breaker', 'locale key resolves')

-- QTE prompts are data only: allowlisted actions and fields, nothing executable.
_, p = S.normalizeOptions({ game = 'qte', params = { prompts = { { type = 'press', actions = { 'cancel' }, windowMs = 900 } } } }, 'client')
H.eq(p.reason, 'invalid_params', 'cancel is not a QTE action')
_, p = S.normalizeOptions({ game = 'qte', params = { prompts = { { type = 'press', actions = { 'primary' }, windowMs = 900, onHit = 'os.exit()' } } } }, 'client')
H.eq(p.reason, 'invalid_params', 'unknown prompt field rejected')
_, p = S.normalizeOptions({ game = 'qte', params = { prompts = { { type = 'hold', actions = { 'primary' }, windowMs = 900 } } } }, 'client')
H.eq(p.reason, 'invalid_params', 'hold requires durationMs')
local prompts = {}
for i = 1, 9 do prompts[i] = { type = 'press', actions = { 'primary' }, windowMs = 900 } end
_, p = S.normalizeOptions({ game = 'qte', params = { prompts = prompts } }, 'client')
H.eq(p.reason, 'invalid_params', 'prompt count bounded')
spec = S.normalizeOptions({ game = 'qte', params = { prompts = { { type = 'chord', actions = { 'prev', 'next' }, windowMs = 1200, toleranceMs = 150 } } } }, 'client')
H.ok(spec, 'chord prompt valid')

-- Input capability is checked before focus.
_, p = S.normalizeOptions({ game = 'timing', inputMode = 'joystick' }, 'client')
H.eq(p.reason, 'invalid_options', 'unknown input mode')

-- Escape can become a failure but never be disabled; entity and function rules are client-only.
_, p = S.normalizeOptions({ game = 'timing', cancel = { escape = false } }, 'client')
H.eq(p.field, 'cancel.escape', 'escape cannot be disabled')
spec = S.normalizeOptions({ game = 'timing', cancel = { escape = 'fail', death = false } }, 'client')
H.eq(spec.cancel.escape, 'fail', 'escape can fail the attempt')
H.eq(spec.cancel.death, false, 'death rule optional')
_, p = S.normalizeOptions({ game = 'timing', cancel = { entity = 42 } }, 'server')
H.eq(p.field, 'cancel.entity', 'entity handles rejected on server')
_, p = S.normalizeOptions({ game = 'timing', cancel = { check = function() end } }, 'server')
H.eq(p.field, 'cancel.check', 'functions rejected on server')
spec = S.normalizeOptions({ game = 'timing', cancel = { radius = { x = 1, y = 2, z = 3, maxDistance = 4 } } }, 'server')
H.eq(spec.cancel.radius.maxDistance, 4.0, 'radius accepted')

-- Presentation defaults follow the game.
spec = S.normalizeOptions({ game = 'circuit_route' }, 'client')
H.eq(spec.presentation.mode, 'focused', 'focused default')
H.eq(spec.presentation.anchor, 'center', 'centre anchor')

-- Operator allowlist.
Config.Bounds.allowedGames = { timing = true }
_, p = S.normalizeOptions({ game = 'pressure' }, 'client')
H.eq(p.reason, 'unknown_game', 'operator allowlist enforced')
Config.Bounds.allowedGames = {}

-- Sequences: bounded, linear, unique ids, bounded retries.
local seq = S.normalizeSequence({ steps = { { game = 'sequence' }, { game = 'circuit_route', onFail = 'retry', retries = 2 }, { game = 'pressure', onFail = 'continue', required = false } } }, 'client')
H.ok(seq, 'sequence valid')
H.eq(seq.steps[2].retries, 2, 'retries kept')
H.eq(seq.steps[1].onFail, 'stop', 'default stop')
H.eq(seq.steps[3].required, false, 'optional step')
_, p = S.normalizeSequence({ steps = { { game = 'timing', onFail = 'retry', retries = 9 } } }, 'client')
H.eq(p.reason, 'invalid_sequence', 'retries bounded')
_, p = S.normalizeSequence({ steps = { { game = 'timing', id = 'a' }, { game = 'timing', id = 'a' } } }, 'client')
H.eq(p.reason, 'invalid_sequence', 'duplicate ids rejected')
_, p = S.normalizeSequence({ steps = { { game = 'timing', ['goto'] = 1 } } }, 'client')
H.eq(p.reason, 'invalid_sequence', 'no jumps: unknown step key rejected')
local many = {}
for i = 1, 9 do many[i] = { game = 'timing' } end
_, p = S.normalizeSequence({ steps = many }, 'client')
H.eq(p.reason, 'invalid_sequence', 'step count bounded')
_, p = S.normalizeSequence({ steps = { { game = 'timing', params = { rounds = 0 } } } }, 'client')
H.eq(p.field, 'steps[1].rounds', 'step param errors are located')

-- Server → client round trip: the client re-validates plain options to the same spec.
local original = S.normalizeOptions({ game = 'signal_lock', preset = 'hard', seed = 7, title = 'Tune', cancel = { radius = { x = 1, y = 2, z = 3, maxDistance = 5 } } }, 'server')
local again = S.normalizeOptions(S.toOptions(original), 'server')
H.eq(again.seed, 7, 'seed survives')
H.eq(again.title, 'Tune', 'title survives')
H.eq(again.params.channels, original.params.channels, 'params survive')
H.eq(again.cancel.radius.maxDistance, 5.0, 'radius survives')
local seqAgain = S.normalizeSequence(S.toOptions(seq), 'server')
H.eq(#seqAgain.steps, 3, 'sequence survives')
H.eq(seqAgain.steps[2].retries, 2, 'sequence retries survive')

-- Reports: statuses, reasons, grades and metrics are checked against the catalog.
local report = S.normalizeReport({ status = 'success', reason = 'completed', score = 88, grade = 'good', mistakes = 1, durationMs = 900, metrics = { hits = 1, bogus = 5, accuracy = 'x' } }, 'sid', 'timing', 6000)
H.ok(report, 'valid report')
H.eq(report.metrics.bogus, nil, 'unknown metric stripped')
H.eq(report.metrics.accuracy, nil, 'mistyped metric stripped')
H.eq(report.metrics.hits, 1, 'allowed metric kept')
_, p = S.normalizeReport({ status = 'success', reason = 'completed', score = 60, grade = 'perfect', mistakes = 0, durationMs = 900 }, 'sid', 'timing', 6000)
H.eq(p.field, 'grade', 'perfect grade needs a perfect score')
_, p = S.normalizeReport({ status = 'failed', reason = 'missed', score = 60, grade = 'good', mistakes = 1, durationMs = 900 }, 'sid', 'timing', 6000)
H.eq(p.field, 'grade', 'failed attempt cannot grade good')
_, p = S.normalizeReport({ status = 'success', reason = 'missed', grade = 'pass', mistakes = 0, durationMs = 900 }, 'sid', 'timing', 6000)
H.eq(p.field, 'reason', 'reason must belong to status')
_, p = S.normalizeReport({ status = 'cancelled', reason = 'player_cancelled', durationMs = 0, mistakes = 0 }, 'sid', 'timing', 6000)
H.eq(p.field, 'status', 'UI cannot report cancellation directly')
_, p = S.normalizeReport({ status = 'success', reason = 'completed', grade = 'pass', mistakes = 0, durationMs = 999999 }, 'sid', 'timing', 6000)
H.eq(p.field, 'durationMs', 'duration bounded by timeout')
_, p = S.normalizeReport({ status = 'success', reason = 'completed', score = 101, grade = 'pass', mistakes = 0, durationMs = 5 }, 'sid', 'timing', 6000)
H.eq(p.field, 'score', 'score bounded')
-- Cancelled, error and rejected reports never carry a score.
for _, status in ipairs({ 'cancelled', 'error', 'rejected' }) do
    local reason = ({ cancelled = 'player_cancelled', error = 'ui_error', rejected = 'busy' })[status]
    report = S.normalizeReport({ status = status, reason = reason, score = 100, grade = 'perfect', durationMs = 0 }, 'sid', 'timing', 6000, { [status] = true })
    H.eq(report.score, nil, status .. ' score dropped'); H.eq(report.grade, nil, status .. ' grade dropped')
end

-- cancel.maxDistance only works with an entity; alone it is a mistake, not a silent no-op.
_, p = S.normalizeOptions({ game = 'timing', cancel = { maxDistance = 3 } }, 'client')
H.eq(p and p.field, 'cancel.maxDistance', 'maxDistance without entity rejected')
H.eq(p and p.message, 'maxDistance needs entity', 'maxDistance message')
spec = S.normalizeOptions({ game = 'timing', cancel = { entity = 42, maxDistance = 3 } }, 'client')
H.eq(spec.cancel.maxDistance, 3.0, 'maxDistance with entity accepted')

-- Locale keys resolve to text under the same limits as literal title / instruction.
CortexMinigames.Locales.en.keys['test.long'] = string.rep('x', 65)
CortexMinigames.Locales.en.keys['test.longer'] = string.rep('x', 141)
_, p = S.normalizeOptions({ game = 'timing', titleKey = 'test.long' }, 'server')
H.eq(p and p.field, 'titleKey', 'titleKey text over 64 bytes rejected')
_, p = S.normalizeOptions({ game = 'timing', instructionKey = 'test.longer' }, 'server')
H.eq(p and p.field, 'instructionKey', 'instructionKey text over 140 bytes rejected')
spec = S.normalizeOptions({ game = 'timing', instructionKey = 'test.long' }, 'server')
H.ok(spec, '65-byte instruction text fits')

-- Operator config: allowedGames in list or set form; timeout bounds clamped to what the UI honours.
local printed, realPrint = {}, print
print = function(line) printed[#printed + 1] = line end
Config.Bounds.allowedGames = { 'timing', 'pressure' }
S.normalizeConfig()
H.ok(S.normalizeOptions({ game = 'pressure' }, 'client'), 'list form allows listed game')
_, p = S.normalizeOptions({ game = 'trace' }, 'client')
H.eq(p and p.reason, 'unknown_game', 'list form blocks the rest')
Config.Bounds.allowedGames = { timing = true }
S.normalizeConfig()
_, p = S.normalizeOptions({ game = 'pressure' }, 'client')
H.eq(p and p.reason, 'unknown_game', 'set form still works')
Config.Bounds.allowedGames = {}
S.normalizeConfig()
H.eq(#printed, 0, 'valid config prints nothing')
Config.Bounds.maxTimeoutMs, Config.Bounds.minTimeoutMs = 300000, 10
S.normalizeConfig()
H.eq(Config.Bounds.maxTimeoutMs, 180000, 'maxTimeoutMs clamped to the UI cap')
H.eq(Config.Bounds.minTimeoutMs, 1000, 'minTimeoutMs clamped to 1000')
H.eq(#printed, 1, 'one warning printed')
print = realPrint

-- Budgets: custom params have no catalog default, so they budget at the maximum.
local game = S.games.timing
H.eq(S.estimateTimeout(S.normalizeOptions({ game = 'timing' }, 'server')), game.defaultTimeoutMs.normal, 'preset default')
local custom = S.normalizeOptions({ game = 'timing', params = { rounds = 5, cyclesPerSec = 0.2 } }, 'server')
H.eq(S.estimateTimeout(custom), Config.Bounds.maxTimeoutMs, 'custom params budget at max')
H.eq(S.estimateTimeout(S.normalizeOptions(S.toOptions(custom), 'server')), Config.Bounds.maxTimeoutMs, 'custom survives round trip')
local samePreset = S.normalizeOptions(S.toOptions(S.normalizeOptions({ game = 'timing' }, 'server')), 'server')
H.eq(S.estimateTimeout(samePreset), game.defaultTimeoutMs.normal, 'preset params after round trip are not custom')
local cs = Config.Session
local one = S.normalizeSequence({ feedbackMs = 1000, steps = { { game = 'timing', timeoutMs = 5000 } } }, 'server')
H.eq(S.budgetMs(one), S.HANDSHAKE_MS + cs.practiceTimeoutMs + S.PRACTICE_GRACE_MS + 5000 + cs.hardGraceMs + 1000 + cs.stepGapMs, 'step budget counts practice, feedback and gap')
local never = S.normalizeSequence({ practice = 'never', steps = { { game = 'timing', timeoutMs = 5000, onFail = 'retry', retries = 2 } } }, 'server')
H.eq(S.budgetMs(never), 3 * (S.HANDSHAKE_MS + S.READY_MS + 5000 + cs.hardGraceMs + cs.defaultFeedbackMs + cs.stepGapMs), 'per attempt, no practice when never')
H.eq(S.budgetMs(S.normalizeSequence({ deadlineMs = 4000, steps = { { game = 'timing' } } }, 'server')), 4000, 'caller deadline authoritative')
local big = { steps = {} }
for i = 1, 8 do big.steps[i] = { game = 'circuit_route', onFail = 'retry', retries = 3 } end
H.eq(S.budgetMs(S.normalizeSequence(big, 'server')), Config.Bounds.maxSequenceDeadlineMs, 'budget capped')

-- Sequence-level presentation is inherited by steps unless a step sets its own.
seq = S.normalizeSequence({ presentation = { mode = 'focused', anchor = 'center', scale = 1.2 }, steps = { { game = 'timing' }, { game = 'timing', presentation = { mode = 'compact' } } } }, 'client')
H.eq(seq.steps[1].presentation.mode, 'focused', 'step inherits mode')
H.eq(seq.steps[1].presentation.anchor, 'center', 'step inherits anchor')
H.eq(seq.steps[1].presentation.scale, 1.2, 'step inherits scale')
H.eq(seq.steps[2].presentation.mode, 'compact', 'step overrides mode')
H.eq(seq.steps[2].presentation.scale, 1.2, 'step keeps inherited scale')

-- Shared sequence aggregation.
local optional = S.normalizeSequence({ steps = { { game = 'timing', required = false, onFail = 'continue' }, { game = 'pressure', required = false, onFail = 'retry', retries = 1 } } }, 'client')
H.eq(S.sequenceCanSucceed(optional, {}), false, 'nothing played cannot succeed')
local failedOnly = { { status = 'failed', attempts = 1 }, { status = 'failed', attempts = 2 } }
H.eq(S.sequenceCanSucceed(optional, failedOnly), false, 'all-optional with no pass cannot succeed')
local agg = S.aggregateSequence('x', optional, { { status = 'success', score = 80, mistakes = 1, durationMs = 500, attempts = 1 }, { status = 'success', score = 91, mistakes = 0, durationMs = 700, attempts = 2 } }, 'success', 'completed')
H.eq(agg.score, 86, 'mean score rounded'); H.eq(agg.mistakes, 1, 'mistakes summed'); H.eq(agg.durationMs, 1200, 'durations summed')
H.eq(agg.metrics.retries, 1, 'retries from attempts'); H.eq(agg.grade, 'good', 'grade from score'); H.eq(agg.game, 'sequence', 'game sequence')

H.done('schema_spec')
