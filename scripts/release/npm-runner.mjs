// Tiny-Yeah release npm-runner (SPEC-TINY-YEAH-001 REQ-TY-022, plan.md Phase 5).
//
// Ported from Tiny-Chu scripts/release/npm-runner.mjs. Platform-portable npm invocation that
// resolves the npm CLI across Node installs (npm_execpath / windows node cli / posix fallback).
// PowerShell-aware: never shells out to bash/zsh; prefers the node CLI JS directly.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function pathApiForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function npmExecPathFromInput(input) {
  if (typeof input.npmExecPath === "string") return input.npmExecPath;
  if (input.env && typeof input.env.npm_execpath === "string") return input.env.npm_execpath;
  return undefined;
}

function resolveNpmExecPath(npmExecPath, cwd, platform) {
  const pathApi = pathApiForPlatform(platform);
  return pathApi.isAbsolute(npmExecPath) ? npmExecPath : pathApi.resolve(cwd, npmExecPath);
}

function windowsNpmCliCandidates(execPath) {
  const execDir = path.win32.dirname(execPath);
  return [
    path.win32.join(execDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.win32.join(execDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
}

export function resolveNpmInvocation(input = {}) {
  const platform = input.platform ?? process.platform;
  const cwd = input.cwd ?? process.cwd();
  const execPath = input.execPath ?? process.execPath;
  const npmExecPath = npmExecPathFromInput(input);
  const candidates = [];

  if (npmExecPath) {
    const resolvedNpmExecPath = resolveNpmExecPath(npmExecPath, cwd, platform);
    candidates.push({
      source: "npm_execpath",
      command: execPath,
      argsPrefix: [resolvedNpmExecPath],
      shell: false,
      pathToCheck: resolvedNpmExecPath,
    });
  }

  if (platform === "win32") {
    for (const candidatePath of windowsNpmCliCandidates(execPath)) {
      candidates.push({
        source: "windows-node-cli",
        command: execPath,
        argsPrefix: [candidatePath],
        shell: false,
        pathToCheck: candidatePath,
      });
    }
    candidates.push({ source: "windows-shell-fallback", command: "npm.cmd", argsPrefix: [], shell: true });
  } else {
    candidates.push({ source: "posix-path-fallback", command: "npm", argsPrefix: [], shell: false });
  }

  return { candidates };
}

function isMissingExecutableError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function describeCandidate(candidate) {
  const parts = [candidate.source, candidate.command];
  if (candidate.argsPrefix.length > 0) parts.push(candidate.argsPrefix.join(" "));
  return parts.join(": ");
}

function createNpmResolutionError(attempts) {
  const error = new Error(
    `Unable to resolve npm executable for release script. Tried ${attempts.length} candidate(s): ${attempts.join("; ")}`,
  );
  error.code = "ERR_TINY_YEAH_NPM_NOT_FOUND";
  return error;
}

export async function runNpm(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const { candidates } = resolveNpmInvocation({ cwd, env, platform: options.platform, execPath: options.execPath });
  const attempts = [];

  for (const candidate of candidates) {
    if (candidate.pathToCheck) {
      try {
        await access(candidate.pathToCheck);
      } catch {
        attempts.push(`${describeCandidate(candidate)} (missing ${candidate.pathToCheck})`);
        continue;
      }
    }

    try {
      return await execFileAsync(candidate.command, [...candidate.argsPrefix, ...args], {
        ...options,
        shell: candidate.shell,
      });
    } catch (error) {
      if (!isMissingExecutableError(error)) throw error;
      attempts.push(`${describeCandidate(candidate)} (${error.message})`);
    }
  }

  throw createNpmResolutionError(attempts);
}
