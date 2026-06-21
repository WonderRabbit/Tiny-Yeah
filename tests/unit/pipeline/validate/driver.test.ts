// UNIT: ValidationDriver interface + registry + NoopDriver (REQ-TY-015, REQ-TY-016).
// Pins:
//   - NoopDriver returns an empty snapshot and explicitly logs "validation skipped" (REQ-TY-016:
//     not silent — the skip is reported).
//   - Registry: registerDriver / createDriver / unknown-name error.
//   - ValidationDriverUnavailableError is the typed error thrown lazily by capability-flag drivers.

import { afterEach, describe, expect, it } from "vitest";
import {
  createDriver,
  NoopDriver,
  registerDriver,
  registeredDriverNames,
  resetDriverRegistry,
  type ValidationDriver,
  ValidationDriverUnavailableError,
} from "../../../../src/core/pipeline/validate/driver.js";

afterEach(() => {
  resetDriverRegistry();
});

describe("NoopDriver — graceful degradation (REQ-TY-016)", () => {
  it("returns an empty bodyText snapshot so nothing is runtime-confirmed", async () => {
    const driver = new NoopDriver(() => {});
    const snap = await driver.snapshot("http://example/page");
    expect(snap.url).toBe("http://example/page");
    expect(snap.bodyText).toBe("");
  });

  it("explicitly reports the skip via the logger (not silent)", async () => {
    const messages: string[] = [];
    const driver = new NoopDriver((m) => messages.push(m));
    await driver.snapshot("http://example/page");
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("validation skipped");
    expect(messages[0]).toContain("http://example/page");
  });

  it("name is 'noop'", () => {
    expect(new NoopDriver().name).toBe("noop");
  });
});

describe("driver registry", () => {
  it("createDriver returns an instance built by the registered factory", () => {
    registerDriver("noop", () => new NoopDriver(() => {}));
    const driver = createDriver("noop");
    expect(driver.name).toBe("noop");
  });

  it("registeredDriverNames lists registered drivers (sorted)", () => {
    registerDriver("zeta", () => ({
      name: "zeta",
      snapshot: async () => ({ url: "", bodyText: "" }),
    }));
    registerDriver("alpha", () => ({
      name: "alpha",
      snapshot: async () => ({ url: "", bodyText: "" }),
    }));
    expect(registeredDriverNames()).toEqual(["alpha", "zeta"]);
  });

  it("createDriver throws on an unknown driver name", () => {
    expect(() => createDriver("does-not-exist")).toThrowError(/Unknown validation driver/);
  });

  it("re-registering the same name overwrites the factory (capability-flag swap)", () => {
    registerDriver("d", () => ({ name: "v1", snapshot: async () => ({ url: "", bodyText: "" }) }));
    registerDriver("d", () => ({ name: "v2", snapshot: async () => ({ url: "", bodyText: "" }) }));
    expect(createDriver("d").name).toBe("v2");
  });
});

describe("ValidationDriverUnavailableError", () => {
  it("carries the ERR_DRIVER_UNAVAILABLE code and the offending driver name", () => {
    const err = new ValidationDriverUnavailableError("playwright", "playwright module not found");
    expect(err.code).toBe("ERR_DRIVER_UNAVAILABLE");
    expect(err.driverName).toBe("playwright");
    expect(err.message).toContain("playwright module not found");
    expect(err.name).toBe("ValidationDriverUnavailableError");
    expect(err).toBeInstanceOf(Error);
  });

  it("is recognized as a typed driver-unavailable error by callers", () => {
    const err: unknown = new ValidationDriverUnavailableError("playwright", "missing");
    expect(err instanceof ValidationDriverUnavailableError).toBe(true);
  });

  it("satisfies the ValidationDriver interface contract when wrapped in a stub", () => {
    // Smoke: a driver that throws ValidationDriverUnavailableError from snapshot still
    // type-checks as ValidationDriver — the interface only constrains the shape, not behavior.
    const throwingDriver: ValidationDriver = {
      name: "throwy",
      async snapshot() {
        throw new ValidationDriverUnavailableError("throwy", "boom");
      },
    };
    expect(throwingDriver.name).toBe("throwy");
  });
});
