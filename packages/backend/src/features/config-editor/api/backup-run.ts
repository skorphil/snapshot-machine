import type {
  BackupState,
  BackupStatus,
  RunBackupResult,
} from "@snapshot-machine/shared/types.ts";
import { withHelper } from "./helper-connection.ts";
import { HelperUnavailableError, isHelperRejection } from "./helper-errors.ts";

/**
 * Asks the Root Helper to start a backup run. The helper returns once the run has
 * started, so the call does not wait for btrbk to finish. A rejected request (denied
 * authorization or a run already in progress) is returned as `{ ok: false, error }`.
 */
export async function runBackup(): Promise<RunBackupResult> {
  try {
    await withHelper((helper) => helper.RunBackup());
    return { ok: true };
  } catch (error) {
    if (isHelperRejection(error)) {
      return { ok: false, error: error.text };
    }
    throw error;
  }
}

/** Returns the state of the current or most recent backup run. */
export async function getBackupStatus(): Promise<BackupStatus> {
  const raw: unknown = await withHelper((helper) => helper.GetBackupStatus());
  if (typeof raw !== "string") {
    throw new HelperUnavailableError(
      "Root Helper returned a backup status that is not a string",
    );
  }
  return parseBackupStatus(raw);
}

const BACKUP_STATES: readonly BackupState[] = [
  "idle",
  "running",
  "success",
  "failure",
];

/** Narrows a parsed JSON value to a backup state. */
function isBackupState(value: unknown): value is BackupState {
  return typeof value === "string" &&
    BACKUP_STATES.some((state) => state === value);
}

/** Returns the value if it is a string or null, otherwise throws. */
function nullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new HelperUnavailableError(
    `Root Helper returned an invalid backup status (${field})`,
  );
}

/**
 * Validates the JSON status document returned by `GetBackupStatus`.
 *
 * @throws {HelperUnavailableError} If the document is not valid JSON or has the wrong shape.
 */
export function parseBackupStatus(raw: string): BackupStatus {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HelperUnavailableError(
      "Root Helper returned a backup status that is not valid JSON",
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new HelperUnavailableError(
      "Root Helper returned an invalid backup status",
    );
  }
  const record: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  if (!isBackupState(record.state)) {
    throw new HelperUnavailableError(
      "Root Helper returned an unknown backup state",
    );
  }
  if (typeof record.message !== "string") {
    throw new HelperUnavailableError(
      "Root Helper returned an invalid backup status (message)",
    );
  }
  return {
    state: record.state,
    message: record.message,
    startedAt: nullableString(record.startedAt, "startedAt"),
    finishedAt: nullableString(record.finishedAt, "finishedAt"),
  };
}
