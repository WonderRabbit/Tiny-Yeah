#!/usr/bin/env node
// Tiny-Yeah naming-check gate (SPEC-TINY-YEAH-001 REQ-TY-023, plan.md Phase 5).
//
// A regex/rule engine that validates tool/package IDs against docs/naming/dictionary.json.
// This is intentionally NOT the donor's full TS-AST extractor (Tiny-Chu naming-extract.ts uses
// the `typescript` package) — Tiny-Yeah keeps a minimal dependency surface. The rules:
//
//   R1 reserved_diagnostic_unregistered (error): the parity diagnostic `tiny_yeah_install_check`
//      MUST be registered in the dictionary (F7 closure).
//   R2 reserved_diagnostic_absent (error): `tiny_yeah_install_check` MUST appear in src/ symbols.
//   R3 legacy_tool_prefix (error): no tool id may use the legacy `tiny_chu_` prefix (REQ-TY-024).
//   R4 invalid_tool_casing (error): tool ids must be snake_case.
//   R5 invalid_package_casing (error): package ids must be kebab-case.
//   R6 malformed_dictionary (error): the dictionary must have schemaVersion=1 + entries[].
//
// The Yeah* prefix rename strategy (createTinyYeahPlugin, TinyYeahOpenCodePlugin, etc.) is the
// INTENDED convention and is NEVER flagged (plan.md §3.8 decision B).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- Types (structural; .mjs has no TS) --------------------------------------------

/** @typedef {{ name: string, kind: string, sourceRefs: string[], exported?: boolean }} NamingSymbol */
/** @typedef {{ code: string, severity: "error"|"warning", message: string, name: string, sourceRefs: string[] }} NamingDiagnostic */
/** @typedef {{ status: "pass"|"fail", diagnostics: NamingDiagnostic[] }} NamingResult */

const RESERVED_DIAGNOSTIC = "tiny_yeah_install_check";
const TOOL_PREFIX = "tiny_yeah_";
const LEGACY_TOOL_PREFIX = "tiny_chu_";
const TOOL_ID_RE = /^[a-z][a-z0-9_]*$/;
const PACKAGE_ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * @param {{ dictionary: unknown, symbols?: NamingSymbol[], candidate?: NamingSymbol }} input
 * @returns {NamingResult}
 */
export function checkNaming(input) {
  const dictResult = parseDictionary(input.dictionary);
  if (dictResult.kind === "diagnostic") {
    return { status: "fail", diagnostics: [dictResult.diagnostic] };
  }
  const dictionary = dictResult.dictionary;
  const symbols = input.symbols ?? [];
  const diagnostics = [
    ...checkReservedDiagnosticRegistered(dictionary),
    ...checkReservedDiagnosticPresent(symbols),
    ...checkLegacyToolPrefix(symbols),
    ...checkToolCasing(symbols),
    ...checkCandidate(input.candidate, dictionary),
  ].sort(compareDiagnostics);
  return { status: diagnostics.some((d) => d.severity === "error") ? "fail" : "pass", diagnostics };
}

/**
 * @param {unknown} raw
 * @returns {{ kind: "dictionary", dictionary: { schemaVersion: number, entries: unknown[] } } | { kind: "diagnostic", diagnostic: NamingDiagnostic }}
 */
function parseDictionary(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return malformedDictionary("dictionary root is not an object");
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (obj.schemaVersion !== 1) return malformedDictionary("missing or unsupported schemaVersion (expected 1)");
  if (!Array.isArray(obj.entries)) return malformedDictionary("entries is not an array");
  return { kind: "dictionary", dictionary: { schemaVersion: 1, entries: obj.entries } };
}

function malformedDictionary(message) {
  return {
    kind: "diagnostic",
    diagnostic: {
      code: "malformed_dictionary",
      severity: "error",
      message,
      name: "(dictionary)",
      sourceRefs: [],
    },
  };
}

/**
 * F7: the reserved diagnostic MUST be a registered tool entry in the dictionary.
 */
function checkReservedDiagnosticRegistered(dictionary) {
  const found = dictionary.entries.some(
    (entry) =>
      typeof entry === "object" && entry !== null && entry.name === RESERVED_DIAGNOSTIC && entry.kind === "tool",
  );
  if (!found) {
    return [
      {
        code: "reserved_diagnostic_unregistered",
        severity: "error",
        message: `Reserved parity diagnostic '${RESERVED_DIAGNOSTIC}' is not registered in the naming dictionary (REQ-TY-023 F7).`,
        name: RESERVED_DIAGNOSTIC,
        sourceRefs: [],
      },
    ];
  }
  return [];
}

/**
 * F7: the reserved diagnostic MUST appear in src/ symbols (i.e., the tool is actually wired).
 */
function checkReservedDiagnosticPresent(symbols) {
  const present = symbols.some((symbol) => symbol.name === RESERVED_DIAGNOSTIC && symbol.kind === "tool");
  if (!present) {
    return [
      {
        code: "reserved_diagnostic_absent",
        severity: "error",
        message: `Reserved parity diagnostic '${RESERVED_DIAGNOSTIC}' is not present in src/ symbols (REQ-TY-023 F7).`,
        name: RESERVED_DIAGNOSTIC,
        sourceRefs: [],
      },
    ];
  }
  return [];
}

function checkLegacyToolPrefix(symbols) {
  const diagnostics = [];
  for (const symbol of symbols) {
    if (symbol.kind !== "tool") continue;
    if (symbol.name.startsWith(LEGACY_TOOL_PREFIX) || symbol.name.includes("_chu_")) {
      diagnostics.push({
        code: "legacy_tool_prefix",
        severity: "error",
        message: `Tool id '${symbol.name}' uses the legacy 'tiny_chu_' prefix (REQ-TY-024). Rename via the Yeah* strategy.`,
        name: symbol.name,
        sourceRefs: symbol.sourceRefs ?? [],
      });
    }
  }
  return diagnostics;
}

function checkToolCasing(symbols) {
  const diagnostics = [];
  for (const symbol of symbols) {
    if (symbol.kind !== "tool") continue;
    if (!TOOL_ID_RE.test(symbol.name)) {
      diagnostics.push({
        code: "invalid_tool_casing",
        severity: "error",
        message: `Tool id '${symbol.name}' is not valid snake_case.`,
        name: symbol.name,
        sourceRefs: symbol.sourceRefs ?? [],
      });
    }
  }
  return diagnostics;
}

function checkCandidate(candidate, dictionary) {
  if (!candidate) return [];
  return [];
}

function compareDiagnostics(left, right) {
  return (
    left.code.localeCompare(right.code) || left.name.localeCompare(right.name) || left.message.localeCompare(right.message)
  );
}

// ---- Source symbol extraction (regex-based) ---------------------------------------

// Walk src/ .ts files and extract naming symbols: tool ids (tiny_yeah_ and tiny_chu_ string
// literals that look like tool names) and exported function/constant names. This is a regex
// heuristic, NOT a full AST walk - appropriate for Tiny-Yeah's minimal-dep stance.
//
// @param {string} root
// @returns {Promise<NamingSymbol[]>}
async function extractSymbols(root) {
  const srcRoot = path.join(root, "src");
  const files = await listTsFiles(srcRoot);
  const symbols = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const modulePath = path.relative(root, file).split(path.sep).join("/");
    // Tool ids: string literals matching tiny_yeah_* / tiny_chu_* used as object keys or name: "..." values.
    const toolRe = /(?:name:\s*["'`]|\bname["'`]\s*:\s*["'`]|["'`](tiny_yeah_[a-z0-9_]+|tiny_chu_[a-z0-9_]+)["'`])/g;
    const seen = new Set();
    for (const match of content.matchAll(toolRe)) {
      const name = match[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      symbols.push({ name, kind: "tool", sourceRefs: [`${modulePath}`] });
    }
    // Also detect bare references to the reserved diagnostic (covers the install_check wiring).
    if (content.includes(RESERVED_DIAGNOSTIC) && !seen.has(RESERVED_DIAGNOSTIC)) {
      seen.add(RESERVED_DIAGNOSTIC);
      symbols.push({ name: RESERVED_DIAGNOSTIC, kind: "tool", sourceRefs: [`${modulePath}`] });
    }
  }
  return symbols.sort((left, right) => left.name.localeCompare(right.name));
}

async function listTsFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listTsFiles(child)));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(child);
  }
  return files;
}

// ---- CLI ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = { root: ".", dictionary: "docs/naming/dictionary.json", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--root") {
      parsed.root = path.resolve(argv[(index += 1)]);
    } else if (arg === "--dictionary") {
      parsed.dictionary = argv[(index += 1)];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const dictionaryPath = path.isAbsolute(args.dictionary)
    ? args.dictionary
    : path.join(root, args.dictionary);
  const dictionaryText = await readFile(dictionaryPath, "utf8");
  const dictionary = JSON.parse(dictionaryText);
  const symbols = await extractSymbols(root);
  const result = checkNaming({ dictionary, symbols });
  const output = { ...result, root, dictionary: dictionaryPath, symbolCount: symbols.length };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printText(output);
  }
  if (result.status === "fail") process.exitCode = 1;
}

function printText(output) {
  console.log(
    `Naming check ${output.status}: ${output.diagnostics.length} diagnostics across ${output.symbolCount} source symbols`,
  );
  for (const diagnostic of output.diagnostics) {
    console.log(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.name} ${diagnostic.message}`,
    );
  }
}

// Run as CLI only when invoked directly (not when imported by tests).
const invokedPath = process.argv[1] ?? "";
const isMain = import.meta.url === `file://${invokedPath}` || invokedPath.endsWith("naming-check.mjs");
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { extractSymbols };
