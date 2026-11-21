import type { SnapshotSize } from "@snapshot-machine/shared/types.ts";
import {
  HelperUnavailableError,
  withHelper,
} from "@snapshot-machine/backend/shared/helper/index.ts";

/** Longest accepted path, matching the limit enforced by the Root Helper. */
const MAX_PATH_LENGTH = 4096;

/** Returns true when `value` is a plain (non-array, non-null) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Throws a helper error naming the offending field. */
function invalid(field: string): never {
  throw new HelperUnavailableError(
    `Root Helper returned an invalid snapshot size (${field})`,
  );
}

/** Checks a path before it is sent to the Root Helper. */
export function assertValidPath(path: string): void {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) {
    throw new Error(`Path must be between 1 and ${MAX_PATH_LENGTH} characters`);
  }
  if (!path.startsWith("/")) {
    throw new Error(`Path must be absolute: ${path}`);
  }
  if (path.includes("\0")) {
    throw new Error("Path must not contain NUL characters");
  }
}

/**
 * Parses the JSON document returned by the helper's `GetSnapshotSize` method.
 *
 * @throws {HelperUnavailableError} If the document is not valid JSON or does not match {@link SnapshotSize}.
 */
export function parseSnapshotSize(json: unknown): SnapshotSize {
  if (typeof json !== "string") invalid("payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("payload");
  }
  if (!isRecord(parsed)) invalid("payload");
  const { path, totalBytes, exclusiveBytes, sharedBytes } = parsed;
  if (typeof path !== "string") invalid("path");
  if (typeof totalBytes !== "number" || !Number.isSafeInteger(totalBytes)) {
    invalid("totalBytes");
  }
  if (
    typeof exclusiveBytes !== "number" || !Number.isSafeInteger(exclusiveBytes)
  ) {
    invalid("exclusiveBytes");
  }
  if (
    sharedBytes !== undefined &&
    (typeof sharedBytes !== "number" || !Number.isSafeInteger(sharedBytes))
  ) {
    invalid("sharedBytes");
  }
  return {
    path,
    totalBytes,
    exclusiveBytes,
    ...(sharedBytes === undefined ? {} : { sharedBytes }),
  };
}

/**
 * Calculates the exclusive and total size of an absolute path through the
 * Root Helper.
 *
 * Invalid paths reject. A calculation that fails in the helper (timeout,
 * unsupported path, unreachable helper) resolves with `error` set and zero
 * sizes, so the interface can show the reason next to the path.
 *
 * @throws {Error} If the path is not absolute or is otherwise malformed.
 */
export async function getSnapshotSize(path: string): Promise<SnapshotSize> {
  assertValidPath(path);
  try {
    const raw: unknown = await withHelper((helper) =>
      helper.GetSnapshotSize(path) as Promise<string>
    );
    return parseSnapshotSize(raw);
  } catch (error) {
    return {
      path,
      totalBytes: 0,
      exclusiveBytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
