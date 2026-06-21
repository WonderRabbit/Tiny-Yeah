// UNIT: head/library/focus-packet (SPEC-TINY-YEAH-001 REQ-TY-025, plan.md §3.8 M2).
//
// buildTaskFocusPacket produces the BOUNDED compaction-discipline primitive. On a context-
// compaction event the kernel injects ONLY this packet — never the full task state, plans,
// analysis output, evidence, UI-IR, or lock directory contents (REQ-TY-025 AC).
//
// The packet shape (plan.md §3.8 M2):
//   { activeIntent, lastPreviewHash, actionPathSummary[], blockerHint? }
// — path SUMMARY strings only, never file bodies. Capped by DEFAULT_OUTPUT_BUDGET.

import { describe, expect, it } from "vitest";
import {
  buildTaskFocusPacket,
  MAX_ACTION_PATH_SUMMARY_ENTRIES,
  type TaskFocusPacket,
  type TaskFocusState,
} from "../../../../src/head/library/focus-packet.js";
import { DEFAULT_OUTPUT_BUDGET } from "../../../../src/model-contract/budgets.js";

describe("buildTaskFocusPacket — REQ-TY-025 bounded compaction primitive", () => {
  it("returns the M2 typed shape (activeIntent, lastPreviewHash, actionPathSummary, blockerHint?)", () => {
    const state: TaskFocusState = {
      activeIntent: "commitManifest",
      lastPreviewHash: "sha256:abc123",
      actionPaths: ["src/auth/handler.ts", "src/auth/login.ts"],
    };
    const packet = buildTaskFocusPacket(state);
    expect(packet.schemaVersion).toBe("tiny-yeah.task-focus.v1");
    expect(packet.activeIntent).toBe("commitManifest");
    expect(packet.lastPreviewHash).toBe("sha256:abc123");
    expect(packet.actionPathSummary).toEqual(["src/auth/handler.ts", "src/auth/login.ts"]);
    expect(packet.blockerHint).toBeUndefined();
  });

  it("preserves an optional blockerHint", () => {
    const packet = buildTaskFocusPacket({
      activeIntent: "applyApproved",
      lastPreviewHash: "sha256:deadbeef",
      actionPaths: [],
      blockerHint: "awaiting human approval for destructive rename",
    });
    expect(packet.blockerHint).toBe("awaiting human approval for destructive rename");
  });

  it("caps actionPathSummary to MAX_ACTION_PATH_SUMMARY_ENTRIES with an omitted-count marker", () => {
    const many: string[] = [];
    for (let index = 0; index < MAX_ACTION_PATH_SUMMARY_ENTRIES + 50; index += 1) {
      many.push(`src/file${index}.ts`);
    }
    const packet = buildTaskFocusPacket({
      activeIntent: "commitManifest",
      lastPreviewHash: "sha256:x",
      actionPaths: many,
    });
    expect(packet.actionPathSummary.length).toBe(MAX_ACTION_PATH_SUMMARY_ENTRIES);
    expect(packet.omittedActionPaths).toBe(50);
  });

  it("serialized form NEVER exceeds DEFAULT_OUTPUT_BUDGET.chars (REQ-TY-002 boundary)", () => {
    // Path summaries only, but feed very long path strings to exercise the char cap.
    const longPath = `${"x".repeat(500)}.ts`;
    const state: TaskFocusState = {
      activeIntent: "commitManifest",
      lastPreviewHash: `sha256:${"y".repeat(2000)}`,
      actionPaths: Array.from({ length: 200 }, () => longPath),
      blockerHint: "z".repeat(2000),
    };
    const packet = buildTaskFocusPacket(state);
    const serialized = JSON.stringify(packet);
    expect(serialized.length).toBeLessThanOrEqual(DEFAULT_OUTPUT_BUDGET.chars);
  });

  it("omits file BODIES — actionPaths are path strings, not content", () => {
    const packet = buildTaskFocusPacket({
      activeIntent: "commitManifest",
      lastPreviewHash: "sha256:1",
      actionPaths: ["src/a.ts"],
    });
    const serialized = JSON.stringify(packet);
    // No field carries raw source content. The packet is path-summary only.
    expect(serialized).not.toContain("fileContent");
    expect(serialized).not.toContain("body");
    expect(packet.actionPathSummary.every((p) => !p.includes("\n"))).toBe(true);
  });

  it("returns a valid empty-state packet when state has no active intent", () => {
    const packet: TaskFocusPacket = buildTaskFocusPacket({
      activeIntent: undefined,
      lastPreviewHash: undefined,
      actionPaths: [],
    });
    expect(packet.activeIntent).toBeNull();
    expect(packet.lastPreviewHash).toBeNull();
    expect(packet.actionPathSummary).toEqual([]);
    expect(packet.omittedActionPaths).toBe(0);
  });
});
