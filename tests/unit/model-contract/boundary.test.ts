// UNIT: model-contract/boundary (SPEC-TINY-YEAH-001 REQ-TY-003/007/027/029, plan.md §3.7 T1-T6).
// The gatekeeper: validateModelEmission(emission, root). Every adversarial shape is REJECTED
// with a stable ModelContractError code; a valid emission returns a typed ValidatedIntent.

import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateModelEmission } from "../../../src/model-contract/boundary.js";
import { isModelContractError } from "../../../src/model-contract/errors.js";

function baseEmission(overrides: Record<string, unknown> = {}) {
  return {
    type: "commitManifest",
    manifest: {
      schemaVersion: "tiny-yeah.mutation-manifest.v1",
      actions: [{ kind: "create", path: "src/a.ts", content: "a", sha256: "0".repeat(64) }],
    },
    ...overrides,
  };
}

async function expectRejected(emission: unknown, root: string, code: string): Promise<void> {
  try {
    await validateModelEmission(emission, root);
    throw new Error(`expected emission to be rejected with ${code}, but it was accepted`);
  } catch (error) {
    if (!isModelContractError(error)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("validateModelEmission — happy path", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-boundary-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts a well-formed commitManifest emission and returns a ValidatedIntent", async () => {
    const result = await validateModelEmission(baseEmission(), root);
    expect(result.type).toBe("commitManifest");
  });

  it("accepts a healthCheck emission", async () => {
    const result = await validateModelEmission({ type: "healthCheck" }, root);
    expect(result.type).toBe("healthCheck");
  });
});

describe("validateModelEmission — REQ-TY-003/027/029 rejections (plan.md §3.7 T1-T6)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-boundary-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("T1: path containing `..` -> PATH_ESCAPES_ROOT (M1 adversarial)", async () => {
    const bad = baseEmission({
      manifest: {
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [
          {
            kind: "create",
            path: "../../../etc/passwd",
            content: "x",
            sha256: "0".repeat(64),
          },
        ],
      },
    });
    await expectRejected(bad, root, "PATH_ESCAPES_ROOT");
  });

  it("T2: inline content > 4000 chars -> MANIFEST_CONTENT_OVER_BUDGET (REQ-TY-027)", async () => {
    const over = baseEmission({
      manifest: {
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [
          {
            kind: "create",
            path: "big.txt",
            content: "x".repeat(4001),
            sha256: "0".repeat(64),
          },
        ],
      },
    });
    await expectRejected(over, root, "MANIFEST_CONTENT_OVER_BUDGET");
  });

  it("T2b: sourcePointer reference bypasses the content budget (REQ-TY-027 exception)", async () => {
    const ok = baseEmission({
      manifest: {
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [
          {
            kind: "create",
            path: "out.txt",
            sourcePointer: ".tiny-yeah/staging/abc",
            sha256: "0".repeat(64),
          },
        ],
      },
    });
    const result = await validateModelEmission(ok, root);
    expect(result.type).toBe("commitManifest");
  });

  it("T3: unknown/extra field on intent -> UNKNOWN_INTENT_FIELD (REQ-TY-003)", async () => {
    const bad = baseEmission({ evilExtra: "boom" });
    await expectRejected(bad, root, "UNKNOWN_INTENT_FIELD");
  });

  it("T4: a string field containing a lone surrogate (invalid UTF-8) -> INVALID_ENCODING", async () => {
    const bad = baseEmission({
      manifest: {
        schemaVersion: "tiny-yeah.mutation-manifest.v1",
        actions: [
          {
            kind: "create",
            path: "src/\uD800.ts", // lone high surrogate
            content: "a",
            sha256: "0".repeat(64),
          },
        ],
      },
    });
    await expectRejected(bad, root, "INVALID_ENCODING");
  });

  it("T5: manifest missing schemaVersion -> MISSING_SCHEMA_VERSION (REQ-TY-029)", async () => {
    const bad = {
      type: "commitManifest",
      manifest: {
        actions: [{ kind: "create", path: "src/a.ts", content: "a", sha256: "0".repeat(64) }],
      },
    };
    await expectRejected(bad, root, "MISSING_SCHEMA_VERSION");
  });

  it("T6: symlink whose realpath escapes root -> PATH_ESCAPES_ROOT (M1 adversarial)", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "ty-outside-"));
    try {
      const linkPath = path.join(root, "escape-link");
      await symlink(outside, linkPath);
      const bad = baseEmission({
        manifest: {
          schemaVersion: "tiny-yeah.mutation-manifest.v1",
          actions: [
            {
              kind: "create",
              path: "escape-link/pwned.ts",
              content: "x",
              sha256: "0".repeat(64),
            },
          ],
        },
      });
      await expectRejected(bad, root, "PATH_ESCAPES_ROOT");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("every rejected emission carries an actionable recoveryHint (plan.md §3.8 M3)", async () => {
    const cases: Array<{ emission: unknown; code: string }> = [
      { emission: baseEmission({ evil: 1 }), code: "UNKNOWN_INTENT_FIELD" },
      {
        emission: baseEmission({
          manifest: {
            schemaVersion: "tiny-yeah.mutation-manifest.v1",
            actions: [{ kind: "create", path: "../x", content: "a", sha256: "0".repeat(64) }],
          },
        }),
        code: "PATH_ESCAPES_ROOT",
      },
    ];
    for (const c of cases) {
      try {
        await validateModelEmission(c.emission, root);
        throw new Error("expected rejection");
      } catch (error) {
        if (!isModelContractError(error)) throw error;
        expect(error.code).toBe(c.code);
        expect(typeof error.recoveryHint).toBe("string");
        expect((error.recoveryHint ?? "").length).toBeGreaterThan(0);
      }
    }
  });
});
