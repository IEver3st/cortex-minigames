[CmdletBinding()]
param()
# Local gates: Lua syntax, Lua specs, UI dependency install, tests, type check and build.
# FiveM/CEF, controller delivery, focus, multiplayer and resmon checks remain user-run.
$ErrorActionPreference = 'Stop'
$resourcePath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $resourcePath
try {
    # Generate the shared contract before either runtime is tested. Game source is authoritative;
    # the Lua specs and catalog parity test must both consume the current registry.
    Push-Location -LiteralPath '.\web'
    try {
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        & bun run catalog
        if ($LASTEXITCODE -ne 0) { throw 'Catalog generation failed.' }
    } finally { Pop-Location }
    Get-ChildItem -LiteralPath $resourcePath -Recurse -File -Filter '*.lua' |
        Where-Object { $_.FullName -notmatch '[\\/](node_modules|artifacts|\.release)[\\/]' } |
        ForEach-Object {
            & luac -p $_.FullName
            if ($LASTEXITCODE -ne 0) { throw "Lua syntax failed: $($_.FullName)" }
        }
    foreach ($test in Get-ChildItem -LiteralPath '.\tests' -File -Filter '*_spec.lua') {
        & lua $test.FullName
        if ($LASTEXITCODE -ne 0) { throw "Lua spec failed: $($test.Name)" }
    }
    Push-Location -LiteralPath '.\web'
    try {
        foreach ($script in @('test', 'check', 'build')) {
            & bun run $script
            if ($LASTEXITCODE -ne 0) { throw "UI $script failed." }
        }
    } finally { Pop-Location }
    # The build regenerates the same catalog; no customer page may depend on a dev or remote host.
    $dist = Get-Content -LiteralPath '.\web\dist\index.html' -Raw
    if ($dist -match 'localhost|127\.0\.0\.1|https?://(?!www\.w3\.org)') { throw 'web/dist/index.html references a remote or dev URL.' }
    Write-Output 'cortex-minigames local checks passed. FiveM/CEF/controller/multiplayer verification remains user-run.'
} finally { Pop-Location }
