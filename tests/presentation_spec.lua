-- Optional bridge lifecycle, including the installed library adapter when available in this workspace.
local real = io.open('../../[cortex-core]/cortex-lib/presentation-client.lua', 'rb')
local adapter = real and real:read('a') or [[
    AddEventHandler('cortex-lib:presentation', function(data)
        SendNUIMessage({ action = 'cortex:presentation', data = data })
    end)
    RegisterNUICallback('cortexPresentationReady', function(_, cb)
        local ok, data = pcall(function() return exports['cortex-lib']:getPresentation() end)
        if ok then SendNUIMessage({ action = 'cortex:presentation', data = data }) end
        cb({ ok = true })
    end)
]]
if real then real:close() end

local H = dofile('tests/support.lua')
print(real and 'presentation fixture: installed cortex-lib adapter' or 'presentation fixture: optional adapter fallback')
local reads = 0
local contents = adapter
local snapshot = { v = 1, revision = 1, profile = { accent = '#b9a8df', opacity = 92, motion = 'auto', layout = true },
    viewport = { width = 1920, height = 1080, inset = 20 }, surfaces = {} }
CortexMinigames = { Log = { warn = function() end } }
LoadResourceFile = function(resource, path)
    H.eq(resource, 'cortex-lib', 'adapter read belongs to optional library')
    H.eq(path, 'presentation-client.lua', 'uses canonical adapter')
    reads = reads + 1
    return contents
end
exports = { ['cortex-lib'] = {
    registerSettings = function() return true end,
    getPresentation = function() if not H.cortexLib then error('stopped') end; return snapshot end,
    setPresentationSurfaces = function() return true end,
} }
dofile('client/cortex.lua')
H.eq(H.call('cortexMinigamesPresentation', {}).available, false, 'standalone is unavailable')
H.eq(reads, 0, 'standalone does not read missing library')
H.eq(H.nui.cortexPresentationReady, nil, 'no canonical callback until library exists')
H.cortexLib = true
contents = nil
H.eq(H.call('cortexMinigamesPresentation', {}).available, false, 'older library without adapter falls back')
contents = adapter
H.fire('onClientResourceStart', nil, 'cortex-lib')
H.eq(H.call('cortexMinigamesPresentation', {}).available, true, 'late library startup loads adapter')
H.ok(H.nui.cortexPresentationReady, 'canonical readiness callback registered')
H.eq(H.call('cortexPresentationReady', {}).ok, true, 'canonical callback completes exactly once')
local function latest(action)
    for i = #H.sent, 1, -1 do if H.sent[i].action == action then return H.sent[i] end end
end
H.eq(latest('cortex:presentation').data, snapshot, 'canonical snapshot reaches consumer unchanged')
local handlers = #(H.events['cortex-lib:presentation'] or {})
local before = reads
H.fire('onClientResourceStart', nil, 'cortex-lib')
H.eq(reads, before, 'library restart does not reexecute imported code')
H.eq(#H.events['cortex-lib:presentation'], handlers, 'library restart has no duplicate event handlers')
snapshot = { v = 1, revision = 2, profile = { accent = '#9bbcd3' }, viewport = {}, surfaces = {} }
H.fire('cortex-lib:presentation', nil, snapshot)
H.eq(latest('cortex:presentation').data, snapshot, 'live preview is forwarded unchanged')
H.cortexLib = false
H.fire('onClientResourceStop', nil, 'cortex-lib')
H.eq(latest('cortex-minigames:presentationAvailability').available, false, 'dependency stop tells page to reset')
H.eq(H.call('cortexMinigamesPresentation', {}).available, false, 'stopped library unavailable')
H.eq(H.call('cortexPresentationReady', {}).ok, true, 'canonical callback guards stopped export')
H.cortexLib = true
H.fire('onClientResourceStart', nil, 'cortex-lib')
H.eq(latest('cortex-minigames:presentationAvailability').available, true, 'library recovery restores page')
H.eq(H.focus.calls, 0, 'presentation never changes input focus')
H.fire('onClientResourceStop', nil, H.resource)
H.eq(latest('cortex-minigames:presentationAvailability').available, false, 'consumer stop resets page')
-- Unreadable/escrowed or invalid Lua fails closed, without poisoning consumer startup or
-- repeatedly executing a partial adapter. Reset the module to model a fresh consumer instance.
H.events, H.nui = {}, {}
contents = '\27Lua\0unreadable adapter'
local beforeInvalid = reads
dofile('client/cortex.lua')
H.eq(H.call('cortexMinigamesPresentation', {}).available, false, 'unreadable adapter falls back')
H.eq(H.call('cortexMinigamesPresentation', {}).available, false, 'failed adapter remains unavailable')
H.eq(reads, beforeInvalid + 1, 'failed adapter is not reexecuted')
H.eq(H.nui.cortexPresentationReady, nil, 'failed adapter installs no canonical callback')
H.done('presentation')
