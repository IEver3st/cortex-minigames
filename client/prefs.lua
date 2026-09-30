-- Player presentation/input preferences. Stored per client in a versioned, bounded KVP record.
-- When cortex-lib is running, its Settings tab is the source for volume, motion, scale and keys
-- (see client/cortex.lua); practice history always stays here.

CortexMinigames = CortexMinigames or {}

local Prefs = {}
local KVP_KEY = 'cortex-minigames:prefs'
local VERSION = 1
local KEY_ACTIONS = { up = true, down = true, left = true, right = true, primary = true, alt = true, prev = true, next = true, rotate = true }

local DEFAULTS = { v = VERSION, volume = 0.5, muted = false, motion = 'auto', scale = 1.0, keys = {}, practiced = {} }
local current

local function clamp(value, min, max, fallback)
    if type(value) ~= 'number' or value ~= value then return fallback end
    return math.min(max, math.max(min, value))
end

local function sanitize(raw)
    raw = type(raw) == 'table' and raw or {}
    local out = {
        v = VERSION,
        volume = clamp(raw.volume, 0, 1, DEFAULTS.volume),
        muted = raw.muted == true,
        motion = (raw.motion == 'reduced' or raw.motion == 'full') and raw.motion or 'auto',
        scale = clamp(raw.scale, 0.75, 1.5, 1.0),
        keys = {},
        practiced = {},
    }
    if type(raw.keys) == 'table' then
        for action, code in pairs(raw.keys) do
            if KEY_ACTIONS[action] and type(code) == 'string' and #code <= 32 and code:match('^%w+$') then out.keys[action] = code end
        end
    end
    if type(raw.practiced) == 'table' then
        for game in pairs(raw.practiced) do
            if CortexMinigames.Schema.games[game] then out.practiced[game] = true end
        end
    end
    return out
end

local function load()
    local raw = GetResourceKvpString(KVP_KEY)
    local ok, decoded = pcall(json.decode, raw or '{}')
    current = sanitize(ok and decoded or nil)
end

local function save()
    SetResourceKvp(KVP_KEY, json.encode(current))
end

function Prefs.get()
    if not current then load() end
    return current
end

--- Effective presentation prefs: cortex-lib values override local ones when the adapter is live.
function Prefs.effective()
    local base = Prefs.get()
    local overrides = CortexMinigames.Cortex and CortexMinigames.Cortex.values() or nil
    local out = { volume = base.volume, muted = base.muted, motion = base.motion, scale = base.scale, keys = {} }
    for action, code in pairs(base.keys) do out.keys[action] = code end
    if overrides then
        out.volume = clamp(overrides.volume, 0, 1, out.volume)
        if type(overrides.muted) == 'boolean' then out.muted = overrides.muted end
        if overrides.motion == 'auto' or overrides.motion == 'reduced' or overrides.motion == 'full' then out.motion = overrides.motion end
        out.scale = clamp(overrides.scale, 0.75, 1.5, out.scale)
        for action, code in pairs(overrides.keys or {}) do
            if KEY_ACTIONS[action] and type(code) == 'string' and code ~= '' and code:match('^%w+$') then out.keys[action] = code end
        end
    end
    return out
end

function Prefs.set(changes)
    local merged = Prefs.get()
    for key, value in pairs(changes) do merged[key] = value end
    current = sanitize(merged)
    save()
    return current
end

function Prefs.hasPracticed(game)
    return Prefs.get().practiced[game] == true
end

function Prefs.markPracticed(game)
    if not CortexMinigames.Schema.games[game] or Prefs.hasPracticed(game) then return end
    current.practiced[game] = true
    save()
end

function Prefs.reset()
    current = sanitize({ practiced = Prefs.get().practiced })
    save()
end

Prefs.KEY_ACTIONS = KEY_ACTIONS
CortexMinigames.Prefs = Prefs
