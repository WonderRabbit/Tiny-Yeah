// UNIT: semver (SPEC-TINY-YEAH-002 REQ-TY2-011, strategy §5 version compare).
//
// Minimal semver comparator for the update lifecycle (no `semver` npm dep — constraint §5
// minimal deps). Covers major.minor.patch + optional `-prerelease` per semver.org ordering:
//   - numeric major.minor.patch comparison
//   - prerelease < release (1.0.0-alpha < 1.0.0)
//   - prerelease dot-separated identifier ordering (alpha < alpha.1 < beta < beta.2 < rc.1)
//   - numeric identifiers compared numerically, others lexically
//
// Used by lifecycle.update() to decide noop / proceed / downgrade-reject.

import { describe, expect, it } from "vitest";
import { compareSemver, isDowngrade, parseSemver } from "../../../src/head/installer/semver.js";

describe("semver — parseSemver", () => {
  it("parses a simple release version", () => {
    expect(parseSemver("0.8.0")).toEqual({ major: 0, minor: 8, patch: 0, prerelease: [] });
  });

  it("parses a version with a prerelease", () => {
    expect(parseSemver("1.0.0-alpha.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["alpha", 1],
    });
  });

  it("parses a build-metadata-free rc prerelease", () => {
    expect(parseSemver("1.0.0-rc.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["rc", 1],
    });
  });
});

describe("semver — compareSemver release ordering", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.8.0", "0.8.0")).toBe(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns -1 when the left is older (patch)", () => {
    expect(compareSemver("0.8.0", "0.8.1")).toBe(-1);
  });

  it("returns -1 when the left is older (minor)", () => {
    expect(compareSemver("0.8.9", "0.9.0")).toBe(-1);
  });

  it("returns -1 when the left is older (major)", () => {
    expect(compareSemver("0.9.9", "1.0.0")).toBe(-1);
  });

  it("returns +1 when the left is newer (patch)", () => {
    expect(compareSemver("0.8.1", "0.8.0")).toBe(1);
  });

  it("returns +1 when the left is newer (minor)", () => {
    expect(compareSemver("0.9.0", "0.8.9")).toBe(1);
  });

  it("returns +1 when the left is newer (major)", () => {
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
  });

  it("the Phase-3 update path 0.8.0 -> 0.9.0 is an upgrade", () => {
    // bundle 0.9.0 vs stamp 0.8.0 → compareSemver("0.9.0","0.8.0") = +1 (newer).
    expect(compareSemver("0.9.0", "0.8.0")).toBe(1);
  });
});

describe("semver — compareSemver prerelease ordering (semver.org §11)", () => {
  it("prerelease is lower than the corresponding release", () => {
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-alpha")).toBe(1);
  });

  it("prerelease identifiers order: alpha < alpha.1 < beta < beta.2 < rc.1", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-rc.1"];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(compareSemver(ordered[i] ?? "", ordered[i + 1] ?? "")).toBe(-1);
    }
  });

  it("numeric prerelease identifiers compare numerically (not lexically)", () => {
    // alpha.2 > alpha.10 numerically; lexical comparison would wrongly say alpha.10 > alpha.2.
    expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10")).toBe(-1);
  });

  it("two equal prerelease strings compare as 0", () => {
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.1")).toBe(0);
  });
});

describe("semver — isDowngrade", () => {
  it("returns true when candidate is older than current", () => {
    // candidate 0.8.0 vs current 0.9.0 → downgrade.
    expect(isDowngrade("0.8.0", "0.9.0")).toBe(true);
  });

  it("returns false when candidate is newer than current", () => {
    // candidate 0.9.0 vs current 0.8.0 → upgrade, not downgrade.
    expect(isDowngrade("0.9.0", "0.8.0")).toBe(false);
  });

  it("returns false when versions are equal", () => {
    expect(isDowngrade("0.8.0", "0.8.0")).toBe(false);
  });

  it("returns true for a major downgrade", () => {
    expect(isDowngrade("1.0.0", "2.0.0")).toBe(true);
  });
});
