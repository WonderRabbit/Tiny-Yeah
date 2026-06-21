// CHARACTERIZATION: Tinker.Gen donor apply/preview safety invariant.
// Sources: ../../Tinker.Gen/src/apply/apply.ts, ../preview/preview.ts,
//          ../generation/manifest.ts, ../generation/generator.ts
//
// Pins the create-only checkpointed write path that REQ-TY-004/005/006/028 will port in
// Phase 1. Drives the donor end-to-end: build a TemplateManifest -> createPreview -> write
// template-manifest.json -> applyPreview. Captures APPLY_TARGET_EXISTS (re-apply),
// APPLY_LOCKED (held lock), path confinement, the O_NOFOLLOW constant (REQ-TY-005 NF1), and
// the pre-flight (batch all-or-nothing, REQ-TY-028) structure.

import { constants, readFileSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPreview } from "../../../Tinker.Gen/src/apply/apply.ts";
import { TinkerError } from "../../../Tinker.Gen/src/core/errors.ts";
import { writeJsonFile } from "../../../Tinker.Gen/src/core/json.ts";
import type { TemplateManifest } from "../../../Tinker.Gen/src/generation/manifest.ts";
import { createPreview } from "../../../Tinker.Gen/src/preview/preview.ts";

// Minimal valid manifest matching templateManifestSchema (Tinker.Gen/src/generation/manifest.ts).
function sampleManifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: "tinker.template-manifest.v1",
    template: { id: "component-scaffold", version: "0.1.0" },
    language: "typescript",
    layers: ["component"],
    component: {
      name: "widget",
      exportName: "Widget",
      description: "A widget.",
    },
    output: { root: ".tinker/generated" },
    ...overrides,
  };
}

async function prepareOutDir(): Promise<string> {
  const outDir = await mkdtemp(path.join(tmpdir(), "ty-apply-"));
  return outDir;
}

function expectTinkerCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TinkerError);
  expect((error as TinkerError).code).toBe(code);
}

describe("Tinker.Gen donor apply — O_NOFOLLOW symlink-attack primitive (REQ-TY-005 NF1)", () => {
  // The donor source MUST use the explicit constant combination O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW
  // and NOT rely on the "wx" shorthand (which omits O_NOFOLLOW).
  const applySource = readFileSync(
    path.resolve(__dirname, "..", "..", "..", "Tinker.Gen", "src", "apply", "apply.ts"),
    "utf8",
  );

  it("writeTempFile uses constants.O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW with 0o600 mode", () => {
    // Donor (apply.ts:243-245) uses the fully-qualified `constants.O_CREAT | ...` form.
    expect(applySource).toContain(
      "constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW",
    );
    expect(applySource).toContain("0o600");
  });

  it("writeTempFile uses async node:fs/promises open() (not openSync)", () => {
    // NF3: async primitive is inherited from the donor.
    expect(applySource).toMatch(/await open\(/);
  });

  it("does not use the bare 'wx' shorthand for temp-file creation", () => {
    // The acquireLock uses open(path, "wx") for the apply.lock sentinel (a lock marker, not a
    // content temp file) — that is acceptable. The CONTENT temp file (writeTempFile) must use
    // the explicit O_NOFOLLOW combination. We assert writeTempFile's body does not use "wx".
    const writeTempFileSection = applySource.split("async function writeTempFile")[1] ?? "";
    expect(writeTempFileSection).not.toMatch(/open\(\s*path,\s*"wx"/);
  });

  it("fs.constants.O_NOFOLLOW is a real constant on this platform", () => {
    expect(typeof constants.O_NOFOLLOW).toBe("number");
    expect(constants.O_NOFOLLOW).toBeGreaterThan(0);
  });
});

describe("Tinker.Gen donor apply — create-only end-to-end", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await prepareOutDir();
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  async function previewAndSeed(manifest: TemplateManifest = sampleManifest()) {
    const { preview, checkpoint } = await createPreview({ manifest, outDir });
    // createPreview writes previews/<id>.json + checkpoints/<id>.json. applyPreview also reads
    // template-manifest.json from outDir (assertCurrentManifest).
    await writeJsonFile(path.join(outDir, "template-manifest.json"), manifest);
    return { preview, checkpoint, manifest };
  }

  it("writes create-only files from a checkpointed preview", async () => {
    const { preview } = await previewAndSeed();
    const written = await applyPreview({ previewId: preview.previewId, outDir });
    expect(written.length).toBe(preview.actions.length);
    for (const action of preview.actions) {
      const raw = await readFile(action.path, "utf8");
      expect(raw).toBe(action.content);
    }
  });

  it("rejects a second apply with APPLY_TARGET_EXISTS (create-only, no overwrite path)", async () => {
    const { preview } = await previewAndSeed();
    await applyPreview({ previewId: preview.previewId, outDir });

    // Re-seed the template-manifest.json (apply wrote diagnostics.json but not the manifest;
    // it is still there from previewAndSeed). Re-applying the same preview: all targets exist.
    let caught: unknown;
    try {
      await applyPreview({ previewId: preview.previewId, outDir });
    } catch (error) {
      caught = error;
    }
    expectTinkerCode(caught, "APPLY_TARGET_EXISTS");
  });

  it("rejects apply when apply.lock is already held (APPLY_LOCKED, no queue)", async () => {
    const { preview } = await previewAndSeed();
    // Pre-create the apply.lock sentinel to simulate a concurrent apply.
    const lockPath = path.join(outDir, "apply.lock");
    await mkdir(path.dirname(lockPath), { recursive: true });
    const handle = await open(lockPath, "wx");
    try {
      let caught: unknown;
      try {
        await applyPreview({ previewId: preview.previewId, outDir });
      } catch (error) {
        caught = error;
      }
      expectTinkerCode(caught, "APPLY_LOCKED");
    } finally {
      await handle.close();
    }
  });

  it("rejects a malformed previewId with PREVIEW_REQUIRED", async () => {
    let caught: unknown;
    try {
      await applyPreview({ previewId: "not-a-preview-id", outDir });
    } catch (error) {
      caught = error;
    }
    expectTinkerCode(caught, "PREVIEW_REQUIRED");
  });
});

describe("Tinker.Gen donor apply — pre-flight all-or-nothing structure (REQ-TY-028)", () => {
  // The donor apply separates the pre-flight existence loop (apply.ts:37-49) from the write
  // loop (apply.ts:51-55). This structural invariant is what REQ-TY-028 inherits: a mid-batch
  // existing target aborts with zero files written by the write loop (the pre-flight throws
  // before entering the write loop).
  const applySource = readFileSync(
    path.resolve(__dirname, "..", "..", "..", "Tinker.Gen", "src", "apply", "apply.ts"),
    "utf8",
  );

  it("contains a pre-flight loop that checks every action's existence before the write loop", () => {
    // The pre-flight loop body asserts path safety + existence for each action; the write loop
    // follows it. Both loops iterate `preview.actions`.
    const preflightMatches = applySource.match(/for \(const action of preview\.actions\)/g);
    expect(preflightMatches?.length).toBe(2);
    // Existence check throws APPLY_TARGET_EXISTS inside the FIRST loop (pre-flight).
    const firstLoopEnd = applySource.indexOf("for (const action of preview.actions)");
    const secondLoopStart = applySource.indexOf(
      "for (const action of preview.actions)",
      firstLoopEnd + 1,
    );
    const preflightSection = applySource.slice(firstLoopEnd, secondLoopStart);
    expect(preflightSection).toContain("APPLY_TARGET_EXISTS");
    expect(preflightSection).toContain("await assertSafeCreateTarget");
  });

  it("writeCreateOnlyFile re-checks existence immediately before link (defense in depth)", () => {
    expect(applySource).toContain("async function writeCreateOnlyFile");
    // Per-file atomic write: temp + link, with re-check + EEXIST -> APPLY_TARGET_EXISTS.
    const section = applySource.split("async function writeCreateOnlyFile")[1] ?? "";
    expect(section).toContain("await link(tempPath, path)");
    expect(section).toContain("APPLY_TARGET_EXISTS");
  });
});

describe("Tinker.Gen donor apply — path confinement (REQ-TY-007 integration source)", () => {
  const applySource = readFileSync(
    path.resolve(__dirname, "..", "..", "..", "Tinker.Gen", "src", "apply", "apply.ts"),
    "utf8",
  );

  it("assertSafePathWithinOutDir rejects any normalized path containing a `..` segment", () => {
    const section = applySource.split("async function assertSafePathWithinOutDir")[1] ?? "";
    expect(section).toContain('includes("..")');
  });

  it("hasSymlinkParent + assertParentRealpathInside provide the symlink-outside-root guard", () => {
    expect(applySource).toContain("async function hasSymlinkParent");
    expect(applySource).toContain("async function assertParentRealpathInside");
    // realpath-based confinement uses path.startsWith(`${anchor}${sep}`).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — grepping the donor source for this exact template-literal fragment
    expect(applySource).toContain("${anchor}${sep}");
  });
});

// Helper section removed: reads use node:fs/promises readFile directly.
