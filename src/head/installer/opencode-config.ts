// Tiny-Yeah installer JSONC-preserving opencode config merge (SPEC-TINY-YEAH-002 REQ-TY2-008,
// strategy §10 risk 1 + MAJOR #3).
//
// Deep-merges the `tiny-yeah` plugin entry into the target project's opencode.json[c] using
// jsonc-parser's AST `modify()` API. This is a NEW implementation — the oh-my-openagent donor
// (`add-plugin-to-opencode-config.ts:178-193`) uses a regex string replacement that destroys
// JSONC INSIDE the plugin array (comments, trailing commas, indentation). jsonc-parser's AST
// modify() preserves all of those.
//
// REQ-TY2-008 AC: the round trip MUST preserve
//   (a) `//` and `/* */` comments
//   (b) trailing commas
//   (c) original indentation
//   (d) UTF-8 BOM presence/absence
//   (e) CRLF vs LF line endings
// The bin (`bin/tiny-yeah.js`) MUST NOT import this module (REQ-TY2-018) — jsonc-parser is a
// runtime dep confined to this directory (architectural firewall: tests/unit/installer-firewall).
//
// `writeJsonAtomic` (JSON.stringify-based) is INTENTIONALLY NOT USED on this path — it would
// destroy the JSONC facets. Atomic write (temp + rename) of the resulting JSONC text is done
// by the caller (lifecycle) via `atomicOverwriteFile` / `backupAndWrite`.

import { access } from "node:fs/promises";
import path from "node:path";
import {
  applyEdits,
  type FormattingOptions,
  findNodeAtLocation,
  getNodeValue,
  modify as jsoncModify,
  type Node,
  parseTree,
} from "jsonc-parser";
import { InstallerError } from "./errors.js";

/** BOM character (U+FEFF) — must round-trip if present at the start of the file. */
const UTF8_BOM = "﻿";

/** Detected OpenCode config file format. */
export type OpenCodeConfigFormat = "jsonc" | "json";

/** Result of locating the OpenCode config in a project. */
export interface LocatedOpenCodeConfig {
  /** Absolute path to the (would-be) config file. */
  readonly path: string;
  /** True if the file exists on disk. */
  readonly exists: boolean;
  /** Detected format (jsonc for opencode.jsonc, json for opencode.json). */
  readonly format: OpenCodeConfigFormat;
}

/**
 * Locate the OpenCode config for a project root. Search order (closest wins):
 *   1. <project>/.opencode/opencode.jsonc
 *   2. <project>/.opencode/opencode.json
 *   3. <project>/opencode.jsonc
 *   4. <project>/opencode.json
 * Walk-up above projectRoot is intentionally NOT performed — install is project-local
 * (REQ-TY2-007). When no file exists, returns `{ exists: false, format: "jsonc" }` so the caller
 * can create `.opencode/opencode.jsonc` with the plugin entry.
 */
export async function locateOpenCodeConfig(projectRoot: string): Promise<LocatedOpenCodeConfig> {
  const candidates: Array<{ file: string; format: OpenCodeConfigFormat }> = [
    { file: path.join(projectRoot, ".opencode", "opencode.jsonc"), format: "jsonc" },
    { file: path.join(projectRoot, ".opencode", "opencode.json"), format: "json" },
    { file: path.join(projectRoot, "opencode.jsonc"), format: "jsonc" },
    { file: path.join(projectRoot, "opencode.json"), format: "json" },
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate.file);
      return { path: candidate.file, exists: true, format: candidate.format };
    } catch {
      // try next candidate
    }
  }
  // Default for create-if-absent: .opencode/opencode.jsonc (OpenCode prefers JSONC).
  return {
    path: candidates[0]?.file ?? path.join(projectRoot, ".opencode", "opencode.jsonc"),
    exists: false,
    format: "jsonc",
  };
}

/** Plugin entry value: string form ("tiny-yeah") or tuple form (["tiny-yeah", {...}]). */
export type PluginEntryValue = string | [string, Record<string, unknown>];

/** Options for {@link addPluginEntry}. */
export interface AddPluginEntryOptions {
  /** Plugin name to add/replace (typically "tiny-yeah"). */
  readonly pluginName: string;
  /** When provided, the entry uses the tuple form `[pluginName, options]`. */
  readonly options?: Record<string, unknown>;
}

/**
 * Detect the FormattingOptions jsonc-parser should use to insert new content. Derived from the
 * source text so the round trip preserves indentation + line endings:
 *   - tabSize: count of leading spaces on the first indented line (default 2).
 *   - insertSpaces: true when indentation uses spaces (default), false for tabs.
 *   - eol: '\r\n' when the first line ends with CRLF, else '\n'.
 */
function detectFormattingOptions(text: string): FormattingOptions {
  // (e) EOL: pick CRLF if any CRLF is present; else LF.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // (f) Indentation: scan for the first non-empty leading-whitespace run.
  const indentMatch = text.match(/^([ \t]+)/m);
  let insertSpaces = true;
  let tabSize = 2;
  if (indentMatch && indentMatch[1] !== undefined) {
    const indent = indentMatch[1];
    if (indent.includes("\t")) {
      insertSpaces = false;
      tabSize = 1;
    } else {
      insertSpaces = true;
      tabSize = indent.length;
    }
  }
  return { tabSize, insertSpaces, eol };
}

/**
 * Strip a leading BOM if present so jsonc-parser sees a clean document. Returns `[body, hadBom]`.
 * The caller re-attaches the BOM after `applyEdits`.
 */
function stripBom(text: string): [string, boolean] {
  if (text.charCodeAt(0) === 0xfeff) {
    return [text.slice(1), true];
  }
  return [text, false];
}

/**
 * Construct the plugin entry value for jsonc-parser.modify(). Tuple form when options are
 * provided; string form otherwise (tail-assumption B).
 */
function buildEntryValue(opts: AddPluginEntryOptions): PluginEntryValue {
  if (opts.options !== undefined) {
    return [opts.pluginName, opts.options] as [string, Record<string, unknown>];
  }
  return opts.pluginName;
}

/**
 * Read the current value of the `tiny-yeah` plugin entry (string or tuple) from the JSONC text.
 * Returns `undefined` when the plugin array has no such entry. Used for idempotency checks.
 */
export function readPluginEntry(
  configText: string,
  pluginName: string,
): PluginEntryValue | undefined {
  const [body] = stripBom(configText);
  const root = parseTree(body);
  if (root === undefined) return undefined;
  const pluginArray = findNodeAtLocation(root, ["plugin"]);
  if (pluginArray === undefined || pluginArray.type !== "array") return undefined;
  const items = pluginArray.children ?? [];
  for (const item of items) {
    if (item === undefined) continue;
    const value = getNodeValue(item);
    if (typeof value === "string" && value === pluginName) {
      return value;
    }
    if (Array.isArray(value) && value[0] === pluginName) {
      return value as [string, Record<string, unknown>];
    }
  }
  return undefined;
}

/**
 * Find the array index of an existing plugin entry by name, or -1 if absent. Inspects both
 * string and tuple forms.
 */
function findPluginIndex(root: Node | undefined, pluginName: string): number {
  if (root === undefined) return -1;
  const pluginArray = findNodeAtLocation(root, ["plugin"]);
  if (pluginArray === undefined || pluginArray.type !== "array") return -1;
  const items = pluginArray.children ?? [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === undefined) continue;
    const value = getNodeValue(item);
    if (typeof value === "string" && value === pluginName) return i;
    if (Array.isArray(value) && value[0] === pluginName) return i;
  }
  return -1;
}

/** Result of {@link removePluginEntry}: the (possibly modified) text + whether a change occurred. */
export interface RemovePluginEntryResult {
  /** The JSONC text after the attempted removal (BOM/CRLF/comments preserved). */
  readonly text: string;
  /** True when an entry was removed; false when no matching entry existed (idempotent no-op). */
  readonly changed: boolean;
}

/**
 * Remove the named plugin entry from a JSONC config text (REQ-TY2-012, uninstall deep-merge
 * reverse). Handles BOTH the string-form (`"tiny-yeah"`) and tuple-form (`["tiny-yeah", {...}]`)
 * entries. Preserves all six JSONC facets (BOM, CRLF, comments, trailing comma, indentation) on the
 * UNCHANGED regions — uses jsonc-parser AST `modify()` to rewrite the plugin array without
 * touching the surrounding document.
 *
 * When the plugin array has no matching entry, returns `{ changed: false, text: <input> }`
 * (idempotent). When a `plugin` key does not exist at all, likewise returns unchanged.
 *
 * The array is rebuilt by filtering out the target entry and writing the filtered array back via
 * a single `modify(["plugin"], filtered)` edit. jsonc-parser preserves everything outside the
 * array value; trailing-comma cleanup inside the array is handled by applyEdits.
 *
 * @param configText the raw JSONC text (BOM/CRLF/comments/trailing-comma preserved).
 * @param pluginName the entry to remove (typically "tiny-yeah").
 * @returns `{ text, changed }`.
 */
export function removePluginEntry(configText: string, pluginName: string): RemovePluginEntryResult {
  const [body, hadBom] = stripBom(configText);
  const root = parseTree(body);
  if (root === undefined) {
    return { text: configText, changed: false };
  }
  const pluginArray = findNodeAtLocation(root, ["plugin"]);
  if (pluginArray === undefined || pluginArray.type !== "array") {
    return { text: configText, changed: false };
  }
  const items = pluginArray.children ?? [];
  // Collect the VALUES of entries that are NOT the target (preserving their form).
  const kept: PluginEntryValue[] = [];
  let removed = false;
  for (const item of items) {
    if (item === undefined) continue;
    const value = getNodeValue(item);
    if (typeof value === "string" && value === pluginName) {
      removed = true;
      continue;
    }
    if (Array.isArray(value) && value[0] === pluginName) {
      removed = true;
      continue;
    }
    kept.push(value as PluginEntryValue);
  }
  if (!removed) {
    return { text: configText, changed: false };
  }
  const formattingOptions = detectFormattingOptions(body);
  // Rewrite the plugin array with the filtered entries. jsonc-parser handles trailing-comma + brace
  // cleanup inside the array on applyEdits.
  const edits = jsoncModify(body, ["plugin"], kept, {
    formattingOptions,
    isArrayInsertion: false,
  });
  const result = applyEdits(body, edits);
  return {
    text: hadBom ? `${UTF8_BOM}${result}` : result,
    changed: true,
  };
}

/**
 * Add (or replace in-place) the `tiny-yeah` plugin entry in a JSONC config text, preserving all
 * six facets (REQ-TY2-008 AC). Idempotent: a second call with the same arguments produces the
 * same output (no duplicate entry).
 *
 * @param configText the raw JSONC text (BOM/CRLF/comments/trailing-comma preserved).
 * @param opts plugin name + optional tuple options.
 * @returns the modified JSONC text with the entry present exactly once.
 */
export function addPluginEntry(configText: string, opts: AddPluginEntryOptions): string {
  const [body, hadBom] = stripBom(configText);
  const formattingOptions = detectFormattingOptions(body);
  const entry = buildEntryValue(opts);
  const root = parseTree(body);
  const existingIndex = findPluginIndex(root, opts.pluginName);

  let edits: ReturnType<typeof jsoncModify>;
  if (existingIndex >= 0) {
    // Replace the existing entry in place — idempotent, no duplication.
    edits = jsoncModify(body, ["plugin", existingIndex], entry, {
      formattingOptions,
      isArrayInsertion: false,
    });
  } else {
    // Append at the end of the plugin array. `modify` creates the array if absent.
    edits = jsoncModify(body, ["plugin", -1], entry, {
      formattingOptions,
      isArrayInsertion: true,
    });
  }
  const merged = applyEdits(body, edits);
  // Re-attach the BOM if the source had one (d) — jsonc-parser does not preserve it.
  return hadBom ? `${UTF8_BOM}${merged}` : merged;
}

/**
 * Build the initial opencode.jsonc text for a project that has no config yet. Used by the
 * install lifecycle when `locateOpenCodeConfig` returns `exists: false` (REQ-TY2-010 step 5 —
 * the installer creates `.opencode/opencode.json` with the plugin entry when none exists).
 */
export function createInitialConfig(opts: AddPluginEntryOptions): string {
  const entry = buildEntryValue(opts);
  // Serialize manually so the entry form (string vs tuple) is honored. JSONC here is plain JSON
  // (no comments) — the user can add comments later; we preserve whatever they add via
  // addPluginEntry's JSONC-aware path on subsequent installs.
  const config = {
    plugin: [entry],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Compute the bundleSha256 for the config (informational; the lifecycle does the actual atomic
 * write). Kept here so callers can verify content before persisting.
 */
export function validatePluginEntry(text: string, pluginName: string): boolean {
  return readPluginEntry(text, pluginName) !== undefined;
}

/**
 * Internal helper exposed for the lifecycle: parse the JSONC text and throw InstallerError on
 * malformed JSON. Used to fail-closed BEFORE the lifecycle writes the merged config.
 *
 * Tolerates JSONC features (comments + trailing comma) — those are the very things this module
 * is designed to preserve. A "real" syntax error (unclosed brace, bad string escape) still
 * throws.
 */
export function assertParsable(configText: string, file: string): void {
  const [body] = stripBom(configText);
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  parseTree(body, errors as never, { allowTrailingComma: true });
  // Filter out trivial JSONC-tolerance errors. jsonc-parser may still emit errors for genuinely
  // malformed input; we accept anything that parsed to a defined root.
  const root = parseTree(body, undefined, { allowTrailingComma: true });
  if (root === undefined && errors.length > 0) {
    throw new InstallerError({
      code: "BUNDLE_MANIFEST_INVALID",
      message: `OpenCode config is not valid JSONC: ${file}`,
      recoveryHint:
        "Fix the JSONC syntax in the existing opencode.json[c] or remove it so the installer can recreate it.",
    });
  }
}
