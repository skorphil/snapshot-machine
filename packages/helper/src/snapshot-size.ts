/**
 * Snapshot size calculation through `btrfs filesystem du -s --raw`. The command
 * reports, per path, the bytes referenced in total, the bytes exclusive to the
 * path and the bytes shared with other paths of the same set. Runs are bounded
 * by a timeout, because the command walks every extent of the path.
 */

import type { SnapshotSize } from "../../shared/types.ts";

/** Default time allowed for one `btrfs filesystem du` run. */
export const SNAPSHOT_SIZE_TIMEOUT_MS = 45_000;

/** Longest accepted absolute path, matching PATH_MAX on Linux. */
export const MAX_PATH_LENGTH = 4096;

/** Failure to calculate a snapshot size; the message is safe to show to the user. */
export class SnapshotSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotSizeError";
  }
}

/** Result of one run: the command's stdout and stderr. */
export interface DuOutput {
  stdout: string;
  stderr: string;
}

/**
 * Runs `btrfs filesystem du -s --raw <path>`. Implementations must stop the
 * child process when `signal` aborts and reject with the abort reason.
 */
export type DuRunner = (path: string, signal: AbortSignal) => Promise<DuOutput>;

/** Options of {@link calculateSnapshotSize}; injectable for tests. */
export interface CalculateSnapshotSizeOptions {
  /** Runs the command. Defaults to `btrfs` from PATH. */
  run?: DuRunner;
  /** Time allowed for the run, in milliseconds. */
  timeoutMs?: number;
}

/** Sizes of one row of `btrfs filesystem du -s --raw`. */
export interface DuRow {
  path: string;
  totalBytes: number;
  exclusiveBytes: number;
  sharedBytes: number;
}

/** Header row printed by `btrfs filesystem du -s`. */
const HEADER = /^\s*Total\s+Exclusive\s+Set shared\s+Filename\s*$/;

/** One data row: three byte counts, then the path, which may contain spaces. */
const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/;

/**
 * Parses the output of `btrfs filesystem du -s --raw` for a single path. The
 * header row is optional. Returns the sizes of the first data row.
 *
 * @throws {SnapshotSizeError} When no data row is present or a row is malformed.
 */
export function parseFilesystemDu(output: string): DuRow {
  const rows = output.split("\n").map((line) => line.trimEnd()).filter((
    line,
  ) => line.trim() !== "" && !HEADER.test(line));

  const first = rows[0];
  if (first === undefined) {
    throw new SnapshotSizeError("btrfs returned no size information");
  }
  const match = ROW.exec(first);
  if (!match) {
    throw new SnapshotSizeError(
      `Unexpected output from btrfs filesystem du: ${first}`,
    );
  }

  const totalBytes = Number(match[1]);
  const exclusiveBytes = Number(match[2]);
  const sharedBytes = Number(match[3]);
  const path = match[4];
  if (
    !Number.isSafeInteger(totalBytes) ||
    !Number.isSafeInteger(exclusiveBytes) ||
    !Number.isSafeInteger(sharedBytes)
  ) {
    throw new SnapshotSizeError(
      `Size values out of range in btrfs output: ${first}`,
    );
  }

  return { path, totalBytes, exclusiveBytes, sharedBytes };
}

/** Runs the real `btrfs` binary; the signal kills the child when it aborts. */
export const runBtrfsDu: DuRunner = async (path, signal) => {
  const { success, stdout, stderr } = await new Deno.Command("btrfs", {
    args: ["filesystem", "du", "-s", "--raw", path],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal,
  }).output();
  const decoder = new TextDecoder();
  const out = {
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
  if (!success) {
    throw new SnapshotSizeError(
      firstLine(out.stderr) || "btrfs filesystem du failed",
    );
  }
  return out;
};

/** Returns the first non-empty line of a text, trimmed. */
function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) =>
    line !== ""
  ) ?? "";
}

/**
 * Calculates the exclusive, shared and total size of one absolute path.
 *
 * @throws {SnapshotSizeError} When the command fails, times out or prints unexpected output.
 */
export async function calculateSnapshotSize(
  path: string,
  options: CalculateSnapshotSizeOptions = {},
): Promise<SnapshotSize> {
  const run = options.run ?? runBtrfsDu;
  const timeoutMs = options.timeoutMs ?? SNAPSHOT_SIZE_TIMEOUT_MS;
  const limit = timeoutMs >= 1000
    ? `${Math.round(timeoutMs / 1000)}s`
    : `${timeoutMs}ms`;

  const signal = AbortSignal.timeout(timeoutMs);
  let output: DuOutput;
  try {
    output = await run(path, signal);
  } catch (error) {
    if (signal.aborted) {
      throw new SnapshotSizeError(
        `Size calculation timed out after ${limit}`,
      );
    }
    if (error instanceof SnapshotSizeError) throw error;
    throw new SnapshotSizeError(
      error instanceof Error ? error.message : String(error),
    );
  }

  const parsed = parseFilesystemDu(output.stdout);
  return {
    path,
    totalBytes: parsed.totalBytes,
    exclusiveBytes: parsed.exclusiveBytes,
    sharedBytes: parsed.sharedBytes,
  };
}

/**
 * Checks a path received over D-Bus. It must be absolute, bounded in length,
 * and free of NUL bytes.
 *
 * @throws {SnapshotSizeError} When the path is not acceptable.
 */
export function assertValidSnapshotPath(path: string): void {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new SnapshotSizeError("path must be between 1 and 4096 characters");
  }
  if (!path.startsWith("/")) {
    throw new SnapshotSizeError("path must be absolute");
  }
  if (path.includes("\0")) {
    throw new SnapshotSizeError("path must not contain NUL characters");
  }
}
