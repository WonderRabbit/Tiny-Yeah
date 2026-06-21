// Tiny-Yeah PlaywrightDriver — Playwright implementation BEHIND a capability flag (REQ-TY-015/016).
// CRITICAL: `playwright` is imported DYNAMICICALLY inside snapshot() so this module file LOADS even
// when playwright is NOT installed. If playwright is absent at call time, snapshot() throws the
// typed ValidationDriverUnavailableError (NOT a raw module-load crash) — callers can fall back to
// NoopDriver for graceful degradation. `playwright` lives in package.json `optionalDependencies`
// (NOT dependencies) so `npm install` does not pull it by default.

import {
  type RuntimeSnapshot,
  type ValidationDriver,
  ValidationDriverUnavailableError,
} from "./driver.js";

// @MX:WARN: [AUTO] dynamic import of optional peer dep `playwright` — must stay lazy so the
//          module loads without playwright installed (REQ-TY-016).
// @MX:REASON: a top-level `import "playwright"` would crash module load in playwright-less envs,
//             violating REQ-TY-016 graceful degradation. The dynamic import is confined to
//             loadPlaywright(), invoked only from snapshot().
// @MX:SPEC: SPEC-TINY-YEAH-001 REQ-TY-015, REQ-TY-016

const NAV_TIMEOUT_MS = 5_000;
const INNER_TEXT_TIMEOUT_MS = 5_000;

export class PlaywrightDriver implements ValidationDriver {
  public readonly name = "playwright";

  async snapshot(url: string): Promise<RuntimeSnapshot> {
    const mod = await loadPlaywright(this.name);
    const browser = await mod.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const response = await page.goto(url, {
        timeout: NAV_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      });
      if (response === null || !response.ok()) {
        throw new ValidationDriverUnavailableError(
          this.name,
          `Runtime URL did not return an OK response: ${url}`,
        );
      }
      const bodyText = await page.locator("body").innerText({
        timeout: INNER_TEXT_TIMEOUT_MS,
      });
      return { url, bodyText };
    } catch (error) {
      if (error instanceof ValidationDriverUnavailableError) {
        throw error;
      }
      throw new ValidationDriverUnavailableError(
        this.name,
        error instanceof Error ? error.message : `Runtime URL is unreachable: ${url}`,
        { cause: error instanceof Error ? error : undefined },
      );
    } finally {
      await browser.close();
    }
  }
}

/**
 * Lazily import the `playwright` module. When the package is absent (optionalDependencies not
 * installed), Node throws ERR_MODULE_NOT_FOUND; we translate that into the typed
 * ValidationDriverUnavailableError so callers can degrade gracefully (REQ-TY-016).
 */
async function loadPlaywright(driverName: string): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new ValidationDriverUnavailableError(
      driverName,
      `playwright module is not installed (optional dependency); install it to enable runtime validation. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
