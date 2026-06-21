// Tiny-Yeah minimal semver comparator (SPEC-TINY-YEAH-002 REQ-TY2-011, strategy §5).
//
// No `semver` npm dependency — constraint §5 (minimal deps). Implements the subset of semver.org
// ordering the update lifecycle needs: major.minor.patch + optional `-prerelease`. Build metadata
// (`+build`) is NOT supported (the installer never produces metadata-tagged versions).
//
// Ordering rules (semver.org §11):
//   - major.minor.patch compared numerically, left to right.
//   - A version WITH a prerelease is LOWER than the same major.minor.patch WITHOUT one
//     (1.0.0-alpha < 1.0.0).
//   - Prerelease identifiers are dot-separated; numeric identifiers compare numerically, others
//     lexically. A smaller set of identifiers is lower when all preceding identifiers are equal.
//
// Used by lifecycle.update() to classify noop / upgrade / downgrade and reject downgrades unless
// `--allow-downgrade` is passed (REQ-TY2-011 AC).

/** A parsed semver. `prerelease` is `[]` for a release version. Numeric ids are coerced to number. */
export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Prerelease identifiers (empty for a release). Numeric strings coerced to number. */
  readonly prerelease: ReadonlyArray<number | string>;
}

/**
 * Parse a semver string into its components. Throws on malformed input (the caller's bundle/stamp
 * versions are validated upstream; this parser is strict so a typo surfaces immediately).
 */
export function parseSemver(version: string): SemverParts {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/.exec(version.trim());
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Invalid semver: '${version}'`);
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  const prereleaseRaw = match[4];
  const prerelease: Array<number | string> = [];
  if (prereleaseRaw !== undefined) {
    for (const id of prereleaseRaw.split(".")) {
      // Numeric identifier → number; non-numeric → string. Leading-zero numeric identifiers are
      // forbidden by semver.org (e.g. "01") — treat them as strings so they never silently equal
      // a numeric counterpart.
      if (/^[1-9]\d*$/.test(id) || id === "0") {
        prerelease.push(Number.parseInt(id, 10));
      } else {
        prerelease.push(id);
      }
    }
  }
  return { major, minor, patch, prerelease };
}

/**
 * Compare two semver identifiers (numeric or string) per semver.org §11: numeric < string, numerics
 * by value, strings lexically.
 */
function compareIdentifier(a: number | string, b: number | string): -1 | 0 | 1 {
  const aNum = typeof a === "number";
  const bNum = typeof b === "number";
  if (aNum && bNum) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  // Numeric identifiers always have lower precedence than non-numeric (semver.org §11.4).
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  // Both strings — lexical comparison.
  const aStr = a as string;
  const bStr = b as string;
  if (aStr < bStr) return -1;
  if (aStr > bStr) return 1;
  return 0;
}

/**
 * Compare two prerelease arrays per semver.org §11.3-11.4. A version WITHOUT a prerelease is HIGHER
 * than one WITH (so the caller passes `[]` for a release and the populated array for a prerelease,
 * but the rule is inverted: empty array = release = higher).
 */
function comparePrerelease(
  a: ReadonlyArray<number | string>,
  b: ReadonlyArray<number | string>,
): -1 | 0 | 1 {
  // Empty (release) is HIGHER than non-empty (prerelease). So if a is empty and b is not → a > b.
  if (a.length === 0 && b.length > 0) return 1;
  if (a.length > 0 && b.length === 0) return -1;
  if (a.length === 0 && b.length === 0) return 0;
  // Both non-empty: compare identifier by identifier.
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const aId = a[i];
    const bId = b[i];
    if (aId === undefined || bId === undefined) break;
    const cmp = compareIdentifier(aId, bId);
    if (cmp !== 0) return cmp;
  }
  // All compared identifiers equal — the SHORTER array has lower precedence (semver.org §11.4.4).
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

/**
 * Compare two semver strings. Returns -1 if `a < b`, 0 if equal, +1 if `a > b`.
 *
 * @example compareSemver("0.8.0", "0.9.0") === -1  // 0.8.0 is older
 * @example compareSemver("1.0.0-alpha", "1.0.0") === -1  // prerelease < release
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * Convenience: is `candidate` a downgrade relative to `current`? True when candidate is strictly
 * older than current. Equal versions return false (not a downgrade).
 *
 * @param candidate the version being considered (e.g. a new bundle's version).
 * @param current the currently-installed version (from the install stamp).
 */
export function isDowngrade(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) < 0;
}
