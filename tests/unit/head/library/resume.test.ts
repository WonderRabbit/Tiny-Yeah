// UNIT: head/library/resume (SPEC-TINY-YEAH-001 REQ-TY-026, plan.md §3.8 M2).
//
// buildResumePacket reads .tiny-yeah/ state on session-resume and returns a BOUNDED summary
// (REQ-TY-026 AC): task count, lock status, most-recent preview hash. It does NOT stream raw
// file contents into the model context. Bounded by DEFAULT_OUTPUT_BUDGET.

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildResumePacket } from "../../../../src/head/library/resume.js";
import { DEFAULT_OUTPUT_BUDGET } from "../../../../src/model-contract/budgets.js";

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp("tiny-yeah-resume-");
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mkdtemp(prefix: string): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `${prefix}${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("buildResumePacket — REQ-TY-026 bounded resume summary", () => {
  it("returns a valid empty-state packet when .tiny-yeah/ is absent (no throw)", async () => {
    await withTempRoot(async (root) => {
      const packet = await buildResumePacket(root);
      expect(packet.schemaVersion).toBe("tiny-yeah.resume.v1");
      expect(packet.taskCount).toBe(0);
      expect(packet.previewCount).toBe(0);
      expect(packet.lockStatus).toBe("free");
      expect(packet.mostRecentPreviewHash).toBeNull();
    });
  });

  it("counts tasks and previews under .tiny-yeah/ without dumping raw contents", async () => {
    await withTempRoot(async (root) => {
      const tinyYeah = path.join(root, ".tiny-yeah");
      await mkdir(path.join(tinyYeah, "tasks"), { recursive: true });
      await mkdir(path.join(tinyYeah, "previews"), { recursive: true });
      await writeFile(
        path.join(tinyYeah, "tasks", "task-1.json"),
        `${JSON.stringify({ schemaVersion: "tiny-yeah.task.v1", huge: "X".repeat(50_000) })}\n`,
      );
      await writeFile(
        path.join(tinyYeah, "tasks", "task-2.json"),
        `${JSON.stringify({ schemaVersion: "tiny-yeah.task.v1" })}\n`,
      );
      await writeFile(
        path.join(tinyYeah, "previews", "preview-aaa.json"),
        `${JSON.stringify({ schemaVersion: "tiny-yeah.preview.v1", manifestHash: "sha256:aaa", createdAt: "2026-06-20T00:00:00.000Z" })}\n`,
      );

      const packet = await buildResumePacket(root);
      expect(packet.taskCount).toBe(2);
      expect(packet.previewCount).toBe(1);
      expect(packet.mostRecentPreviewHash).toBe("sha256:aaa");
    });
  });

  it("does NOT include raw file bodies in the serialized packet", async () => {
    await withTempRoot(async (root) => {
      const tinyYeah = path.join(root, ".tiny-yeah");
      await mkdir(path.join(tinyYeah, "tasks"), { recursive: true });
      const secret = "TOPSECRET_BODY_CONTENT_THAT_MUST_NOT_LEAK_INTO_MODEL_CONTEXT";
      await writeFile(
        path.join(tinyYeah, "tasks", "task-1.json"),
        `${JSON.stringify({ schemaVersion: "tiny-yeah.task.v1", payload: secret })}\n`,
      );

      const packet = await buildResumePacket(root);
      const serialized = JSON.stringify(packet);
      expect(serialized).not.toContain(secret);
      expect(serialized.length).toBeLessThanOrEqual(DEFAULT_OUTPUT_BUDGET.chars);
    });
  });

  it("reports lockStatus as 'acquired' when a lock directory exists under .tiny-yeah/locks/", async () => {
    await withTempRoot(async (root) => {
      const locksDir = path.join(root, ".tiny-yeah", "locks");
      await mkdir(path.join(locksDir, "state-write.lock"), { recursive: true });
      const packet = await buildResumePacket(root);
      expect(packet.lockStatus).toBe("acquired");
      expect(packet.lockCount).toBe(1);
    });
  });

  it("respects the char budget even with many tasks/previews", async () => {
    await withTempRoot(async (root) => {
      const tasksDir = path.join(root, ".tiny-yeah", "tasks");
      await mkdir(tasksDir, { recursive: true });
      for (let index = 0; index < 100; index += 1) {
        await writeFile(
          path.join(tasksDir, `task-${index}.json`),
          `${JSON.stringify({ schemaVersion: "tiny-yeah.task.v1", big: "Y".repeat(10_000) })}\n`,
        );
      }
      const packet = await buildResumePacket(root);
      const serialized = JSON.stringify(packet);
      expect(packet.taskCount).toBe(100);
      expect(serialized.length).toBeLessThanOrEqual(DEFAULT_OUTPUT_BUDGET.chars);
    });
  });
});
