-- Locale tables. `CortexMinigames.Locales.<code>` holds two maps:
--   keys: caller-facing strings resolved from `titleKey` / `instructionKey`
--   ui:   player-facing UI overrides sent to the NUI (headlines, reasons, hints, tutorials)

CortexMinigames = CortexMinigames or {}
CortexMinigames.Locales = CortexMinigames.Locales or {}

local Locale = {}
local MAX_UI_STRINGS, MAX_LENGTH = 200, 160

local function active()
    local locales = CortexMinigames.Locales
    return locales[Config and Config.Locale or 'en'] or locales.en or { keys = {}, ui = {} }
end

--- Resolve a caller key to text, or nil when unknown.
function Locale.key(key)
    if type(key) ~= 'string' or #key > 64 then return nil end
    local value = (active().keys or {})[key]
    return type(value) == 'string' and value or nil
end

--- Bounded UI override table for the NUI boot payload.
function Locale.ui()
    local out, count = {}, 0
    for key, value in pairs(active().ui or {}) do
        if type(key) == 'string' and #key <= 64 and type(value) == 'string' and #value <= MAX_LENGTH then
            out[key] = value
            count = count + 1
            if count >= MAX_UI_STRINGS then break end
        end
    end
    return out
end

CortexMinigames.Locale = Locale
