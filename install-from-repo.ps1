# Tiny-Yeah repository checkout installer.
#
# Use this from a downloaded git repository or GitHub ZIP checkout. It finds the matching
# release/tiny-yeah-offline-v<package.json version>.tar.gz archive and delegates to the hermetic
# Node installer. The real install logic stays in bin/tiny-yeah.js.
#
# Usage:
#   pwsh .\install-from-repo.ps1 -TargetProject C:\path\to\opencode-project -Yes
#   pwsh .\install-from-repo.ps1 -TargetProject C:\path\to\opencode-project -DryRun -Yes
#   pwsh .\install-from-repo.ps1 -Bundle .\release\tiny-yeah-offline-v1.0.0.tar.gz -TargetProject C:\path\to\project -Yes

#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$TargetProject,
    [string]$Bundle,
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Json,
    [switch]$Yes,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "Tiny-Yeah repository installer requires PowerShell 7 or later (found $($PSVersionTable.PSVersion))."
    exit 2
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinPath = Join-Path $RepoRoot 'bin' 'tiny-yeah.js'

if (-not (Test-Path -LiteralPath $BinPath)) {
    Write-Error "bin/tiny-yeah.js not found under this repository (looked at: $BinPath). Download the complete Tiny-Yeah repository."
    exit 3
}

function Resolve-DefaultBundle {
    param([string]$Root)

    $releaseDir = Join-Path $Root 'release'
    if (-not (Test-Path -LiteralPath $releaseDir -PathType Container)) {
        Write-Error "release folder not found under this repository. Expected: $releaseDir"
        exit 4
    }

    $packagePath = Join-Path $Root 'package.json'
    $version = $null
    if (Test-Path -LiteralPath $packagePath) {
        $packageJson = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
        $version = $packageJson.version
    }

    if ($version) {
        $versioned = Join-Path $releaseDir "tiny-yeah-offline-v$version.tar.gz"
        if (Test-Path -LiteralPath $versioned -PathType Leaf) {
            return $versioned
        }
        Write-Error "Versioned offline bundle not found: $versioned. Rebuild it with 'npm run release:offline' or pass -Bundle explicitly."
        exit 4
    }

    Write-Error "package.json version not found under this repository. Pass -Bundle explicitly."
    exit 4
}

$BundlePath = if ($Bundle) {
    if ([System.IO.Path]::IsPathRooted($Bundle)) {
        $Bundle
    } else {
        Join-Path (Get-Location) $Bundle
    }
} else {
    Resolve-DefaultBundle -Root $RepoRoot
}

if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) {
    Write-Error "Offline bundle not found: $BundlePath"
    exit 4
}

$ForwardedArgs = @()
if ($TargetProject) { $ForwardedArgs += @('--project', $TargetProject) }
if ($DryRun) { $ForwardedArgs += '--dry-run' }
if ($Force) { $ForwardedArgs += '--force' }
if ($Json) { $ForwardedArgs += '--json' }
if ($Yes) { $ForwardedArgs += '--yes' }
if ($RemainingArgs) { $ForwardedArgs += $RemainingArgs }

& node $BinPath install --bundle $BundlePath @ForwardedArgs
exit $LASTEXITCODE
