// Tiny-Yeah ValidationDriver — single definition point (REQ-TY-015, SPEC-TINY-YEAH-001 §6.7).
// The model-facing surface does NOT depend on Playwright directly; Playwright is one
// implementation among (potentially) many, isolated in playwright-driver.ts behind a capability
// flag. core/evidence/runtime-matcher.ts CONSUMES this interface — it must not redefine
// RuntimeSnapshot (REQ-TY-015 AC: single definition point).

/**
 * Plain runtime page snapshot produced by any ValidationDriver. Decoupled from Playwright so
 * the matcher and pipeline can run with the NoopDriver when no browser is available (REQ-TY-016).
 */
export type RuntimeSnapshot = {
  readonly url: string;
  readonly bodyText: string;
};

/**
 * Pluggable runtime-validation abstraction. Implementations:
 *   - NoopDriver (graceful degradation, REQ-TY-016)
 *   - PlaywrightDriver (core/pipeline/validate/playwright-driver.ts, capability-flag-gated, REQ-TY-016)
 */
export interface ValidationDriver {
  readonly name: string;
  snapshot(url: string): Promise<RuntimeSnapshot>;
}

export type ValidationDriverErrorCode = "ERR_DRIVER_UNAVAILABLE" | "ERR_UNKNOWN_DRIVER";

/**
 * Typed error raised when a requested driver cannot fulfil a snapshot — most importantly when
 * Playwright is absent AT CALL TIME (REQ-TY-016: graceful degradation, never a module-load crash).
 * The module file itself loads without playwright installed; the error is thrown lazily from
 * snapshot() when the dynamic import fails.
 */
export class ValidationDriverUnavailableError extends Error {
  public readonly code = "ERR_DRIVER_UNAVAILABLE" as const;
  constructor(
    public readonly driverName: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ValidationDriverUnavailableError";
  }
}

/** Internal registry entry: a zero-arg factory returning a fresh driver instance. */
type DriverFactory = () => ValidationDriver;

const registry = new Map<string, DriverFactory>();

/**
 * Register a driver factory under `name`. Idempotent for the same (name, factory) pair; a
 * different factory for an existing name overwrites (last-wins) to support capability-flag
 * swaps at runtime.
 */
export function registerDriver(name: string, factory: DriverFactory): void {
  registry.set(name, factory);
}

/**
 * Resolve a driver by name. Unknown names throw (task spec: "unknown driver → error").
 */
export function createDriver(name: string): ValidationDriver {
  const factory = registry.get(name);
  if (factory === undefined) {
    const error = new Error(`Unknown validation driver: ${name}`) as Error & {
      code: ValidationDriverErrorCode;
    };
    error.code = "ERR_UNKNOWN_DRIVER";
    error.name = "ValidationDriverUnknownError";
    throw error;
  }
  return factory();
}

/** Test/inspection helper — resets the registry to a clean state. */
export function resetDriverRegistry(): void {
  registry.clear();
}

/** Returns the set of currently-registered driver names (for diagnostics / install-check). */
export function registeredDriverNames(): readonly string[] {
  return [...registry.keys()].sort();
}

/**
 * NoopDriver — graceful-degradation driver (REQ-TY-016). When Playwright is unavailable, the
 * core pipeline still runs without error; runtime validation is EXPLICITLY reported as skipped
 * (not silently passed) via the logger. Produces an empty bodyText so every fact resolves to
 * unresolved/mismatched rather than runtime-confirmed.
 */
export class NoopDriver implements ValidationDriver {
  public readonly name = "noop";

  constructor(private readonly logger: (message: string) => void = (m) => console.warn(m)) {}

  async snapshot(url: string): Promise<RuntimeSnapshot> {
    this.logger(`validation skipped (no browser driver): ${url}`);
    return { url, bodyText: "" };
  }
}
