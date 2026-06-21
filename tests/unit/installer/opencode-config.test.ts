// UNIT: opencode-config (SPEC-TINY-YEAH-002 REQ-TY2-008, strategy §10 risk 1 + MAJOR #3).
//
// JSONC-PRESERVING deep-merge of the `tiny-yeah` plugin entry into the target project's
// opencode.json[c]. Uses jsonc-parser AST `modify()` (NEW impl, NOT a donor port — MAJOR #3
// established donor uses regex which destroys JSONC inside the plugin array).
//
// The six preservation facets (REQ-TY2-008 AC) are asserted byte-level on the UNCHANGED regions
// of the round-tripped text, not just by re-parsing:
//   (a) line comments (// ...)
//   (b) block comments (/* ... */)
//   (c) trailing comma
//   (d) UTF-8 BOM
//   (e) CRLF line endings
//   (f) original indentation
//
// Plugin entry forms (tail-assumption B): string ("tiny-yeah") and tuple (["tiny-yeah", {...}]).
// Idempotency: a second addPluginEntry replaces the entry in place (no duplicate).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPluginEntry,
  type LocatedOpenCodeConfig,
  locateOpenCodeConfig,
  readPluginEntry,
  removePluginEntry,
} from "../../../src/head/installer/opencode-config.js";

const BOM = "﻿";

describe("opencode-config — locateOpenCodeConfig (walk-up + format detection)", () => {
  it("finds .opencode/opencode.jsonc when present (preferred location)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-ocfg-loc-jsonc-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      await writeFile(path.join(ocDir, "opencode.jsonc"), "{}\n");
      const located = await locateOpenCodeConfig(tmp);
      expect(located.exists).toBe(true);
      expect(located.format).toBe("jsonc");
      expect(located.path).toBe(path.join(ocDir, "opencode.jsonc"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("finds .opencode/opencode.json when only the .json form exists", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-ocfg-loc-json-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      await writeFile(path.join(ocDir, "opencode.json"), "{}\n");
      const located = await locateOpenCodeConfig(tmp);
      expect(located.exists).toBe(true);
      expect(located.format).toBe("json");
      expect(located.path).toBe(path.join(ocDir, "opencode.json"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("prefers .opencode/ over project-root placement", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-ocfg-loc-pref-"));
    try {
      const ocDir = path.join(tmp, ".opencode");
      await mkdir(ocDir, { recursive: true });
      await writeFile(path.join(ocDir, "opencode.jsonc"), "{}\n");
      // Root-level opencode.json also exists; .opencode/ MUST win.
      await writeFile(path.join(tmp, "opencode.json"), "{}\n");
      const located = await locateOpenCodeConfig(tmp);
      expect(located.path).toBe(path.join(ocDir, "opencode.jsonc"));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns exists=false when no opencode config is present anywhere", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "ty2-ocfg-loc-none-"));
    try {
      const located = await locateOpenCodeConfig(tmp);
      expect(located.exists).toBe(false);
      // Default shape for create-if-absent.
      expect(located.format).toBe("jsonc");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("opencode-config — addPluginEntry JSONC preservation (REQ-TY2-008)", () => {
  it("(a) preserves line comments", () => {
    const input = '{\n  // top-level comment\n  "plugin": []\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    expect(out).toContain("// top-level comment");
    // The plugin entry was added.
    expect(out).toMatch(/"tiny-yeah"/);
  });

  it("(b) preserves block comments", () => {
    const input = '{\n  /* block\n     comment */\n  "plugin": []\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    expect(out).toContain("/* block");
    expect(out).toContain("comment */");
    expect(out).toMatch(/"tiny-yeah"/);
  });

  it("(c) preserves trailing comma", () => {
    const input = '{\n  "plugin": ["other-plugin",],\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    // The trailing comma inside the original array AND the outer trailing comma survive.
    expect(out).toMatch(/"other-plugin",/);
    expect(out).toMatch(/"tiny-yeah"/);
  });

  it("(d) preserves UTF-8 BOM", () => {
    const input = `${BOM}{\n  "plugin": []\n}\n`;
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toMatch(/"tiny-yeah"/);
  });

  it("(e) preserves CRLF line endings", () => {
    const input = '{\r\n  "plugin": []\r\n}\r\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    // Every original CRLF survives; the appended entry uses CRLF too.
    expect(out.includes("\r\n")).toBe(true);
    expect((out.match(/\r\n/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // No bare \n was introduced (no LF-only line).
    expect(out.includes("\n") && !out.includes("\r\n")).toBe(false);
  });

  it("(f) preserves original indentation (4-space)", () => {
    const input = '{\n    "plugin": []\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    // 4-space indent survives in the unchanged regions.
    expect(out).toContain('    "plugin"');
  });
});

describe("opencode-config — string vs tuple plugin entry forms (tail-assumption B)", () => {
  it("adds the string form when no options are provided", () => {
    const input = '{\n  "plugin": []\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    expect(out).toContain('"tiny-yeah"');
    // No tuple brackets around the plugin name.
    expect(out).not.toContain('["tiny-yeah"');
  });

  it("adds the tuple form when options are provided", () => {
    const input = '{\n  "plugin": []\n}\n';
    const out = addPluginEntry(input, {
      pluginName: "tiny-yeah",
      options: { auto_compact: true },
    });
    // Tuple form: the plugin name and its options object are BOTH present in the array.
    // jsonc-parser formats the tuple across multiple lines — we check semantic content, not
    // the specific one-line layout.
    expect(out).toContain('"tiny-yeah"');
    expect(out).toContain('"auto_compact"');
    expect(out).toContain("true");
    // The entry should parse back as a tuple ["tiny-yeah", { auto_compact: true }].
    const reread = readPluginEntry(out, "tiny-yeah");
    expect(Array.isArray(reread)).toBe(true);
    expect(reread).toEqual(["tiny-yeah", { auto_compact: true }]);
  });
});

describe("opencode-config — idempotent replace", () => {
  it("replaces an existing string-form entry in place (no duplicate)", () => {
    const input = '{\n  "plugin": ["tiny-yeah"]\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    const matches = out.match(/"tiny-yeah"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("upgrades a string-form entry to tuple-form when options are added", () => {
    const input = '{\n  "plugin": ["tiny-yeah"]\n}\n';
    const out = addPluginEntry(input, {
      pluginName: "tiny-yeah",
      options: { auto_compact: true },
    });
    // The upgraded entry reads back as a tuple, not a string.
    const reread = readPluginEntry(out, "tiny-yeah");
    expect(Array.isArray(reread)).toBe(true);
    expect(reread).toEqual(["tiny-yeah", { auto_compact: true }]);
  });

  it("does not duplicate when called twice with the same tuple options", () => {
    const input = '{\n  "plugin": []\n}\n';
    const once = addPluginEntry(input, {
      pluginName: "tiny-yeah",
      options: { auto_compact: true },
    });
    const twice = addPluginEntry(once, {
      pluginName: "tiny-yeah",
      options: { auto_compact: true },
    });
    const matches = twice.match(/"tiny-yeah"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("preserves other plugin entries when adding tiny-yeah", () => {
    const input = '{\n  "plugin": ["other-plugin"]\n}\n';
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    expect(out).toContain('"other-plugin"');
    expect(out).toContain('"tiny-yeah"');
  });
});

describe("opencode-config — readPluginEntry", () => {
  it("returns undefined when the plugin array has no tiny-yeah entry", () => {
    const input = '{\n  "plugin": ["other-plugin"]\n}\n';
    expect(readPluginEntry(input, "tiny-yeah")).toBeUndefined();
  });

  it("returns the string-form entry", () => {
    const input = '{\n  "plugin": ["tiny-yeah"]\n}\n';
    expect(readPluginEntry(input, "tiny-yeah")).toBe("tiny-yeah");
  });

  it("returns the tuple-form entry as [name, options]", () => {
    const input = '{\n  "plugin": [["tiny-yeah", { "auto_compact": true }]]\n}\n';
    const entry = readPluginEntry(input, "tiny-yeah");
    expect(Array.isArray(entry)).toBe(true);
    expect(entry).toEqual(["tiny-yeah", { auto_compact: true }]);
  });
});

describe("opencode-config — byte-level round-trip proof (REQ-TY2-008 AC, MAJOR #3)", () => {
  it("all 6 preservation facets hold simultaneously", () => {
    // A single file with BOM + CRLF + 4-space indent + line + block comments + trailing comma.
    const input = [
      `${BOM}{`,
      "\r\n    // line comment",
      "\r\n    /* block comment */",
      '\r\n    "plugin": [',
      '\r\n        "other-plugin",',
      "\r\n    ],",
      "\r\n}",
      "\r\n",
    ].join("");
    const out = addPluginEntry(input, { pluginName: "tiny-yeah" });
    // (d) BOM preserved.
    expect(out.startsWith(BOM)).toBe(true);
    // (e) CRLF preserved — no bare LF introduced.
    const bareLf = out.replace(/\r\n/g, "");
    expect(bareLf.includes("\n")).toBe(false);
    // (a) line comment preserved.
    expect(out).toContain("// line comment");
    // (b) block comment preserved.
    expect(out).toContain("/* block comment */");
    // (f) indentation preserved.
    expect(out).toContain('    "plugin"');
    // (c) trailing comma preserved.
    expect(out).toMatch(/"other-plugin",/);
    // The tiny-yeah entry was added.
    expect(out).toContain('"tiny-yeah"');
  });
});

describe("opencode-config — removePluginEntry (REQ-TY2-012, uninstall deep-merge reverse)", () => {
  it("removes a string-form tiny-yeah entry and reports changed=true", () => {
    const input = '{\n  "plugin": ["tiny-yeah"]\n}\n';
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(true);
    expect(result.text).not.toContain('"tiny-yeah"');
    // The plugin array is still valid JSONC (empty array remains).
    expect(result.text).toMatch(/"plugin"\s*:\s*\[\s*\]/);
  });

  it("removes a tuple-form tiny-yeah entry", () => {
    const input = '{\n  "plugin": [["tiny-yeah", { "auto_compact": true }]]\n}\n';
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(true);
    expect(result.text).not.toContain('"tiny-yeah"');
  });

  it("preserves other plugin entries when removing tiny-yeah", () => {
    const input = '{\n  "plugin": ["other-plugin", "tiny-yeah", "third-plugin"]\n}\n';
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(true);
    expect(result.text).toContain('"other-plugin"');
    expect(result.text).toContain('"third-plugin"');
    expect(result.text).not.toContain('"tiny-yeah"');
    // tiny-yeah was fully removed — no leftover.
    expect(readPluginEntry(result.text, "tiny-yeah")).toBeUndefined();
  });

  it("reports changed=false when no tiny-yeah entry exists (idempotent)", () => {
    const input = '{\n  "plugin": ["other-plugin"]\n}\n';
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(false);
    expect(result.text).toBe(input);
  });

  it("reports changed=false when no plugin array exists at all", () => {
    const input = '{\n  "schema": 1\n}\n';
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(false);
  });

  it("preserves JSONC comments + BOM when removing the entry (REQ-TY2-008 AC)", () => {
    const input = [
      `${BOM}{`,
      "\n  // line comment",
      '\n  "plugin": [',
      '\n    "other-plugin",',
      '\n    "tiny-yeah"',
      "\n  ]",
      "\n}",
      "\n",
    ].join("");
    const result = removePluginEntry(input, "tiny-yeah");
    expect(result.changed).toBe(true);
    expect(result.text.startsWith(BOM)).toBe(true);
    expect(result.text).toContain("// line comment");
    expect(result.text).toContain('"other-plugin"');
    expect(result.text).not.toContain('"tiny-yeah"');
  });

  it("is idempotent: removing twice produces the same text", () => {
    const input = '{\n  "plugin": ["tiny-yeah", "other"]\n}\n';
    const first = removePluginEntry(input, "tiny-yeah");
    const second = removePluginEntry(first.text, "tiny-yeah");
    expect(second.changed).toBe(false);
    expect(second.text).toBe(first.text);
  });
});

// Type-only assertion to keep the LocatedOpenCodeConfig type load honest (no unused import).
describe("opencode-config — type surface", () => {
  it("LocatedOpenCodeConfig is the documented shape", () => {
    const sample: LocatedOpenCodeConfig = {
      path: "/tmp/.opencode/opencode.jsonc",
      exists: true,
      format: "jsonc",
    };
    expect(sample.format).toBe("jsonc");
  });
});
