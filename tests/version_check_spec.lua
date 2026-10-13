-- Startup update notice: repository from the manifest, one GitHub request, one console line,
-- off by the resource's convar.
local printed, requests, threads, convars = {}, {}, {}, {}
local metadata = { version = '1.1.0', cortex_update_repo = 'IEver3st/cortex-minigames' }

json = {
    decode = function(text)
        local tag = text:match('"tag_name"%s*:%s*"([^"]*)"')
        if not tag then error('bad json') end
        return { tag_name = tag }
    end,
}
local realPrint = print
function print(line) printed[#printed + 1] = line end
function CreateThread(fn) threads[#threads + 1] = fn end
function GetConvarInt(name, default) convars.last = name; return convars[name] or default end
function GetCurrentResourceName() return 'cortex-minigames' end
function GetResourceMetadata(resource, key) assert(resource == 'cortex-minigames'); return metadata[key] end
function PerformHttpRequest(url, callback, method, _, headers)
    requests[#requests + 1] = { url = url, callback = callback, method = method, headers = headers }
end

local function run(status, body)
    printed, requests, threads = {}, {}, {}
    dofile('server/version_check.lua')
    assert(#threads == 1, 'loading starts one thread')
    threads[1]()
    if #requests == 0 then return end
    assert(#requests == 1, 'one request per start')
    local request = requests[1]
    assert(request.url == 'https://api.github.com/repos/IEver3st/cortex-minigames/releases/latest', request.url)
    assert(request.method == 'GET' and request.headers['User-Agent'] == 'cortex-minigames-version-check')
    request.callback(status, body)
end

local function expect(text, message)
    assert(#printed == 1 and printed[1]:find(text, 1, true), message .. ': ' .. tostring(printed[1]))
end

run(200, '{"tag_name":"v1.2.0"}')
expect('Update available: ^21.2.0^7 (installed 1.1.0)', 'newer release is announced')
expect('https://github.com/IEver3st/cortex-minigames/releases/latest', 'download link names the repository')
assert(convars.last == 'cortex_minigames_version_check', 'convar is derived from the resource name')

run(200, '{"tag_name":"v1.1.0"}')
expect('Version 1.1.0 is up to date', 'same version is up to date')

run(200, '{"tag_name":"v1.0.0"}')
expect('is up to date', 'older release is not announced')

run(200, '{"tag_name":"v1.10.0"}')
expect('Update available', 'numeric, not text, comparison')

metadata.version = '1.1.0-rc.1'
run(200, '{"tag_name":"v1.1.0"}')
expect('Update available', 'a release is newer than its pre-release')
metadata.version = '1.1.0'

run(404, '')
expect('Could not check for updates (HTTP 404)', 'API failure is one quiet line')

run(200, 'not json')
assert(#printed == 0, 'malformed body prints nothing')

convars.cortex_minigames_version_check = 0
run(200, '{"tag_name":"v9.0.0"}')
assert(#requests == 0 and #printed == 0, 'the convar disables the request')
convars.cortex_minigames_version_check = nil

metadata.cortex_update_repo = nil
run(200, '{"tag_name":"v9.0.0"}')
assert(#requests == 0 and #printed == 0, 'no repository in the manifest means no request')

print = realPrint
print('version check: newer/same/older/pre-release/HTTP failure/opt-out/no repository passed')
