// Tiny-Yeah model-contract intent family (SPEC-TINY-YEAH-001 REQ-TY-001/003, plan.md §3.1/§3.7).
//
// The ONLY shapes the model may emit across the boundary. Strict zod objects: any extra /
// unknown field is rejected (T3, REQ-TY-003). There is intentionally NO lock acquire/release
// intent (T7) and NO serialized-state / registry-dump intent (T8) — the absence of those keys
// is itself the guarantee that the model cannot emit them. Paths arrive ONLY inside the
// validated MutationManifest (re-validated against root at the boundary), never as free-form
// string fields.
//
// Layering: imports the checkpoint MutationManifest schema (single schema source) and the
// composer-agnostic intent base from core/schema. This module sits ABOVE core (it is the
// contract the head enforces), so importing core types is permitted — the head layer is what
// is forbidden from being imported by core.

import { z } from "zod";
import { mutationManifestSchema } from "../core/checkpoint/contracts.js";

// ---- commitManifest: model proposes an artifact write (preview only, never auto-applied) --
export const commitManifestIntentSchema = z
  .object({
    type: z.literal("commitManifest"),
    manifest: mutationManifestSchema,
  })
  .strict();

// ---- requestApproval: model asks for the bounded summary of an existing preview -----------
export const requestApprovalIntentSchema = z
  .object({
    type: z.literal("requestApproval"),
    previewId: z.string().min(1),
  })
  .strict();

// ---- applyApproved: the ONLY intent that may trigger an artifact file write ---------------
// Distinct from commitManifest so "never auto-apply" is structurally provable: commitManifest
// alone never writes; the model must emit applyApproved referencing a previewId that exists.
export const applyApprovedIntentSchema = z
  .object({
    type: z.literal("applyApproved"),
    previewId: z.string().min(1),
  })
  .strict();

// ---- query: read-only surface (REQ-TY-001 — model can ask, not write) --------------------
export const queryIntentSchema = z
  .object({
    type: z.literal("query"),
    query: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("listPreviews") }).strict(),
      z.object({ kind: z.literal("health") }).strict(),
    ]),
  })
  .strict();

// ---- healthCheck: trivial read-only probe ------------------------------------------------
export const healthCheckIntentSchema = z.object({ type: z.literal("healthCheck") }).strict();

export const intentSchema = z.discriminatedUnion("type", [
  commitManifestIntentSchema,
  requestApprovalIntentSchema,
  applyApprovedIntentSchema,
  queryIntentSchema,
  healthCheckIntentSchema,
]);

export type Intent = z.infer<typeof intentSchema>;
export type CommitManifestIntent = z.infer<typeof commitManifestIntentSchema>;
export type RequestApprovalIntent = z.infer<typeof requestApprovalIntentSchema>;
export type ApplyApprovedIntent = z.infer<typeof applyApprovedIntentSchema>;
export type QueryIntent = z.infer<typeof queryIntentSchema>;
export type HealthCheckIntent = z.infer<typeof healthCheckIntentSchema>;
