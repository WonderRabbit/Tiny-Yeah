// Tiny-Yeah `.tiny-yeah/` runtime state layout (SPEC-TINY-YEAH-001 §6.3, plan.md §2 Phase 1).
//
// Ported from Tiny-Chu `src/state/paths.ts` and generalized:
//   - directory name `.tiny` -> `.tiny-yeah`
//   - dropped Tiny-Chu-specific surfaces (boulder.json, public-jobs, memory, workflow sub-dirs)
//   - added Tiny-Yeah-native surfaces: staging/ (content-staging, REQ-TY-027),
//     previews/ + checkpoints/ (universal write path, REQ-TY-004/006)
//
// All derived paths flow exclusively through this resolver. Never hand-assemble a `.tiny-yeah/`
// path elsewhere.

import path from "node:path";

export interface TinyYeahPaths {
  readonly root: string;
  readonly tinyYeahDir: string;
  readonly tasksDir: string;
  readonly plansDir: string;
  readonly locksDir: string;
  readonly stagingDir: string;
  readonly workflowsDir: string;
  readonly previewsDir: string;
  readonly checkpointsDir: string;
  readonly wikiDir: string;
  readonly wikiIndexFile: string;
}

export function resolveTinyYeahPaths(root = process.cwd()): TinyYeahPaths {
  const absoluteRoot = path.resolve(root);
  const tinyYeahDir = path.join(absoluteRoot, ".tiny-yeah");
  const workflowsDir = path.join(tinyYeahDir, "workflows");
  const wikiDir = path.join(tinyYeahDir, "wiki");
  return {
    root: absoluteRoot,
    tinyYeahDir,
    tasksDir: path.join(tinyYeahDir, "tasks"),
    plansDir: path.join(tinyYeahDir, "plans"),
    locksDir: path.join(tinyYeahDir, "locks"),
    stagingDir: path.join(tinyYeahDir, "staging"),
    workflowsDir,
    previewsDir: path.join(tinyYeahDir, "previews"),
    checkpointsDir: path.join(tinyYeahDir, "checkpoints"),
    wikiDir,
    wikiIndexFile: path.join(wikiDir, "index.json"),
  };
}
