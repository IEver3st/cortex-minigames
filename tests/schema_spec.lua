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

H.done('schema_spec')
