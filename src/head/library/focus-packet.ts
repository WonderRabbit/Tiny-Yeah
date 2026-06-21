// Tiny-Yeah head/library focus-packet (SPEC-TINY-YEAH-001 REQ-TY-025, plan.md §3.8 M2).
//
// The BOUNDED compaction-discipline primitive. On a context-compaction event the kernel injects
// ONLY this packet into the model context — never the full task state, plans, analysis output,
// evidence, UI-IR, or lock directory contents (REQ-TY-025 AC).
//
// Packet shape (plan.md §3.8 M2): { activeIntent, lastPreviewHash, actionPathSummary[],
// blockerHint? } — path SUMMARY strings only, never file bodies. actionPathSummary is capped to
// MAX_ACTION_PATH_SUMMARY_ENTRIES with an omitted-count marker; the whole packet is char-capped
// against DEFAULT_OUTPUT_BUDGET so it can never exceed the model output budget (REQ-TY-002).

import { DEFAULT_OUTPUT_BUDGET } from "../../model-contract/budgets.js";

/** Maximum number of action path summaries retained in the packet (plan.md §3.8 M2 cap). */
export const MAX_ACTION_PATH_SUMMARY_ENTRIES = 20;

/** Packet version (REQ-TY-029 schemaVersion discipline). */
export const TASK_FOCUS_PACKET_SCHEMA_VERSION = "tiny-yeah.task-focus.v1" as const;

/**
 * Input state — the caller populates this from `.tiny-yeah/` reads (intent log, most-recent
 * preview manifest hash, the action path list from the manifest). NO file bodies here.
 */
export interface TaskFocusState {
  readonly activeIntent: string | undefined;
  readonly lastPreviewHash: string | undefined;
  readonly actionPaths: readonly string[];
  readonly blockerHint?: string;
}

/**
 * The bounded packet. `actionPathSummary` holds at most MAX_ACTION_PATH_SUMMARY_ENTRIES path
 * strings; `omittedActionPaths` reports how many were dropped. `activeIntent`/
 * `lastPreviewHash` are `null` when absent (not `undefined`) so the serialized shape is stable.
 */
export interface TaskFocusPacket {
  readonly schemaVersion: typeof TASK_FOCUS_PACKET_SCHEMA_VERSION;
  readonly activeIntent: string | null;
  readonly lastPreviewHash: string | null;
  readonly actionPathSummary: readonly string[];
  readonly omittedActionPaths: number;
  readonly blockerHint?: string;
}

/**
 * Build a bounded task-focus packet from kernel state. The result is ALWAYS within
 * DEFAULT_OUTPUT_BUDGET.chars when JSON-serialized.
 */
export function buildTaskFocusPacket(state: TaskFocusState): TaskFocusPacket {
  const visiblePaths = state.actionPaths.slice(0, MAX_ACTION_PATH_SUMMARY_ENTRIES);
  const omittedActionPaths = Math.max(0, state.actionPaths.length - visiblePaths.length);

  // Cap the blocker hint so it cannot blow the budget on its own.
  const blockerHint =
    state.blockerHint !== undefined && state.blockerHint.length > 0
      ? state.blockerHint.slice(0, DEFAULT_OUTPUT_BUDGET.chars)
      : undefined;

  // Build the candidate packet, then shrink path summaries (drop longest-surplus first) until
  // the serialized form fits the char budget. This guarantees REQ-TY-002 compliance.
  let packet: TaskFocusPacket = {
    schemaVersion: TASK_FOCUS_PACKET_SCHEMA_VERSION,
    activeIntent: state.activeIntent ?? null,
    lastPreviewHash: state.lastPreviewHash ?? null,
    actionPathSummary: [...visiblePaths],
    omittedActionPaths,
    ...(blockerHint !== undefined ? { blockerHint } : {}),
  };

  while (
    JSON.stringify(packet).length > DEFAULT_OUTPUT_BUDGET.chars &&
    packet.actionPathSummary.length > 0
  ) {
    const dropped = packet.actionPathSummary.length - 1;
    packet = {
      ...packet,
      actionPathSummary: packet.actionPathSummary.slice(0, dropped),
      omittedActionPaths: packet.omittedActionPaths + 1,
    };
  }
  return packet;
}
