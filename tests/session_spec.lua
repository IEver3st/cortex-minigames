local H = dofile('tests/support.lua')
H.loadClient()
local S = CortexMinigames.Session

local gen = H.call('boot', {}).data.gen

-- Helpers: start via the Begin export as a named caller, and drive the UI handshake.
local function begin(owner, options)
    H.invoking = owner
    local results = {}
    local response = H.exports.Begin(options, function(result) results[#results + 1] = result end)
    H.invoking = nil
    return response, results
end

local function open()
    return H.last('open')
end

local function ready(msg, extra)
    local data = { protocol = 1, gen = gen, sid = msg.sid, ok = true, timeoutMs = 6000 }
    for k, v in pairs(extra or {}) do data[k] = v end
    return H.call('ready', data)
end

local function began(msg) return H.call('began', { protocol = 1, gen = gen, sid = msg.sid, practiced = true }) end

local function complete(msg, fields)
    local data = { protocol = 1, gen = gen, sid = msg.sid, status = 'success', reason = 'completed', score = 90, grade = 'good', mistakes = 0, durationMs = 1200, metrics = { hits = 1 } }
    for k, v in pairs(fields or {}) do data[k] = v end
    return H.call('complete', data)
end

-- 1. Happy path: focus only after ready, one result, focus released, no leftover thread.
local response, results = begin('caller-a', { game = 'timing', preset = 'normal' })
H.eq(response.accepted, true, 'accepted')
local msg = open()
H.eq(msg.spec.game, 'timing', 'open sent')
H.eq(H.focus.focused, false, 'no focus before ready')
H.eq(ready(msg).ok, true, 'ready acked')
H.eq(H.focus.focused, true, 'focus after ready')
H.eq(H.focus.keepInput, false, 'keep-input off')
H.ok(H.last('start').sid == msg.sid, 'start sent')
H.eq(began(msg).ok, true, 'began acked')
H.eq(complete(msg).ok, true, 'complete acked')
H.eq(#results, 1, 'one result')
H.eq(results[1].status, 'success', 'success delivered')
H.eq(results[1].sessionId, response.sessionId, 'session id matches')
H.eq(results[1].apiVersion, 1, 'api version')
H.eq(H.focus.focused, false, 'focus released')
H.tick(100)
H.eq(H.threadCount(), 0, 'frame loop ended')
H.ok(CortexMinigames.Prefs.hasPracticed('timing'), 'practice recorded')

-- 2. Overlapping starts: second caller is rejected busy; nothing is replaced or queued.
local first, firstResults = begin('caller-a', { game = 'timing' })
local second = begin('caller-b', { game = 'pressure' })
H.eq(first.accepted, true, 'first accepted')
H.eq(second.accepted, false, 'second rejected')
H.eq(second.result.reason, 'busy', 'busy reason')
H.eq(second.result.sessionId, nil, 'no session id for rejection')

-- 3. Ownership: an unrelated caller cannot cancel; the owner can; cancel is idempotent.
H.invoking = 'caller-b'
local ok, why = H.exports.Cancel(first.sessionId)
H.eq(ok, false, 'unrelated cancel rejected'); H.eq(why, 'not_owner', 'not_owner')
H.invoking = 'caller-a'
H.eq(H.exports.Cancel(first.sessionId), true, 'owner cancel')
local again, detail = H.exports.Cancel(first.sessionId)
H.eq(again, true, 'second cancel ok'); H.eq(detail, 'already_finished', 'idempotent')
H.invoking = nil
H.eq(#firstResults, 1, 'cancel delivers once')
H.eq(firstResults[1].reason, 'caller_cancelled', 'caller_cancelled')
H.eq(H.last('close').reason, 'caller_cancelled', 'UI told to close')

-- 4. Race: completion, cancel and deadline in the same turn → one terminal result, one cleanup.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
local focusCalls = H.focus.calls
complete(msg)
local cancelReply = H.call('cancel', { protocol = 1, gen = gen, sid = msg.sid })
H.eq(cancelReply.ok, false, 'late cancel is stale')
H.time = H.time + 60000
H.tick(20)
H.eq(#results, 1, 'exactly one result under race')
H.eq(H.focus.calls, focusCalls + 1, 'focus released exactly once')

-- 5. Readiness: no ready → startup timeout, error, and focus never taken.
response, results = begin('caller-a', { game = 'timing' })
H.tick(Config.Session.startupTimeoutMs + 100)
H.eq(results[1] and results[1].reason, 'ui_startup_timeout', 'startup timeout')
H.eq(results[1].status, 'error', 'startup timeout is an error')
H.eq(H.focus.focused, false, 'focus never taken')

-- 6. Stale messages: old generation or old sid never affect a new game.
response, results = begin('caller-a', { game = 'timing' })
msg = open()
H.eq(H.call('ready', { protocol = 1, gen = gen + 1, sid = msg.sid, ok = true, timeoutMs = 6000 }).ok, false, 'old generation ignored')
H.eq(H.call('ready', { protocol = 1, gen = gen, sid = 'cmg-0-0', ok = true, timeoutMs = 6000 }).ok, false, 'old sid ignored')
H.eq(H.call('ready', { protocol = 2, gen = gen, sid = msg.sid, ok = true, timeoutMs = 6000 }).ok, false, 'other protocol ignored')
H.eq(H.focus.focused, false, 'still unfocused')
H.eq(ready(msg).ok, true, 'current ready accepted')
H.eq(H.call('complete', { protocol = 1, gen = gen, sid = msg.sid, status = 'success', reason = 'completed', grade = 'pass', mistakes = 0, durationMs = 10 }).ok, false, 'complete before began is stale')
began(msg)
complete(msg)
H.eq(results[1].status, 'success', 'new game unaffected')

-- 7. UI-side validation failure → rejected before focus.
response, results = begin('caller-a', { game = 'timing' })
msg = open()
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = false, reason = 'invalid_params', field = 'params', message = 'window_too_fast' })
H.eq(results[1].status, 'rejected', 'contradiction rejected')
H.eq(results[1].reason, 'invalid_params', 'invalid_params')
H.eq(H.focus.focused, false, 'no focus for invalid config')

-- 8. A malformed report becomes an error, never a success.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.eq(complete(msg, { grade = 'perfect', score = 10 }).ok, false, 'contradictory report refused')
H.eq(results[1].reason, 'invalid_report', 'invalid_report')

-- 9. Hard deadline if the UI never reports (render stall, crash).
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.tick(6000 + Config.Session.hardGraceMs + 50)
H.eq(results[1].status, 'timeout', 'hard deadline'); H.eq(results[1].reason, 'hard_deadline', 'hard_deadline reason')

-- 10. Escape: cancel by default, failure when the caller asks, never a trap.
response, results = begin('caller-a', { game = 'timing', cancel = { escape = 'fail' } })
msg = open(); ready(msg); began(msg)
H.call('cancel', { protocol = 1, gen = gen, sid = msg.sid })
H.eq(results[1].status, 'failed', 'escape fails when asked'); H.eq(results[1].reason, 'abandoned', 'abandoned')
H.eq(H.focus.focused, false, 'focus released after escape')

-- 11. Pad B cancels through native input.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.tick(5) -- B goes down after the session opened
H.usingKeyboard = false
H.padDown = { [202] = true }
H.tick(20)
H.padDown, H.usingKeyboard = nil, nil
H.eq(results[1] and results[1].reason, 'player_cancelled', 'pad cancel')

-- 12. Context: death and leaving the radius cancel.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.dead = true
H.tick(Config.Session.contextIntervalMs + 20)
H.dead = false
H.eq(results[1] and results[1].reason, 'player_died', 'death cancels')
response, results = begin('caller-a', { game = 'timing', cancel = { radius = { x = 0, y = 0, z = 0, maxDistance = 3 } } })
msg = open(); ready(msg); began(msg)
H.coords = { x = 10.0, y = 0.0, z = 0.0 }
H.tick(Config.Session.contextIntervalMs + 20)
H.coords = nil
H.eq(results[1] and results[1].reason, 'left_area', 'radius cancels')

-- 13. Caller stop, logout and UI reload.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg)
TriggerEvent('onClientResourceStop', 'caller-a')
H.eq(results[1] and results[1].reason, 'caller_stopped', 'caller stop')
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg)
TriggerEvent('QBCore:Client:OnPlayerUnload')
H.eq(results[1] and results[1].reason, 'logged_out', 'logout')
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.call('boot', {})
H.eq(results[1] and results[1].reason, 'ui_error', 'UI reload fails closed')

-- 14. Foreign NUI focus is never stolen.
H.foreignFocus = true
response = begin('caller-a', { game = 'timing' })
H.foreignFocus = false
H.eq(response.result.reason, 'focus_unavailable', 'foreign focus respected')

-- 15. Practice idle ends the session without charging play.
CortexMinigames.Prefs.get().practiced.pressure = nil
response, results = begin('caller-a', { game = 'pressure' })
msg = open()
H.eq(msg.spec.practice, true, 'first use shows practice')
ready(msg)
H.tick(Config.Session.practiceTimeoutMs + CortexMinigames.Schema.PRACTICE_GRACE_MS + 50)
H.eq(results[1] and results[1].reason, 'practice_idle', 'practice idle')

-- 16. Invalid options are rejected synchronously with actionable detail.
response = begin('caller-a', { game = 'timing', params = { rounds = 99 } })
H.eq(response.accepted, false, 'invalid rejected')
H.eq(response.result.reason, 'invalid_params', 'invalid_params')
H.eq(response.result.error.field, 'rounds', 'field reported')

-- 17. 50 open/close cycles leave nothing behind.
for i = 1, 50 do
    response, results = begin('caller-a', { game = 'timing' })
    msg = open(); ready(msg); began(msg)
    if i % 2 == 0 then complete(msg) else H.call('cancel', { protocol = 1, gen = gen, sid = msg.sid }) end
    H.tick(10)
    H.eq(#results, 1, 'cycle result ' .. i)
end
H.eq(S.active(), nil, 'no active session')
H.eq(H.focus.focused, false, 'no focus held')
H.eq(H.threadCount(), 0, 'no frame loop left')

-- 18. IsBusy exposes only safe metadata to non-owners.
response = begin('caller-a', { game = 'timing' })
H.invoking = 'caller-b'
local busy, meta = H.exports.IsBusy()
H.eq(busy, true, 'busy')
H.eq(meta.sessionId, nil, 'no id for other callers')
H.invoking = 'caller-a'
busy, meta = H.exports.IsBusy()
H.eq(meta.sessionId, response.sessionId, 'owner sees id')
H.exports.Cancel(response.sessionId)
H.invoking = nil

-- 19. Pointer-gesture games take the cursor in auto mode even in a compact slip; others do not.
response, results = begin('caller-a', { game = 'trace' })
msg = open(); ready(msg)
H.eq(H.focus.cursor, true, 'trace (catalog cursor) shows the cursor')
H.invoking = 'caller-a'; H.exports.Cancel(response.sessionId); H.invoking = nil
H.tick(10)
response, results = begin('caller-a', { game = 'mash' })
msg = open(); ready(msg)
H.eq(H.focus.cursor, false, 'compact keyboard game keeps the cursor hidden')
H.invoking = 'caller-a'; H.exports.Cancel(response.sessionId); H.invoking = nil
H.tick(10)
response, results = begin('caller-a', { game = 'trace', inputMode = 'keyboard' })
msg = open(); ready(msg)
H.eq(H.focus.cursor, false, 'explicit keyboard mode never shows the cursor')
H.invoking = 'caller-a'; H.exports.Cancel(response.sessionId); H.invoking = nil
H.invoking = nil
H.tick(10)

local function cancelAs(owner, id) H.invoking = owner; H.exports.Cancel(id); H.invoking = nil; H.tick(10) end

-- 20. A UI-side refusal carries the UI's rule code as error.message.
response, results = begin('caller-a', { game = 'timing' })
msg = open()
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = false, reason = 'invalid_params', field = 'params', message = 'time_budget_too_short' })
H.eq(results[1].error and results[1].error.message, 'time_budget_too_short', 'rule code reaches error.message')
H.eq(results[1].error and results[1].error.field, 'params', 'field reported')
response, results = begin('caller-a', { game = 'timing' })
msg = open()
H.call('ready', { protocol = 1, gen = gen, sid = msg.sid, ok = false, reason = 'generation_failed', field = '', message = 'challenge generation failed' })
H.eq(results[1].status, 'error', 'generation failure is an error')
H.eq(results[1].error and results[1].error.field, 'params', 'empty field falls back to params')

-- 21. Practice confirmed in the last moment still plays its cue and starts.
CortexMinigames.Prefs.get().practiced.pressure = nil
response, results = begin('caller-a', { game = 'pressure' })
msg = open(); ready(msg)
H.tick(Config.Session.practiceTimeoutMs - 100) -- confirm lands at the edge; the 650 ms cue follows
H.tick(650)
H.eq(#results, 0, 'late confirm is not practice_idle')
H.eq(began(msg).ok, true, 'began after late confirm accepted')
complete(msg, { durationMs = 1600 })
H.eq(results[1] and results[1].status, 'success', 'late-confirmed practice plays')

-- 22. Stalls reported by the UI extend the hard deadline: cumulative, monotonic, capped per run.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
local function stall(ms) return H.call('stall', { protocol = 1, gen = gen, sid = msg.sid, stalledMs = ms }) end
H.eq(stall(2000).ok, true, 'stall accepted')
H.eq(stall(2000).ok, true, 'repeat of the same total is harmless')
H.eq(stall(1000).ok, false, 'decreasing total refused')
H.eq(stall(1.5).ok, false, 'non-integer refused')
H.tick(6000 + Config.Session.hardGraceMs + 500)
H.eq(#results, 0, 'stall time does not count against the run')
H.tick(1600)
H.eq(results[1] and results[1].reason, 'hard_deadline', 'extended deadline still ends the run')
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
stall(60000)
H.tick(6000 + Config.Session.hardGraceMs + 6000 + 50)
H.eq(results[1] and results[1].reason, 'hard_deadline', 'extension capped at the run timeout')
H.eq(H.call('stall', { protocol = 1, gen = gen, sid = msg.sid, stalledMs = 1 }).ok, false, 'stall after the run is stale')

-- 23. UI fault ({ sid, message }) ends the run as error/ui_error.
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
H.eq(H.call('fault', { protocol = 1, gen = gen, sid = msg.sid, message = 'TypeError: x is undefined\nat game.ts' }).ok, true, 'fault acked')
H.eq(results[1] and results[1].reason, 'ui_error', 'fault ends as ui_error')
H.eq(H.focus.focused, false, 'focus released after fault')

-- 24. Boot is safe to repeat while idle and while a run is still preparing.
local again1, again2 = H.call('boot', {}), H.call('boot', {})
H.eq(again1.ok and again2.ok, true, 'repeated boot acked')
H.eq(again2.data.gen, gen, 'generation unchanged')
response, results = begin('caller-a', { game = 'timing' })
msg = open()
H.call('boot', {})
H.eq(#results, 0, 'boot before ready keeps the run')
ready(msg); began(msg); complete(msg)
H.eq(results[1] and results[1].status, 'success', 'session after repeated boots works')

-- 25. Pad: a button held when the session opens never presses until released and pressed again.
local function inputs(from)
    local out = {}
    for i = from + 1, #H.sent do if H.sent[i].type == 'input' then out[#out + 1] = H.sent[i].kind .. ':' .. H.sent[i].action end end
    return table.concat(out, ',')
end
H.usingKeyboard = false
H.padDown = { [201] = true, [202] = true }
response, results = begin('caller-a', { game = 'timing' })
msg = open(); ready(msg); began(msg)
local mark = #H.sent
H.tick(20)
H.eq(inputs(mark), '', 'held A and B ignored at open')
H.eq(#results, 0, 'held B does not cancel')
H.padDown = {}
H.tick(20)
H.eq(inputs(mark), '', 'release of a seeded button sends nothing')
H.padDown = { [201] = true }
H.tick(20)
H.eq(inputs(mark), 'press:primary', 'fresh press after release counts')
H.padDown = nil
cancelAs('caller-a', response.sessionId)

-- 26. Pad: sticks return to neutral when the keyboard takes over, and on session end.
local stick = 0.0
local realNormal = GetDisabledControlNormal
GetDisabledControlNormal = function(_, control) return control == Config.Pad.axes.lx and stick or 0.0 end
local function lastAxes() for i = #H.sent, 1, -1 do if H.sent[i].type == 'axes' then return H.sent[i] end end end
response, results = begin('caller-a', { game = 'pressure' })
msg = open(); ready(msg); began(msg)
stick = 1.0; H.tick(40)
H.eq(lastAxes().lx, 1.0, 'stick sent')
H.usingKeyboard = true; H.tick(40)
H.eq(lastAxes().lx, 0.0, 'keyboard takeover centres the stick')
H.usingKeyboard = false; H.tick(40)
H.eq(lastAxes().lx, 1.0, 'pad again resends the held stick')
cancelAs('caller-a', response.sessionId)
H.eq(lastAxes().lx, 0.0, 'session end centres the stick')
GetDisabledControlNormal, H.usingKeyboard = realNormal, nil

-- 27. /mgprefs key: only real, unreserved KeyboardEvent codes; replies say what happened.
local said = {}
H.events['chat:addMessage'] = { function(m) said[#said + 1] = m.args[2] end }
local mgprefs = H.commands[Config.PreferenceCommand]
local P = CortexMinigames.Prefs
mgprefs(0, { 'key', 'primary', 'KeyG' })
H.eq(P.get().keys.primary, 'KeyG', 'valid key stored')
H.ok(said[#said]:find('^Saved') and said[#said]:find('swap'), 'success reply mentions swap')
for _, code in ipairs({ 'Escape', 'Backspace', 'Enter', 'ArrowUp' }) do
    mgprefs(0, { 'key', 'up', code })
    H.ok(said[#said]:find('reserved'), code .. ' refused as reserved')
end
for _, code in ipairs({ 'KeyGG', 'F13', 'g', string.rep('A', 40), 'Numpad10' }) do
    mgprefs(0, { 'key', 'alt', code })
    H.eq(said[#said]:find('^Saved'), nil, code .. ' refused')
end
H.eq(P.get().keys.up, nil, 'reserved key not stored'); H.eq(P.get().keys.alt, nil, 'invalid key not stored')
for _, code in ipairs({ 'Digit0', 'Numpad9', 'F12', 'F1', 'Space', 'ControlRight', 'Backquote', 'CapsLock' }) do
    mgprefs(0, { 'key', 'alt', code })
    H.eq(P.get().keys.alt, code, code .. ' accepted')
end
mgprefs(0, { 'key', 'cancel', 'KeyG' })
H.ok(said[#said]:find('Unknown action'), 'cancel is not rebindable')
mgprefs(0, { 'volume', '5' })
H.eq(said[#said]:find('^Saved'), nil, 'out-of-range volume not reported as saved')
H.eq(P.get().keys.primary, 'KeyG', 'earlier binding intact')
P.set({ keys = { up = 'Escape', down = 'ArrowDown', primary = 'KeyE' } })
H.eq(P.get().keys.up, nil, 'stored reserved keys are dropped on load')
H.eq(P.get().keys.primary, 'KeyE', 'valid stored keys kept')
mgprefs(0, { 'reset' })

H.done('session_spec')
