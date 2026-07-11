export const INSTALL_CHECK_SCHEMA_VERSION = "tiny-yeah.install-check.v1" as const;

export const INSTALL_CHECK_NEXT_ACTION =
  "Run tiny-yeah doctor --json when install health evidence is needed." as const;

export interface InstallCheckDiagnostic {
  readonly schemaVersion: typeof INSTALL_CHECK_SCHEMA_VERSION;
  readonly root: string;
  readonly toolCount: number;
  readonly toolNames: readonly string[];
  readonly parity: "ok";
  readonly latestEvidencePath: string | null;
  readonly nextAction: typeof INSTALL_CHECK_NEXT_ACTION;
}

export function buildInstallCheckDiagnostic(
  root: string,
  toolNames: readonly string[],
): InstallCheckDiagnostic {
  const names = [...toolNames].sort();
  return {
    schemaVersion: INSTALL_CHECK_SCHEMA_VERSION,
    root,
    toolCount: names.length,
    toolNames: names,
    parity: "ok",
    latestEvidencePath: null,
    nextAction: INSTALL_CHECK_NEXT_ACTION,
  };
}
