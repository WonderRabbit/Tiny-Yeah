// Tiny-Yeah atomic create-only write primitives (SPEC-TINY-YEAH-001 REQ-TY-005, plan.md §3.5).
//
// Ported from Tinker.Gen `src/apply/apply.ts` `writeTempFile` (lines 240-253) and
// `writeCreateOnlyFile` (lines 206-225), with the C5 Windows Defender/indexer retry wrapper
// (plan.md §3.5) layered on top.
//
// REQ-TY-005 NF1: the create-only primitive uses
//   `fs.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)`
//   (async node:fs/promises). The bare `"wx"` shorthand is INSUFFICIENT — it omits O_NOFOLLOW,
//   leaving a symlink-attack surface (an attacker pre-stages a `.basename.pid.uuid.tmp` symlink
//   to hijack or redirect the write). The explicit constant combination preserves the donor's
//   symlink-safety property that underpins the (c) no-clobber guarantee.
//
// C5 retry wrapper: Windows Defender / indexer scanning `.tiny-yeah/tasks/*.json` can make
// `rename`/`link`/`open` fail with EPERM/EBUSY/EACCES. This is a frequent, real failure mode on
// the user-confirmed standard Windows + Defender environment, so it is a first-class design
// target. `withWriteRetry` wraps a file-mutating operation with exponential backoff + jitter,
// bounded under the lock-lease renewal window (TINY_YEAH_LOCK_RENEW_MS = 5000ms). After the
// budget is exhausted it escalates to `WRITE_LOCK_CONTENTION` (YeahError) so callers surface an
// actionable message instead of a raw EPERM.

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TINY_YEAH_LOCK_RENEW_MS } from "../state/lock-store.js";
import { isNodeErrorCode, YeahError } from "./errors.js";

const RETRY_ERRNO = new Set(["EPERM", "EBUSY", "EACCES"]);
const RETRY_BUDGET_MS = TINY_YEAH_LOCK_RENEW_MS; // must stay under lock lease renewal window
const RETRY_BASE_MS = 50;
const RETRY_CAP_MS = 1000;
const RETRY_JITTER = 0.2;

export interface WriteRetryOptions {
  readonly budgetMs?: number;
  readonly baseMs?: number;
  readonly capMs?: number;
  readonly jitter?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class WriteLockContentionError extends YeahError {
  constructor(message: string, cause?: unknown) {
    super({
      code: "WRITE_LOCK_CONTENTION",
      message,
      recoveryHint:
        "Windows Defender or a file indexer may be scanning `.tiny-yeah/`. Add the project directory to the Defender exclusion list and retry.",
      cause,
    });
  }
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    RETRY_ERRNO.has(String((error as { code: unknown }).code))
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function withWriteRetry<T>(
  fn: () => Promise<T>,
  options: WriteRetryOptions = {},
): Promise<T> {
  const budgetMs = options.budgetMs ?? RETRY_BUDGET_MS;
  const baseMs = options.baseMs ?? RETRY_BASE_MS;
  const capMs = options.capMs ?? RETRY_CAP_MS;
  const jitter = options.jitter ?? RETRY_JITTER;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;

  const deadline = now() + budgetMs;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      attempt += 1;
      const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      const jittered = exponential * (1 + (Math.random() * 2 - 1) * jitter);
      if (now() + jittered > deadline) {
        throw new WriteLockContentionError(
          `Write contention (EPERM/EBUSY/EACCES) persisted beyond ${budgetMs}ms budget after ${attempt} attempt(s).`,
          error,
        );
      }
      await sleep(Math.max(0, jittered));
    }
  }
}

function tempSibling(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
}

async function safeRm(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, { force: true });
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) throw error;
  }
}

export async function writeCreateOnlyFile(
  targetPath: string,
  content: string,
  retryOptions: WriteRetryOptions = {},
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = tempSibling(targetPath);
  try {
    await withWriteRetry(async () => {
      const handle = await open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    }, retryOptions);
    try {
      await withWriteRetry(async () => {
        await link(tempPath, targetPath);
      }, retryOptions);
    } catch (error) {
      if (isNodeErrorCode(error, "EEXIST")) {
        throw new YeahError({
          code: "APPLY_TARGET_EXISTS",
          message: `Create-only target already exists: ${targetPath}`,
        });
      }
      throw error;
    }
  } finally {
    await safeRm(tempPath);
  }
}
