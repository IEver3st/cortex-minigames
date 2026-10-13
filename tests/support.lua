-- Standalone Lua 5.4 harness: a minimal JSON codec, a cooperative scheduler, and stubs for the
-- FiveM natives the runtime touches. Specs run from the resource root: `lua tests/<name>_spec.lua`.

local H = {}
H.failures = 0

---------------------------------------------------------------------------------------------------
-- JSON

local function decode(text)
    local pos = 1
    local function ws() pos = text:find('[^ \t\r\n]', pos) or #text + 1 end
    local value
    local function str()
        local out, i = {}, pos + 1
        while true do
            local c = text:sub(i, i)
            if c == '"' then pos = i + 1; return table.concat(out) end
            if c == '\\' then
                local n = text:sub(i + 1, i + 1)
                local map = { n = '\n', t = '\t', r = '\r', b = '\b', f = '\f', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
                if n == 'u' then
                    local code = tonumber(text:sub(i + 2, i + 5), 16)
                    out[#out + 1] = utf8.char(code)
                    i = i + 6
                else
                    out[#out + 1] = map[n]
                    i = i + 2
                end
            else
                out[#out + 1] = c
                i = i + 1
            end
        end
    end
    value = function()
        ws()
        local c = text:sub(pos, pos)
        if c == '{' then
            local obj = {}
            pos = pos + 1; ws()
            if text:sub(pos, pos) == '}' then pos = pos + 1; return obj end
            while true do
                ws(); local key = str(); ws(); pos = pos + 1
                obj[key] = value(); ws()
                local d = text:sub(pos, pos); pos = pos + 1
                if d == '}' then return obj end
            end
        elseif c == '[' then
            local arr = {}
            pos = pos + 1; ws()
            if text:sub(pos, pos) == ']' then pos = pos + 1; return arr end
            while true do
                arr[#arr + 1] = value(); ws()
                local d = text:sub(pos, pos); pos = pos + 1
                if d == ']' then return arr end
            end
        elseif c == '"' then return str()
        elseif text:sub(pos, pos + 3) == 'true' then pos = pos + 4; return true
        elseif text:sub(pos, pos + 4) == 'false' then pos = pos + 5; return false
        elseif text:sub(pos, pos + 3) == 'null' then pos = pos + 4; return nil
        else
            local num = text:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
            pos = pos + #num
            return math.tointeger(tonumber(num)) or tonumber(num)
        end
    end
    return value()
end

local function encode(v)
    local kind = type(v)
    if kind == 'nil' then return 'null' end
    if kind == 'boolean' or kind == 'number' then return tostring(v) end
    if kind == 'string' then return '"' .. v:gsub('[%c"\\]', function(c) return ('\\u%04x'):format(c:byte()) end) .. '"' end
    if kind == 'table' then
        if #v > 0 or next(v) == nil then
            local parts = {}
            for i = 1, #v do parts[i] = encode(v[i]) end
            return '[' .. table.concat(parts, ',') .. ']'
        end
        local parts = {}
        for key, item in pairs(v) do parts[#parts + 1] = encode(tostring(key)) .. ':' .. encode(item) end
        return '{' .. table.concat(parts, ',') .. '}'
    end
    return 'null'
end

json = { decode = decode, encode = encode }

---------------------------------------------------------------------------------------------------
-- Assertions

function H.eq(actual, expected, label)
    if actual ~= expected then
        H.failures = H.failures + 1
        print(('FAIL %s: expected %s, got %s'):format(label or '?', tostring(expected), tostring(actual)))
    end
end

function H.ok(value, label) H.eq(not not value, true, label) end

function H.done(name)
    if H.failures > 0 then
        print(('%s: %d failure(s)'):format(name, H.failures))
        os.exit(1)
    end
    print(name .. ': ok')
end

---------------------------------------------------------------------------------------------------
-- Scheduler and natives

H.time = 1000
local threads, timers = {}, {}

function GetGameTimer() return H.time end
function Wait(ms) coroutine.yield(ms or 0) end
function CreateThread(fn)
    local co = coroutine.create(fn)
    threads[#threads + 1] = { co = co, wake = H.time }
end
Citizen = { CreateThread = CreateThread, Wait = Wait }
function SetTimeout(ms, fn) timers[#timers + 1] = { at = H.time + ms, fn = fn } end

--- Advance simulated time in 5 ms slices, running due threads and timers.
function H.tick(ms)
    local target = H.time + (ms or 0)
    repeat
        for i = #threads, 1, -1 do
            local t = threads[i]
            if coroutine.status(t.co) == 'dead' then table.remove(threads, i)
            elseif t.wake <= H.time then
                local ok, wait = coroutine.resume(t.co)
                if not ok then error(wait) end
                t.wake = H.time + math.max(wait or 0, 1)
                if coroutine.status(t.co) == 'dead' then table.remove(threads, i) end
            end
        end
        for i = #timers, 1, -1 do
            local timer = timers[i]
            if timer.at <= H.time then table.remove(timers, i); timer.fn() end
        end
        if H.time >= target then break end
        H.time = math.min(target, H.time + 5)
    until false
end

function H.threadCount()
    local n = 0
    for _, t in ipairs(threads) do if coroutine.status(t.co) ~= 'dead' then n = n + 1 end end
    return n
end

H.resource = 'cortex-minigames'
H.invoking = nil
H.events, H.netEvents, H.nui, H.sent, H.serverEvents, H.clientEvents = {}, {}, {}, {}, {}, {}
H.focus = { focused = false, cursor = false, keepInput = false, calls = 0 }
H.kvp = {}
H.exports = {}

function GetCurrentResourceName() return H.resource end
function GetInvokingResource() return H.invoking end
function GetResourceState(name) return name == 'cortex-lib' and (H.cortexLib and 'started' or 'missing') or 'started' end
function GetResourceMetadata() return '1.0.0' end
function LoadResourceFile(_, path)
    local file = assert(io.open(path, 'rb'))
    local text = file:read('a')
    file:close()
    return text
end
function GetRandomIntInRange(a, b) return math.random(a, b - 1) end
function AddEventHandler(name, fn) H.events[name] = H.events[name] or {}; table.insert(H.events[name], fn) end
function RegisterNetEvent(name, fn) H.netEvents[name] = true; if fn then AddEventHandler(name, fn) end end
function TriggerEvent(name, ...) for _, fn in ipairs(H.events[name] or {}) do fn(...) end end
function H.fire(name, src, ...)
    source = src
    for _, fn in ipairs(H.events[name] or {}) do fn(...) end
    source = nil
end
function TriggerServerEvent(name, ...) H.serverEvents[#H.serverEvents + 1] = { name = name, args = { ... } } end
function TriggerClientEvent(name, target, ...) H.clientEvents[#H.clientEvents + 1] = { name = name, target = target, args = { ... } } end
function RegisterNUICallback(name, fn) H.nui[name] = fn end
function SendNUIMessage(message) H.sent[#H.sent + 1] = message end
function SetNuiFocus(focused, cursor) H.focus.focused = focused; H.focus.cursor = cursor; H.focus.calls = H.focus.calls + 1 end
function SetNuiFocusKeepInput(keep) H.focus.keepInput = keep end
function IsNuiFocused() return H.focus.focused or H.foreignFocus == true end
function IsPauseMenuActive() return false end
function GetResourceKvpString(key) return H.kvp[key] end
function SetResourceKvp(key, value) H.kvp[key] = value end
H.commands = {}
function RegisterCommand(name, fn) H.commands[name] = fn end
function GetConvarInt() return 0 end
function DisableAllControlActions() end
function IsUsingKeyboard() return H.usingKeyboard ~= false end
function IsDisabledControlPressed(_, control) return H.padDown and H.padDown[control] or false end
function GetDisabledControlNormal() return 0.0 end
function PlayerPedId() return 1 end
function IsEntityDead() return H.dead == true end
function IsPedFatallyInjured() return false end
function GetEntityCoords() return H.coords or { x = 0.0, y = 0.0, z = 0.0 } end
function DoesEntityExist(entity) return entity ~= H.missingEntity end
function exports(name, fn) H.exports[name] = fn end

-- Server natives
H.players = {}
H.buckets = {}
function GetPlayerName(src) return H.players[src] end
function GetPlayerRoutingBucket(src) return H.buckets[src] or 0 end
function IsPlayerAceAllowed() return false end

-- promise / Citizen.Await (resolution only; specs use Begin for async flows)
promise = {}
promise.__index = promise
function promise.new() return setmetatable({ done = false }, promise) end
function promise:resolve(value) self.done = true; self.value = value end
function Citizen.Await(p)
    while not p.done do coroutine.yield(0) end
    return p.value
end

--- Load the resource's scripts in manifest order.
function H.loadClient()
    for _, path in ipairs({
        'config.lua', 'shared/log.lua', 'shared/locale.lua', 'locales/en.lua', 'shared/schema.lua',
        'client/prefs.lua', 'client/cortex.lua', 'client/input.lua', 'client/context.lua', 'client/session.lua',
        'client/sequence.lua', 'client/api.lua', 'client/attempts.lua', 'client/commands.lua',
    }) do dofile(path) end
end

function H.loadShared()
    for _, path in ipairs({ 'config.lua', 'shared/log.lua', 'shared/locale.lua', 'locales/en.lua', 'shared/schema.lua' }) do dofile(path) end
end

function H.loadServer()
    H.loadShared()
    dofile('server/attempts.lua')
end

--- Last NUI message of a type.
function H.last(kind)
    for i = #H.sent, 1, -1 do if H.sent[i].type == kind then return H.sent[i] end end
    return nil
end

--- Call a NUI callback and return its single reply (errors if it replies zero or two times).
function H.call(name, data)
    local replies = {}
    H.nui[name](data, function(value) replies[#replies + 1] = value end)
    assert(#replies == 1, name .. ' replied ' .. #replies .. ' times')
    return replies[1]
end

return H
