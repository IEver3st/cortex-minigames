-- Native input while a session owns focus. The browser is the authority for keyboard and mouse
-- (NUI focus captures them); this file is the authority for the controller, which NUI focus does
-- not capture. Pad edges are forwarded as abstract actions only while the last input device was
-- a pad, so one physical press never arrives twice. Runs only inside the session frame loop.

CortexMinigames = CortexMinigames or {}

local Input = {}
local held = {}
local lastAxes = { lx = 0.0, ly = 0.0, rt = 0.0 }
local lastAxesAt = 0

local function deadzone(value, zone)
    if math.abs(value) < zone then return 0.0 end
    local sign = value < 0 and -1 or 1
    return sign * (math.abs(value) - zone) / (1 - zone)
end

--- Suppress game controls for this frame: movement, camera, attack, phone, chat and pause.
function Input.suppress()
    DisableAllControlActions(0)
    DisableAllControlActions(2)
end

--- Poll the pad once. `emit(kind, action)` receives 'press'/'release'; `emitAxes(axes)` receives
--- analog changes (bounded to ~60 Hz and only when values move). Returns true when the pad asked
--- to cancel.
function Input.poll(emit, emitAxes, now)
    local usingPad = not IsUsingKeyboard(2)
    local cancel = false
    for _, entry in ipairs(Config.Pad.buttons) do
        local down = IsDisabledControlPressed(2, entry.control)
        if usingPad and down and not held[entry.action] then
            held[entry.action] = true
            if entry.action == 'cancel' then cancel = true else emit('press', entry.action) end
        elseif held[entry.action] and not down then
            held[entry.action] = nil
            if entry.action ~= 'cancel' then emit('release', entry.action) end
        end
    end
    if usingPad and now - lastAxesAt >= 16 then
        local zone = Config.Pad.deadzone
        local axes = {
            lx = deadzone(GetDisabledControlNormal(2, Config.Pad.axes.lx), zone),
            ly = deadzone(GetDisabledControlNormal(2, Config.Pad.axes.ly), zone),
            rt = math.max(0.0, GetDisabledControlNormal(2, Config.Pad.axes.rt)),
        }
        local eps = Config.Pad.axisEpsilon
        if math.abs(axes.lx - lastAxes.lx) > eps or math.abs(axes.ly - lastAxes.ly) > eps or math.abs(axes.rt - lastAxes.rt) > eps then
            lastAxes, lastAxesAt = axes, now
            emitAxes(axes)
        end
    end
    return cancel
end

--- Forget held pad state. Called on every session end so nothing stays pressed into the next one.
function Input.reset()
    held = {}
    lastAxes = { lx = 0.0, ly = 0.0, rt = 0.0 }
    lastAxesAt = 0
end

CortexMinigames.Input = Input
