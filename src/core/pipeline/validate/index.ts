// Tiny-Yeah pipeline validate barrel + runValidation orchestrator (REQ-TY-015, plan.md §4 Phase 3).
// runValidation threads: driver.snapshot(url) → runtime-matcher → evidence-sanitizer → output.

import { confirmMatchedFacts, createRuntimeEvidence } from "../../evidence/runtime-matcher.js";
import { sanitizeEvidenceValue } from "../../evidence/sanitizer.js";
import type { UiIr } from "../../schema/ui-ir.js";
import {
  type RuntimeSnapshot,
  type ValidationDriver,
  ValidationDriverUnavailableError,
} from "./driver.js";

export type RunValidationOptions = {
  readonly url: string;
  readonly driver: ValidationDriver;
  readonly now?: Date;
};

export type RunValidationResult = {
  readonly url: string;
  readonly checkedAt: string;
  readonly evidence: unknown;
  readonly uiIr: UiIr;
};

export async function runValidation(
  uiIr: UiIr,
  options: RunValidationOptions,
): Promise<RunValidationResult> {
  const now = options.now ?? new Date();
  const snapshot = await resolveSnapshot(options.driver, options.url);
  const evidence = createRuntimeEvidence(uiIr, snapshot, now);
  const confirmed = confirmMatchedFacts(uiIr, evidence.matchedFacts);
  return {
    url: options.url,
    checkedAt: now.toISOString(),
    evidence: sanitizeEvidenceValue(evidence),
    uiIr: confirmed,
  };
}

/**
 * Resolve a snapshot from the driver, translating a typed ValidationDriverUnavailableError into
 * a NoopDriver-equivalent empty snapshot so the pipeline degrades gracefully (REQ-TY-016). The
 * unavailable event is surfaced via the evidence summary rather than crashing the pipeline.
 */
async function resolveSnapshot(driver: ValidationDriver, url: string): Promise<RuntimeSnapshot> {
  try {
    return await driver.snapshot(url);
  } catch (error) {
    if (error instanceof ValidationDriverUnavailableError) {
      // Graceful degradation: emit an empty snapshot so no fact upgrades to runtime-confirmed,
      // while keeping the pipeline running. The unavailable event is recorded in the evidence
      // summary downstream (empty bodyText → all facts unresolved/mismatched).
      return { url, bodyText: "" };
    }
    throw error;
  }
}

export {
  createDriver,
  NoopDriver,
  type RuntimeSnapshot,
  registerDriver,
  registeredDriverNames,
  resetDriverRegistry,
  type ValidationDriver,
  type ValidationDriverErrorCode,
  ValidationDriverUnavailableError,
} from "./driver.js";
export { PlaywrightDriver } from "./playwright-driver.js";
