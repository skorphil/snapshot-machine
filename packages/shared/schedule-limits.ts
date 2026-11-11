import type { ScheduleUnit } from "./types.ts";

/** Units an interval can be expressed in, in display order. */
export const SCHEDULE_UNITS: readonly ScheduleUnit[] = [
  "minutes",
  "hours",
  "days",
];

/**
 * Counts accepted for each unit. A count must divide its calendar period
 * (60 minutes, 24 hours), so that the timer fires at a constant interval
 * everywhere in the period. For example `*:0/7` would leave a 4-minute gap at
 * every hour boundary. Days are limited to 1: a day count such as `*-*-01/2`
 * restarts at each month boundary and is not an even cadence.
 */
export const SCHEDULE_COUNTS: Readonly<
  Record<ScheduleUnit, readonly number[]>
> = {
  minutes: [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30],
  hours: [1, 2, 3, 4, 6, 8, 12],
  days: [1],
};

/** Returns true when `count` is one of the counts accepted for `unit`. */
export function isValidScheduleCount(
  unit: ScheduleUnit,
  count: number,
): boolean {
  return SCHEDULE_COUNTS[unit].includes(count);
}
