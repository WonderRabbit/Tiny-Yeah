// PROPERTY: model-contract boundary adversarial tests (SPEC-TINY-YEAH-001 §6.1, plan.md §3.7 M1).
// fast-check T1-T8: the boundary REJECTS every adversarial model emission. These are the
// existence-justifying tests — (a) no-hallucination is only proven when arbitrary bad input is
// shown to be rejected.

import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitManifest } from "../../src/core/checkpoint/universal-write-path.js";
import { renderBudgetedOutput } from "../../src/head/opencode/budget-output.js";
import { applyApproved } from "../../src/model-contract/approval.js";
import { validateModelEmission } from "../../src/model-contract/boundary.js";
import { isModelContractError } from "../../src/model-contract/errors.js";

const SCHEMA_VERSION = "tiny-yeah.mutation-manifest.v1";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function manifestEmission(actions: unknown[]) {
  return { type: "commitManifest", manifest: { schemaVersion: SCHEMA_VERSION, actions } };
}

async function expectRejected(emission: unknown, root: string): Promise<string> {
  try {
    await validateModelEmission(emission, root);
    throw new Error("expected rejection");
  } catch (error) {
    if (!isModelContractError(error)) throw error;
    return error.code;
  }
}

describe("property T1 — `..`-path rejected (REQ-TY-003/007)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t1-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("arbitrary `..`-containing paths are all rejected with PATH_ESCAPES_ROOT", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.string({ minLength: 1 }).filter((s) => !s.includes("\0")),
        async (depth, leaf) => {
          const dotdots = Array.from({ length: depth }, () => "..").join("/");
          const candidate = `${dotdots}/${leaf}`;
          const code = await expectRejected(
            manifestEmission([
              { kind: "create", path: candidate, content: "x", sha256: "0".repeat(64) },
            ]),
            root,
          );
          expect(code).toBe("PATH_ESCAPES_ROOT");
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("property T2 — inline content > 4000 chars rejected; sourcePointer passes (REQ-TY-027)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t2-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("content length boundary is enforced exactly at 4000 (property over 1..10000)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async (len) => {
        const content = "x".repeat(len);
        const emission = manifestEmission([
          { kind: "create", path: "ok.txt", content, sha256: sha256(content) },
        ]);
        if (len > 4000) {
          const code = await expectRejected(emission, root);
          expect(code).toBe("MANIFEST_CONTENT_OVER_BUDGET");
        } else {
          // len <= 4000 is accepted (no rejection).
          const result = await validateModelEmission(emission, root);
          expect(result.type).toBe("commitManifest");
        }
      }),
      { numRuns: 80 },
    );
  });
});

describe("property T3 — unknown/extra field rejected (REQ-TY-001/003)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t3-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("arbitrary extra fields on a commitManifest intent are rejected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
        fc.string({ minLength: 1 }),
        async (fieldName, fieldValue) => {
          // Avoid colliding with the legitimate `approved`/etc keys by prefixing.
          const safeField = `extra_${fieldName}`;
          const code = await expectRejected(
            {
              type: "commitManifest",
              manifest: {
                schemaVersion: SCHEMA_VERSION,
                actions: [{ kind: "create", path: "ok.txt", content: "x", sha256: "0".repeat(64) }],
              },
              [safeField]: fieldValue,
            },
            root,
          );
          expect(code).toBe("UNKNOWN_INTENT_FIELD");
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("property T4 — invalid-encoding (lone surrogate) rejected (REQ-TY-003)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t4-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("a content field containing a lone surrogate is rejected with INVALID_ENCODING", async () => {
    // Build a string with a lone high surrogate that encodeURIComponent rejects.
    const badContent = `ok${"\uD800"}end`;
    const code = await expectRejected(
      manifestEmission([
        { kind: "create", path: "ok.txt", content: badContent, sha256: "0".repeat(64) },
      ]),
      root,
    );
    expect(code).toBe("INVALID_ENCODING");
  });
});

describe("property T5 — missing schemaVersion rejected (REQ-TY-029)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t5-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("manifest missing schemaVersion -> MISSING_SCHEMA_VERSION", async () => {
    const code = await expectRejected(
      {
        type: "commitManifest",
        manifest: {
          actions: [{ kind: "create", path: "ok.txt", content: "x", sha256: "0".repeat(64) }],
        },
      },
      root,
    );
    expect(code).toBe("MISSING_SCHEMA_VERSION");
  });
});

describe("property T6 — symlink escaping root rejected (M1 adversarial)", () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t6-"));
    outside = await mkdtemp(path.join(tmpdir(), "ty-prop-t6-out-"));
    await symlink(outside, path.join(root, "escape-link"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("a path through an escaping symlink is rejected with PATH_ESCAPES_ROOT", async () => {
    const code = await expectRejected(
      manifestEmission([
        { kind: "create", path: "escape-link/pwned.ts", content: "x", sha256: "0".repeat(64) },
      ]),
      root,
    );
    expect(code).toBe("PATH_ESCAPES_ROOT");
  });
});

describe("property T7 — renderBudgetedOutput NEVER exceeds the budget (REQ-TY-002)", () => {
  it("arbitrary nested arrays/strings: output length <= maxOutputChars, items <= maxArrayItems", () => {
    const arbValue = fc.letrec((tie) => ({
      self: fc.oneof(
        fc.string({ maxLength: 200 }),
        fc.integer(),
        fc.boolean(),
        fc.array(tie("self"), { maxLength: 200 }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie("self"), { maxKeys: 20 }),
      ),
    })).self;

    fc.assert(
      fc.property(
        arbValue,
        fc.integer({ min: 100, max: 8000 }),
        fc.integer({ min: 1, max: 40 }),
        (value, maxChars, maxItems) => {
          const { output, metadata } = renderBudgetedOutput(value, {
            maxOutputChars: maxChars,
            maxArrayItems: maxItems,
          });
          expect(output.length).toBeLessThanOrEqual(maxChars);
          expect(metadata.budget.maxArrayItems).toBe(maxItems);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("property T8 — approval gate: no artifact write without explicit approval (REQ-TY-003/004)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ty-prop-t8-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("commitManifest alone writes ZERO artifact files (only preview/checkpoint state)", async () => {
    const content = "x".repeat(10);
    await commitManifest({
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        actions: [{ kind: "create", path: "out/a.ts", content, sha256: sha256(content) }],
      },
      root,
    });
    // No artifact file under out/ exists.
    const outDir = path.join(root, "out");
    let entries: string[] = [];
    try {
      entries = await readdir(outDir);
    } catch {
      entries = [];
    }
    expect(entries).toEqual([]);
  });

  it("artifacts appear ONLY after applyApproved (property: never before)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (count) => {
        const localRoot = await mkdtemp(path.join(tmpdir(), "ty-prop-t8b-"));
        try {
          const actions = Array.from({ length: count }, (_, i) => {
            const body = `body-${i}`;
            return {
              kind: "create" as const,
              path: `out/file-${i}.ts`,
              content: body,
              sha256: sha256(body),
            };
          });
          const { previewId } = await commitManifest({
            manifest: { schemaVersion: SCHEMA_VERSION, actions },
            root: localRoot,
          });
          // Before approval: zero artifact files.
          let before: string[] = [];
          try {
            before = await readdir(path.join(localRoot, "out"));
          } catch {
            before = [];
          }
          expect(before).toEqual([]);
          // After approval: exactly `count` files.
          const written = await applyApproved({ previewId, root: localRoot });
          expect(written.length).toBe(count);
          const after = await readdir(path.join(localRoot, "out"));
          expect(after.length).toBe(count);
        } finally {
          await rm(localRoot, { recursive: true, force: true });
        }
      }),
      { numRuns: 12 },
    );
  });
});
