# Tiny-Yeah offline installer PowerShell entrypoint (SPEC-TINY-YEAH-002, strategy §4).
#
# Air-gapped entrypoint for PowerShell 7+ (D1, REQ-TY2-016). Resolves its own directory,
# locates bin/tiny-yeah.js, and invokes `node bin/tiny-yeah.js install --bundle <bundle-dir>`
# with forwarded arguments. All real install logic lives in bin/tiny-yeah.js (Phase 1+) and the
# head/installer/ domain (Phase 2+).
#
# No install-offline.sh is shipped — PowerShell-only runtime is a FROZEN constraint (D1,
# REQ-TY2-016).
#
# Phase 0 status: this wrapper is functional and forwards args, but `tiny-yeah install` prints
# "not implemented in Phase 0" and exits 2. The wrapper surfaces that exit code faithfully.
#
# Usage (from an unpacked bundle directory):
#   pwsh ./install-offline.ps1                              # install into CWD
#   pwsh ./install-offline.ps1 -TargetProject /path/to/proj # install into a target project
#   pwsh ./install-offline.ps1 -DryRun                      # plan only, no writes

#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$TargetProject,
    [switch]$DryRun,
    [switch]$Force,
    [switch]$Json,
    [switch]$Yes,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RemainingArgs
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'

# PowerShell 7+ gate (D1). $PSVersionTable.PSVersion.Major must be >= 7. The #Requires line
# above enforces this at parse time, but we surface a clear message if the host is older.
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "Tiny-Yeah installer requires PowerShell 7 or later (found $($PSVersionTable.PSVersion)). D1 (PowerShell-only) is a FROZEN constraint."
    exit 2
}

# Resolve this script's directory (= the unpacked bundle root).
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinPath = Join-Path $ScriptDir 'bin' 'tiny-yeah.js'

if (-not (Test-Path -LiteralPath $BinPath)) {
    Write-Error "bin/tiny-yeah.js not found adjacent to this script (looked at: $BinPath). The offline bundle appears incomplete."
    exit 3
}

# Build the argv forwarded to node bin/tiny-yeah.js. --bundle always points at the bundle
# root (this script's directory); user flags are appended.
$ForwardedArgs = @()
if ($TargetProject) { $ForwardedArgs += @('--project', $TargetProject) }
if ($DryRun) { $ForwardedArgs += '--dry-run' }
if ($Force) { $ForwardedArgs += '--force' }
if ($Json) { $ForwardedArgs += '--json' }
if ($Yes) { $ForwardedArgs += '--yes' }
if ($RemainingArgs) { $ForwardedArgs += $RemainingArgs }

# Invoke node against the bin (absolute path), passing --bundle = bundle root + forwarded flags.
& node $BinPath install --bundle $ScriptDir @ForwardedArgs
exit $LASTEXITCODE
