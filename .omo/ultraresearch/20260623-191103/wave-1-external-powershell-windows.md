# Wave 1: External PowerShell and Windows Runtime

Worker: `019ef3f6-d4fc-7221-b3de-e152ea45183b`

## Key Findings

- PowerShell 7.6 exists as a current 7.6 release line on 2026-06-23; Microsoft install docs point to 7.6.3 packages while lifecycle/channel docs may describe Stable/LTS channels separately.
- PowerShell support on Windows is bounded by the underlying Windows lifecycle; Windows 10 Home/Pro ended support on 2025-10-14, so Windows 10 after that date is not a fully supported host unless an LTSC/ESU/support exception applies.
- PowerShell 7 installs side-by-side with Windows PowerShell 5.1. WinGet installs MSIX by default beginning with PowerShell 7.6.0; MSI remains available.
- In PowerShell, Node CLIs such as `npm`, `npx`, and `opencode` are found only when their executable shims are on `PATH`; npm scripts/`npm exec` inject local package bins into child process `PATH`.
- Execution policy and Mark-of-the-Web can affect downloaded `.ps1` scripts; per-process `pwsh.exe -ExecutionPolicy ...` only affects that process and children.

## Sources

- https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle?view=powershell-7.6
- https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows?view=powershell-7.6
- https://github.com/PowerShell/PowerShell/releases/tag/v7.6.0
- https://github.com/PowerShell/PowerShell/releases/tag/v7.6.2
- https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_command_precedence?view=powershell-7.6
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-7.6
- https://docs.npmjs.com/cli/v11/commands/npm-exec/
- https://docs.npmjs.com/cli/v11/using-npm/scripts/

## EXPAND

- LEAD: PowerShell 7.6 lifecycle channel split - WHY: confirm whether Microsoft uses "stable", "LTS", and "preview" as separate support channels on the same date - ANGLE: support lifecycle table and release cadence
- LEAD: 7.6.3 package mismatch - WHY: reconcile why the Windows install page links 7.6.3 while lifecycle says stable 7.5.7 and LTS 7.6.2 - ANGLE: compare install doc last-updated date with release tags
- LEAD: Windows 10 EOL boundary - WHY: verify whether PowerShell support ends strictly at Windows 10 Home/Pro retirement on 2025-10-14 - ANGLE: product lifecycle + PowerShell supported platforms rules
- LEAD: Windows 10 LTSC exception - WHY: determine whether any Windows 10 LTSC edition remains relevant for PowerShell 7 support after 2025-10-14 - ANGLE: Windows LTSC lifecycle pages
- LEAD: MSIX vs MSI in 7.6 - WHY: confirm the exact cutover where WinGet defaults to MSIX and whether MSI is still first-class in 7.6.3 - ANGLE: install doc + release notes
- LEAD: `pwsh.exe -ExecutionPolicy` behavior - WHY: verify session-only policy scope for Node CLI launch wrappers - ANGLE: execution policy doc plus `pwsh` CLI help
- LEAD: `RemoteSigned` and downloaded shims - WHY: check whether unpacked CLI zips and downloaded `.ps1` launchers get blocked by Mark-of-the-Web - ANGLE: execution policy + `Unblock-File`
- LEAD: PowerShell external executable lookup - WHY: confirm how `pwsh` resolves `npm`, `npx`, and `opencode` when only a shim is on PATH - ANGLE: command precedence + PATHEXT
- LEAD: npm PATH injection - WHY: check whether `npm exec` and lifecycle scripts reliably expose local bins for `opencode` execution - ANGLE: npm exec and scripts docs
- LEAD: Node installer PATH side effect - WHY: verify whether a stock Windows Node install puts `npm` on PATH for PowerShell sessions - ANGLE: Node download/install docs and Windows installer docs
