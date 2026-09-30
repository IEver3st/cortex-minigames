-- Structured, bounded logging. Off unless Config.Debug is true; each event key is rate limited so
-- repeated invalid input cannot flood the console. Never log player identifiers or payload bodies.

CortexMinigames = CortexMinigames or {}

local Log = {}
local WINDOW_MS, PER_WINDOW = 10000, 5
local buckets = {}

local function now()
    return GetGameTimer and GetGameTimer() or math.floor(os.clock() * 1000)
end

local function render(fields)
    if type(fields) ~= 'table' then return '' end
    local parts = {}
    for key, value in pairs(fields) do
        local kind = type(value)
        if kind == 'string' or kind == 'number' or kind == 'boolean' then
            parts[#parts + 1] = ('%s=%s'):format(key, tostring(value):sub(1, 64))
        end
        if #parts >= 12 then break end
    end
    table.sort(parts)
    return table.concat(parts, ' ')
end

---@param level 'info'|'warn'|'error'
---@param event string stable event key, e.g. 'session.finish'
---@param fields table<string, string|number|boolean>?
function Log.write(level, event, fields, force)
    if not force and not (Config and Config.Debug) then return end
    local t = now()
    local bucket = buckets[event]
    if not bucket or t - bucket.start > WINDOW_MS then
        bucket = { start = t, count = 0, dropped = 0 }
        buckets[event] = bucket
    end
    bucket.count = bucket.count + 1
    if bucket.count > PER_WINDOW then
        bucket.dropped = bucket.dropped + 1
        return
    end
    local colour = level == 'error' and '^1' or level == 'warn' and '^3' or '^5'
    print(('%s[cortex-minigames]^7 %s %s'):format(colour, event, render(fields)))
end

function Log.info(event, fields) Log.write('info', event, fields) end
function Log.warn(event, fields) Log.write('warn', event, fields) end
--- Errors print even with Debug off, still rate limited.
function Log.error(event, fields) Log.write('error', event, fields, true) end

CortexMinigames.Log = Log
