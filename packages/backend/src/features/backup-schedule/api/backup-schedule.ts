import type {
  BackupSchedule,
  ScheduleInterval,
  ScheduleStatus,
  ScheduleUnit,
  SetScheduleResult,
} from "@snapshot-machine/shared/types.ts";
import {
  isValidScheduleCount,
  SCHEDULE_COUNTS,
  SCHEDULE_UNITS,
} from "@snapshot-machine/shared/schedule-limits.ts";
import {
  HelperUnavailableError,
  isHelperRejection,
  withHelper,
} from "@snapshot-machine/backend/shared/helper/index.ts";

/** Wire value of the unit that means "no schedule". */
const SCHEDULE_OFF = "off";

/** Narrows a value to an interval unit. */
function isScheduleUnit(value: unknown): value is ScheduleUnit {
  return typeof value === "string" &&
    SCHEDULE_UNITS.some((item) => item === value);
}

/** Returns a tuple element as a string, or throws for an unexpected shape. */
function expectString(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  throw new HelperUnavailableError(
    `Root Helper returned an invalid schedule (${field})`,
  );
}

/**
 * Reads the configured schedule from the Root Helper.
 *
 * @throws {HelperUnavailableError} If the helper is unreachable or returns an unexpected shape.
 */
export async function getSchedule(): Promise<BackupSchedule> {
  const raw: unknown = await withHelper((helper) => helper.GetSchedule());
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new HelperUnavailableError(
      "Root Helper returned an invalid schedule",
    );
  }
  return parseSchedule(raw[0], raw[1], raw[2]);
}

/**
 * Validates the schedule tuple `(unit, count, enabled)` returned by `GetSchedule`.
 * A unit of `off` means no timer is installed.
 *
 * @throws {HelperUnavailableError} If a field has the wrong type or value.
 */
export function parseSchedule(
  unit: unknown,
  count: unknown,
  enabled: unknown,
): BackupSchedule {
  if (typeof enabled !== "boolean") {
    throw new HelperUnavailableError(
      "Root Helper returned an invalid schedule (enabled)",
    );
  }
  if (unit === SCHEDULE_OFF) {
    if (enabled) {
      throw new HelperUnavailableError(
        "Root Helper returned an enabled schedule without an interval",
      );
    }
    return { interval: null, enabled: false };
  }
  if (!isScheduleUnit(unit)) {
    throw new HelperUnavailableError(
      "Root Helper returned an unknown schedule unit",
    );
  }
  if (typeof count !== "number" || !isValidScheduleCount(unit, count)) {
    throw new HelperUnavailableError(
      `Root Helper returned an invalid schedule count (${unit}: ${
        SCHEDULE_COUNTS[unit].join(", ")
      })`,
    );
  }
  return { interval: { count, unit }, enabled };
}

/**
 * Applies a backup schedule through the Root Helper. `interval` of `null`
 * removes the schedule. A request the helper rejects (invalid interval, denied
 * authorization) is returned as `{ ok: false, error }`.
 */
export async function setSchedule(
  interval: ScheduleInterval | null,
  enabled: boolean,
): Promise<SetScheduleResult> {
  const unit = interval?.unit ?? SCHEDULE_OFF;
  const count = interval?.count ?? 0;
  try {
    await withHelper((helper) => helper.SetSchedule(unit, count, enabled));
    return { ok: true };
  } catch (error) {
    if (isHelperRejection(error)) {
      return { ok: false, error: error.text };
    }
    throw error;
  }
}

/**
 * Reads the last and next scheduled run and the result of the last run from the Root Helper.
 *
 * @throws {HelperUnavailableError} If the helper is unreachable or returns an unexpected shape.
 */
export async function getScheduleStatus(): Promise<ScheduleStatus> {
  const raw: unknown = await withHelper((helper) => helper.GetScheduleStatus());
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new HelperUnavailableError(
      "Root Helper returned an invalid schedule status",
    );
  }
  return parseScheduleStatus(
    expectString(raw[0], "lastRunTime"),
    expectString(raw[1], "nextRunTime"),
    expectString(raw[2], "lastRunResult"),
  );
}

const RUN_RESULTS: readonly ScheduleStatus["lastRunResult"][] = [
  "never",
  "running",
  "success",
  "failure",
];

/**
 * Validates the status tuple `(lastRunTime, nextRunTime, lastRunResult)`.
 *
 * @throws {HelperUnavailableError} If the result is not a known value.
 */
export function parseScheduleStatus(
  lastRunTime: string,
  nextRunTime: string,
  lastRunResult: string,
): ScheduleStatus {
  const result = RUN_RESULTS.find((item) => item === lastRunResult);
  if (result === undefined) {
    throw new HelperUnavailableError(
      "Root Helper returned an unknown schedule run result",
    );
  }
  return { lastRunTime, nextRunTime, lastRunResult: result };
}
