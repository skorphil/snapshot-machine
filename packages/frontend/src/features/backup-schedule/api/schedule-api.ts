import type {
  BackupSchedule,
  ScheduleInterval,
  ScheduleStatus,
  SetScheduleResult,
} from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Reads the configured backup interval and whether the timer is enabled. */
export function getSchedule(): Promise<BackupSchedule> {
  return getBindings().getSchedule();
}

/**
 * Applies the backup interval through the Root Helper after Polkit authorization.
 * A `null` interval removes the schedule.
 */
export function setSchedule(
  interval: ScheduleInterval | null,
  enabled: boolean,
): Promise<SetScheduleResult> {
  return getBindings().setSchedule(interval, enabled);
}

/** Returns the last and next scheduled run and the result of the last run. */
export function getScheduleStatus(): Promise<ScheduleStatus> {
  return getBindings().getScheduleStatus();
}
