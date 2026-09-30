[CmdletBinding()]
param()
# Builds the distributable: runtime files and the compiled NUI only. No sources, tests,
# node_modules or dev playground. Run scripts/check.ps1 first.
$ErrorActionPreference = 'Stop'
$resourcePath = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $resourcePath 'web\dist\index.html'))) { throw 'Run scripts/check.ps1 before packaging.' }
$version = (Select-String -LiteralPath (Join-Path $resourcePath 'fxmanifest.lua') -Pattern "^version '([^']+)'").Matches[0].Groups[1].Value
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $resourcePath "artifacts\$stamp"
$packagePath = Join-Path $outputPath 'cortex-minigames'
[IO.Directory]::CreateDirectory($packagePath) | Out-Null
foreach ($entry in @('fxmanifest.lua', 'config.lua', 'caller.lua', 'README.md', 'CHANGELOG.md', 'LICENSE', 'client', 'server', 'shared', 'locales', 'docs', 'examples', 'licenses')) {
    Copy-Item -LiteralPath (Join-Path $resourcePath $entry) -Destination $packagePath -Recurse
}
[IO.Directory]::CreateDirectory((Join-Path $packagePath 'web')) | Out-Null
Copy-Item -LiteralPath (Join-Path $resourcePath 'web\dist') -Destination (Join-Path $packagePath 'web') -Recurse

# Every manifest-listed NUI asset must exist in the package, and nothing may point off-box.
$manifest = Get-Content -LiteralPath (Join-Path $packagePath 'fxmanifest.lua') -Raw
foreach ($file in @('shared/catalog.json', 'caller.lua', 'web/dist/index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $packagePath $file))) { throw "Packaged file missing: $file" }
}
if (-not (Get-ChildItem -LiteralPath (Join-Path $packagePath 'web\dist\assets') -File)) { throw 'No NUI assets packaged.' }
$remote = Get-ChildItem -LiteralPath (Join-Path $packagePath 'web\dist') -Recurse -File | Select-String -Pattern 'localhost|127\.0\.0\.1|fonts\.googleapis|cdn\.' -List
if ($remote) { throw "Remote or dev URL found in packaged UI: $($remote.Path)" }
if ($manifest -notmatch "ui_page 'web/dist/index.html'") { throw 'ui_page does not point at the packaged build.' }

$archivePath = Join-Path $outputPath "cortex-minigames-$version.zip"
# ZipFile uses literal paths throughout, including resource folders containing [brackets].
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($packagePath, $archivePath, [IO.Compression.CompressionLevel]::Optimal, $true)
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archivePath + '.sha256'), ($hash + "  cortex-minigames-$version.zip" + [Environment]::NewLine))
Write-Output "Package directory: $packagePath"
Write-Output "Archive: $archivePath"
Write-Output "SHA256: $hash"
