#Requires -Version 5.1
<#
.SYNOPSIS
Gera os instaladores Windows do Polvo com a chave original do atualizador.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-signed.ps1
.EXAMPLE
.\scripts\build-signed.ps1 -SigningKeyPath C:\segredos\polvo.key
.NOTES
Requer Node.js, pnpm, Rust MSVC e Visual Studio Build Tools para C++.
A senha, se houver, vem de TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
Nao publica releases nem gera novas chaves. A assinatura e do atualizador Tauri;
certificados Authenticode sao configurados separadamente no Tauri.
#>
[CmdletBinding()]
param(
    [string]$SigningKeyPath,
    [switch]$SkipInstall,
    [switch]$SkipChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$savedKey = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', 'Process')
$savedPassword = [Environment]::GetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', 'Process')
$probeDirectory = $null

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('{0} falhou (codigo {1}).' -f $Command, $LASTEXITCODE)
    }
}

function Invoke-SignedTauri {
    param([string[]]$Arguments)
    # Node preserves an empty password on Windows PowerShell 5.1, where assigning
    # an empty environment variable removes it. Never pass secrets as CLI arguments.
    $runner = @'
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...process.argv.slice(2)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' },
});
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
'@
    $runner | & node --input-type=commonjs - @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Tauri falhou (codigo {0}). Confira a chave e a senha de assinatura.' -f $LASTEXITCODE)
    }
}

Push-Location -LiteralPath $repoRoot
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Este script gera instaladores Windows e deve rodar no Windows.' }
    foreach ($command in @('node', 'pnpm', 'cargo', 'rustc', 'git')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Dependencia nao encontrada: $command" }
    }

    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $configPath = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $cargo = Get-Content -LiteralPath 'src-tauri\Cargo.toml' -Raw -Encoding UTF8
    $cargoVersion = [regex]::Match($cargo, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    $version = $package.version
    if ($config.version -ne $version -or $cargoVersion -ne $version) {
        throw 'Versoes diferentes em package.json, tauri.conf.json e Cargo.toml. Use pnpm version:set X.Y.Z.'
    }
    if ($config.bundle.createUpdaterArtifacts -ne $true) { throw 'bundle.createUpdaterArtifacts deve ser true.' }

    $key = $savedKey
    if ($SigningKeyPath) {
        if (-not (Test-Path -LiteralPath $SigningKeyPath -PathType Leaf)) { throw 'Arquivo de chave de assinatura nao encontrado.' }
        $key = Get-Content -LiteralPath $SigningKeyPath -Raw -Encoding UTF8
    } elseif ($key) {
        if (Test-Path -LiteralPath $key -PathType Leaf -ErrorAction SilentlyContinue) {
            $key = Get-Content -LiteralPath $key -Raw -Encoding UTF8
        }
    } else {
        $defaultKey = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.tauri\polvo.key'
        if (-not (Test-Path -LiteralPath $defaultKey -PathType Leaf)) {
            throw 'Chave original nao encontrada. Use -SigningKeyPath, TAURI_SIGNING_PRIVATE_KEY ou ~/.tauri/polvo.key.'
        }
        $key = Get-Content -LiteralPath $defaultKey -Raw -Encoding UTF8
    }
    if ([string]::IsNullOrWhiteSpace($key)) { throw 'A chave de assinatura esta vazia.' }
    [Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', $key, 'Process')

    $commit = (& git rev-parse HEAD | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel identificar o commit do repositorio.' }
    Write-Host "Build Polvo $version - commit $commit"
    if (-not $SkipInstall) { Invoke-Checked 'pnpm' @('install', '--frozen-lockfile') }

    # Verify the actual private key before the expensive build, without trusting a
    # companion .pub file. The same verifier checks both installers after bundling.
    $probeDirectory = Join-Path ([IO.Path]::GetTempPath()) ('polvo-signing-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $probeDirectory
    $probeFile = Join-Path $probeDirectory 'probe.txt'
    [IO.File]::WriteAllText($probeFile, "Polvo $version $commit", (New-Object Text.UTF8Encoding($false)))
    Invoke-SignedTauri @('signer', 'sign', $probeFile, '--app-version', $version)
    Invoke-Checked 'node' @('scripts/verify-updater-signature.mjs', $configPath, $probeFile)

    if (-not $SkipChecks) {
        Invoke-Checked 'pnpm' @('test')
        Invoke-Checked 'cargo' @('test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml')
    }

    # Cargo metadata respects CARGO_TARGET_DIR and .cargo/config.toml.
    $metadataText = & cargo metadata --locked --no-deps --format-version 1 --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel localizar o diretorio de build do Cargo.' }
    $metadata = ($metadataText | Out-String) | ConvertFrom-Json
    $target = 'x86_64-pc-windows-msvc'
    $bundleDirectory = Join-Path $metadata.target_directory "$target\release\bundle"
    $setup = Join-Path $bundleDirectory "nsis\Polvo_${version}_x64-setup.exe"
    $msi = Join-Path $bundleDirectory "msi\Polvo_${version}_x64_en-US.msi"
    $startedAt = [DateTime]::UtcNow
    Invoke-SignedTauri @('build', '--ci', '--target', $target, '--bundles', 'nsis,msi', '--', '--locked')

    foreach ($file in @($setup, "$setup.sig", $msi, "$msi.sig")) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Artefato nao gerado: $file" }
        $item = Get-Item -LiteralPath $file
        if ($item.Length -eq 0 -or $item.LastWriteTimeUtc -lt $startedAt) { throw "Artefato vazio ou antigo: $file" }
    }
    Invoke-Checked 'node' @('scripts/verify-updater-signature.mjs', $configPath, $setup, $msi)

    $artifacts = foreach ($file in @($setup, "$setup.sig", $msi, "$msi.sig")) {
        $item = Get-Item -LiteralPath $file
        [ordered]@{ path = $item.FullName; size = $item.Length; sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $manifest = [ordered]@{
        version = $version
        commit = $commit
        builtAt = [DateTime]::UtcNow.ToString('o')
        target = $target
        updaterSignaturesVerified = $true
        checksRun = (-not $SkipChecks.IsPresent)
        workingTreeStatus = @(& git status --short)
        artifacts = @($artifacts)
    }
    $manifestPath = Join-Path $bundleDirectory 'build-manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    Write-Host "`nBuild concluido e assinaturas verificadas:"
    Write-Host $setup
    Write-Host $msi
    Write-Host "Manifesto SHA-256: $manifestPath"
} finally {
    [Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY', $savedKey, 'Process')
    [Environment]::SetEnvironmentVariable('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', $savedPassword, 'Process')
    # Only remove the two files created here; never recursively remove a computed path.
    if ($probeDirectory) {
        foreach ($name in @('probe.txt', 'probe.txt.sig')) {
            $file = Join-Path $probeDirectory $name
            if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
        }
        if (Test-Path -LiteralPath $probeDirectory) { Remove-Item -LiteralPath $probeDirectory }
    }
    Pop-Location
}
