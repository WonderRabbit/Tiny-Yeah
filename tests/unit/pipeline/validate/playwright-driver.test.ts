// UNIT: PlaywrightDriver — dynamic import + graceful degradation (REQ-TY-015, REQ-TY-016).
// CRITICAL contract:
//   1. The MODULE FILE loads WITHOUT playwright installed (no top-level `import ... from "playwright"`).
//   2. When snapshot() is invoked and playwright is absent, it throws ValidationDriverUnavailableError
//      (NOT a raw ERR_MODULE_NOT_FOUND crash). This is the lazy dynamic-import guard.
//   3. playwright is in optionalDependencies (asserted in analyze.test.ts codegraph-absence suite /
//      separately in package.json assertion) — npm install does NOT pull it by default.
//
// We assert the DEGRADATION CONTRACT, not real browser behavior, so no Chromium is required.

import { describe, expect, it } from "vitest";
import { ValidationDriverUnavailableError } from "../../../../src/core/pipeline/validate/driver.js";
import { PlaywrightDriver } from "../../../../src/core/pipeline/validate/playwright-driver.js";

describe("PlaywrightDriver — module load (REQ-TY-016)", () => {
  it("module loads without throwing even when playwright is absent", () => {
    // Importing the module file at the top of this test file already proves this; this assertion
    // makes the contract explicit and pins it. If playwright were a hard top-level import, this
    // test file would fail to load entirely with ERR_MODULE_NOT_FOUND.
    expect(typeof PlaywrightDriver).toBe("function");
    const driver = new PlaywrightDriver();
    expect(driver.name).toBe("playwright");
  });
});

describe("PlaywrightDriver — graceful degradation when playwright is absent (REQ-TY-016)", () => {
  it("snapshot() rejects with ValidationDriverUnavailableError when playwright import fails", async () => {
    const driver = new PlaywrightDriver();
    // In this environment playwright is NOT installed (optionalDependencies only), so the
    // dynamic import inside snapshot() will fail and surface as a typed error.
    await expect(driver.snapshot("http://localhost:0/never-loaded")).rejects.toBeInstanceOf(
      ValidationDriverUnavailableError,
    );
  });

  it("the typed error carries the driver name 'playwright' for diagnostics", async () => {
    const driver = new PlaywrightDriver();
    await expect(
      driver.snapshot("http://localhost:0/never-loaded").catch((err: unknown) => {
        if (err instanceof ValidationDriverUnavailableError) return err.driverName;
        throw err;
      }),
    ).resolves.toBe("playwright");
  });
});

describe("PlaywrightDriver — satisfies ValidationDriver interface", () => {
  it("can be assigned to a ValidationDriver-typed reference", async () => {
    // Compile-time check that PlaywrightDriver implements the interface. The shape parity is
    // the load-bearing requirement (REQ-TY-015 AC: single interface definition point).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _driver: import("../../../../src/core/pipeline/validate/driver.js").ValidationDriver =
      new PlaywrightDriver();
    expect(true).toBe(true);
  });
});
