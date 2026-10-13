-- Cortex adapter. The only client file that knows about cortex-lib. Optional, including at startup.
-- When present, minigame preferences live in Cortex Settings
-- (exports registerSettings / getTabSetting, event cortex-lib:settingsChanged). Every call is
-- guarded so a missing or older cortex-lib simply leaves local preferences in charge.
-- Shared presentation uses the installed open library's own adapter, when it is readable.

CortexMinigames = CortexMinigames or {}

local Cortex = {}
local TAB = 'cortex-minigames'
local registered = false
local onChange = function() end

local KEY_OPTIONS = {
    { value = '', label = 'Default' },
    { value = 'KeyE', label = 'E' }, { value = 'KeyF', label = 'F' }, { value = 'KeyG', label = 'G' },
    { value = 'KeyQ', label = 'Q' }, { value = 'KeyR', label = 'R' }, { value = 'KeyT', label = 'T' },
    { value = 'KeyX', label = 'X' }, { value = 'KeyC', label = 'C' }, { value = 'KeyZ', label = 'Z' },
    { value = 'Space', label = 'Space' }, { value = 'ShiftLeft', label = 'Shift' }, -- Enter is reserved (Prefs.checkKey)
}

local FIELDS = {
    { key = 'volume', type = 'slider', label = 'Minigame volume', min = 0, max = 1, step = 0.05 },
    { key = 'muted', type = 'toggle', label = 'Mute minigame sounds' },
    { key = 'motion', type = 'select', label = 'Motion', description = 'Reduced removes decorative movement; timing stays the same.',
      options = { { value = 'auto', label = 'Follow system' }, { value = 'reduced', label = 'Reduced' }, { value = 'full', label = 'Full' } } },
    { key = 'scale', type = 'slider', label = 'Minigame size', min = 0.75, max = 1.5, step = 0.05 },
    { key = 'key_primary', type = 'select', label = 'Primary key', options = KEY_OPTIONS },
    { key = 'key_alt', type = 'select', label = 'Secondary key', options = KEY_OPTIONS },
    { key = 'key_prev', type = 'select', label = 'Previous / less', options = KEY_OPTIONS },
    { key = 'key_next', type = 'select', label = 'Next / more', options = KEY_OPTIONS },
    { key = 'key_rotate', type = 'select', label = 'Rotate', options = KEY_OPTIONS },
}
local DEFAULTS = { volume = 0.5, muted = false, motion = 'auto', scale = 1.0, key_primary = '', key_alt = '', key_prev = '', key_next = '', key_rotate = '' }

local function started()
    return GetResourceState('cortex-lib') == 'started'
end

local presentationLoaded, presentationFailed = false, false

local function presentationAvailable()
    if not started() or presentationFailed then return false end
    if presentationLoaded then return true end
    -- The equivalent of @cortex-lib/presentation-client.lua, without a mandatory dependency or
    -- missing-import errors on standalone servers. Load once into this consumer's environment:
    -- library exports must see this resource as their owner, not cortex-lib itself.
    local read, source = pcall(LoadResourceFile, 'cortex-lib', 'presentation-client.lua')
    if not read or type(source) ~= 'string' or source == '' then return false end
    local adapter, problem = load(source, '@cortex-lib/presentation-client.lua', 't', _ENV)
    if adapter then
        local ok
        ok, problem = pcall(adapter)
        presentationLoaded = ok
    end
    if not presentationLoaded then
        -- Do not repeat a partially executed adapter and duplicate its event/callback handlers.
        presentationFailed = true
        CortexMinigames.Log.warn('cortex.presentation_unavailable', { reason = tostring(problem) })
    end
    return presentationLoaded
end

local function notifyPresentation()
    SendNUIMessage({ action = 'cortex-minigames:presentationAvailability', available = presentationAvailable() })
end

-- The page may mount before Lua, or after the library's start event. This bounded readiness
-- handshake lets it discover the optional dependency without requesting missing browser assets.
RegisterNUICallback('cortexMinigamesPresentation', function(_, cb)
    cb({ ok = true, available = presentationAvailable() })
end)

function Cortex.register()
    registered = false
    if not started() then return false end
    local ok, result = pcall(function()
        return exports['cortex-lib']:registerSettings(TAB, 'Minigames', 'cortex-minigames:', FIELDS, DEFAULTS)
    end)
    registered = ok and result ~= false
    if not registered then CortexMinigames.Log.warn('cortex.register_failed', { reason = ok and 'rejected' or 'error' }) end
    return registered
end

--- Current Cortex Settings values, or nil when the adapter is not live.
function Cortex.values()
    if not registered or not started() then return nil end
    local ok, values = pcall(function()
        local get = function(key) return exports['cortex-lib']:getTabSetting(TAB, key) end
        return {
            volume = get('volume'), muted = get('muted'), motion = get('motion'), scale = get('scale'),
            keys = { primary = get('key_primary'), alt = get('key_alt'), prev = get('key_prev'), next = get('key_next'), rotate = get('key_rotate') },
        }
    end)
    return ok and values or nil
end

function Cortex.onChange(handler) onChange = handler end
function Cortex.isLive() return registered and started() end

AddEventHandler('cortex-lib:settingsChanged', function(tabId)
    if tabId == TAB then onChange() end
end)

AddEventHandler('onClientResourceStart', function(resource)
    -- cortex-lib drops consumer tabs when it restarts; register again once it is back.
    if resource == 'cortex-lib' or resource == GetCurrentResourceName() then
        if Cortex.register() then onChange() end
        notifyPresentation()
    end
end)

AddEventHandler('onClientResourceStop', function(resource)
    if resource == 'cortex-lib' then
        registered = false
        onChange()
        SendNUIMessage({ action = 'cortex-minigames:presentationAvailability', available = false })
    elseif resource == GetCurrentResourceName() then
        SendNUIMessage({ action = 'cortex-minigames:presentationAvailability', available = false })
    end
end)

CortexMinigames.Cortex = Cortex
