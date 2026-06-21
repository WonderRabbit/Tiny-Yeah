// Tiny-Yeah head/library resume (SPEC-TINY-YEAH-001 REQ-TY-026, plan.md §3.8 M2).
//
// buildResumePacket reads `.tiny-yeah/` on session-resume (or "detail-lookup" intent) and
// returns a BOUNDED summary (REQ-TY-026 AC): task count, preview count, lock status, most-recent
// preview hash. It does NOT stream raw file contents into the model context — only counts and
// the single most-recent hash. Bounded by DEFAULT_OUTPUT_BUDGET so it can never exceed the model
// output budget (REQ-TY-002).
//
// This pairs with focus-packet.ts: focus-packet is the per-compaction injection; resume-packet
// is the per-resume bounded snapshot. Neither carries file bodies.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "../../core/state/file-store.js";
import { resolveTinyYeahPaths } from "../../core/state/paths.js";
import { DEFAULT_OUTPUT_BUDGET } from "../../model-contract/budgets.js";

/** Packet version (REQ-TY-029 schemaVersion discipline). */
export const RESUME_PACKET_SCHEMA_VERSION = "tiny-yeah.resume.v1" as const;

export interface ResumePacket {
  readonly schemaVersion: typeof RESUME_PACKET_SCHEMA_VERSION;
  readonly root: string;
  readonly taskCount: number;
  readonly previewCount: number;
  readonly lockStatus: "free" | "acquired";
  readonly lockCount: number;
  readonly mostRecentPreviewHash: string | null;
}

interface PreviewRecord {
  readonly manifestHash?: unknown;
  readonly createdAt?: unknown;
}

/**
 * Read `.tiny-yeah/` and produce a bounded resume summary. Missing directories yield a valid
 * empty-state packet (never throws on absent state — only malformed JSON throws, via readJsonFile).
 */
export async function buildResumePacket(root: string): Promise<ResumePacket> {
  const paths = resolveTinyYeahPaths(root);
  const [taskCount, previews, lockCount] = await Promise.all([
    countJsonFiles(paths.tasksDir),
    readPreviewRecords(paths.previewsDir),
    countLockDirs(paths.locksDir),
  ]);

  const mostRecent = pickMostRecentPreview(previews);
  return {
    schemaVersion: RESUME_PACKET_SCHEMA_VERSION,
    root: paths.root,
    taskCount,
    previewCount: previews.length,
    lockStatus: lockCount > 0 ? "acquired" : "free",
    lockCount,
    mostRecentPreviewHash: mostRecent,
  };
}

async function countJsonFiles(dir: string): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).length;
}

async function readPreviewRecords(dir: string): Promise<PreviewRecord[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: PreviewRecord[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    // readJsonFile returns fallback {} on ENOENT; malformed JSON throws (fail-closed).
    const record = await readJsonFile<PreviewRecord>(
      path.join(dir, entry.name),
      {} as PreviewRecord,
    );
    records.push(record);
  }
  return records;
}

async function countLockDirs(dir: string): Promise<number> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock")).length;
}

function pickMostRecentPreview(previews: readonly PreviewRecord[]): string | null {
  if (previews.length === 0) return null;
  let best: { hash: string; createdAt: number } | null = null;
  for (const record of previews) {
    const hash = typeof record.manifestHash === "string" ? record.manifestHash : null;
    if (hash === null) continue;
    const createdAtRaw = record.createdAt;
    const createdAt = typeof createdAtRaw === "string" ? Date.parse(createdAtRaw) : Number.NaN;
    const createdMs = Number.isFinite(createdAt) ? createdAt : 0;
    if (best === null || createdMs > best.createdAt) {
      best = { hash, createdAt: createdMs };
    }
  }
  return best?.hash ?? null;
}

// Keep the budget import live so this module documents its char ceiling even though the
// packet shape is intrinsically bounded (counts + one hash). This prevents accidental future
// expansion from silently violating REQ-TY-002.
export const RESUME_PACKET_BUDGET_CHARS = DEFAULT_OUTPUT_BUDGET.chars;
