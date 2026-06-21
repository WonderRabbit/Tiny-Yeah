// Tiny-Yeah model-contract boundary gatekeeper (SPEC-TINY-YEAH-001 REQ-TY-003/007/027/029,
// plan.md §3.7 T1-T6, §3.8 M3).
//
// `validateModelEmission(emission, root)` is the ONLY function that turns a raw model emission
// into a ValidatedIntent the head may act on. It enforces, in order:
//   1. encoding sanity — every string field must be encodable as UTF-8 (no lone surrogates),
//      else INVALID_ENCODING (T4). Done before zod so malformed strings never reach the schema.
//   2. zod shape (strict) — extra/unknown fields -> UNKNOWN_INTENT_FIELD (T3); a missing
//      schemaVersion on a manifest -> MISSING_SCHEMA_VERSION (T5, REQ-TY-029), distinguished
//      from other shape errors.
//   3. input budget — any inline `content` over MANIFEST_INPUT_BUDGET_CHARS on a manifest action
//      -> MANIFEST_CONTENT_OVER_BUDGET (T2, REQ-TY-027). `sourcePointer` references are exempt.
//   4. path safety — every action path resolves inside root both lexically AND (for write
//      intents) via realpath, so a symlink whose target escapes root is rejected (T1, T6,
//      REQ-TY-007). `..` escape -> PATH_ESCAPES_ROOT.
//
// Returns a typed ValidatedIntent or throws ModelContractError (stable code + recoveryHint).
// Synchronous EXCEPT the realpath leg; the public API is async to accommodate it. Callers in the
// head always `await` this.

import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolvePathInsideRoot } from "../core/state/path-safety.js";
import { MANIFEST_INPUT_BUDGET_CHARS } from "./budgets.js";
import { ModelContractError } from "./errors.js";
import { type Intent, intentSchema } from "./intents.js";

export type ValidatedIntent = Intent;

function containsLoneSurrogate(value: string): boolean {
  // encodeURIComponent throws on lone surrogates (URI malformed), which is exactly the
  // "cannot be encoded as UTF-8" property we need to reject (T4).
  try {
    encodeURIComponent(value);
    return false;
  } catch {
    return true;
  }
}

function hasLoneSurrogateIn(value: unknown): boolean {
  if (typeof value === "string") return containsLoneSurrogate(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogateIn);
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      if (hasLoneSurrogateIn(v)) return true;
    }
  }
  return false;
}

function isZodErrorLike(error: unknown): error is { issues?: Array<{ path?: PropertyKey[] }> } {
  return error instanceof Error && Array.isArray((error as { issues?: unknown }).issues);
}

export async function validateModelEmission(
  emission: unknown,
  root: string,
): Promise<ValidatedIntent> {
  // 1. Encoding sanity (T4) — before any schema work.
  if (hasLoneSurrogateIn(emission)) {
    throw new ModelContractError({
      code: "INVALID_ENCODING",
      message: "Model emission contains a string with a lone surrogate (invalid UTF-8).",
      recoveryHint:
        "Re-emit the payload with valid UTF-8 strings; lone surrogates are not encodable.",
    });
  }

  // 2. zod shape (T3 strict / T5 schemaVersion).
  let parsed: Intent;
  try {
    parsed = intentSchema.parse(emission);
  } catch (error) {
    if (isZodErrorLike(error) && error.issues) {
      for (const issue of error.issues) {
        const pathKey = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path ?? "");
        if (pathKey.includes("schemaVersion")) {
          throw new ModelContractError({
            code: "MISSING_SCHEMA_VERSION",
            message: "Manifest payload is missing or carries an unrecognized schemaVersion.",
            recoveryHint:
              "Set schemaVersion to the current literal on every manifest (see core/checkpoint/contracts.ts).",
            cause: error,
          });
        }
      }
    }
    throw new ModelContractError({
      code: "UNKNOWN_INTENT_FIELD",
      message: "Model emission failed intent-schema validation (unknown field or bad shape).",
      recoveryHint:
        "Emit one of the typed intents in model-contract/intents.ts with no extra fields.",
      cause: error,
    });
  }

  // 3. Input budget + 4. path safety — only commitManifest carries a manifest.
  if (parsed.type === "commitManifest") {
    await validateManifestAgainstRoot(parsed.manifest, root);
  }

  return parsed;
}

async function validateManifestAgainstRoot(
  manifest: {
    actions: ReadonlyArray<{
      path: string;
      content?: string | undefined;
      sourcePointer?: string | undefined;
    }>;
  },
  root: string,
): Promise<void> {
  for (const action of manifest.actions) {
    // 3. Input budget (T2). sourcePointer references are exempt (REQ-TY-027).
    if (action.content !== undefined && action.content.length > MANIFEST_INPUT_BUDGET_CHARS) {
      throw new ModelContractError({
        code: "MANIFEST_CONTENT_OVER_BUDGET",
        message: `Action content is ${action.content.length} chars; input budget is ${MANIFEST_INPUT_BUDGET_CHARS}.`,
        recoveryHint:
          "Stage the content under .tiny-yeah/staging/<sha256> and reference it via sourcePointer.",
      });
    }

    // 4. Path safety — lexical first (catches `..` cheaply, T1).
    const lexical = resolvePathInsideRoot(root, action.path);
    if (!lexical) {
      throw new ModelContractError({
        code: "PATH_ESCAPES_ROOT",
        message: `Action path "${action.path}" escapes root "${root}".`,
        recoveryHint: `Use a path relative to the project root without \`..\` segments.`,
      });
    }

    // Realpath leg (T6): if the lexically-valid target passes through a symlink whose target
    // escapes root, reject. ENOENT (target not yet created — the normal create-only case) is
    // NOT an escape; we resolve the longest existing prefix.
    if (await realpathEscapesRoot(lexical, root)) {
      throw new ModelContractError({
        code: "PATH_ESCAPES_ROOT",
        message: `Action path "${action.path}" resolves (via symlink) outside root "${root}".`,
        recoveryHint:
          "Remove or retarget the symlink so its realpath stays inside the project root.",
      });
    }
  }
}

async function realpathEscapesRoot(target: string, root: string): Promise<boolean> {
  // Walk up from the target resolving the longest existing ancestor, then compare realpaths.
  // This catches `escape-link/pwned.ts` where `escape-link` is a symlink to outside root even
  // though the child does not exist yet.
  let candidate = target;
  for (let i = 0; i < 64; i += 1) {
    try {
      const [realTarget, realRoot] = await Promise.all([realpath(candidate), realpath(root)]);
      const rel = path.relative(realRoot, realTarget);
      const safe = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      return !safe;
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Unexpected error — fail closed (treat as escape).
        return true;
      }
      // ENOENT: the segment does not exist; ascend to its parent and re-resolve.
      const parent = path.dirname(candidate);
      if (parent === candidate) return false; // reached fs root without finding a symlink
      candidate = parent;
    }
  }
  return false; // bounded loop exhausted without evidence of escape
}
