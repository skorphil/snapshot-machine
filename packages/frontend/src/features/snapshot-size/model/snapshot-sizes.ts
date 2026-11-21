import type { SnapshotSize } from "@snapshot-machine/shared/types.ts";

/** Measurement state of one path (a snapshot location or a single snapshot). */
export type MeasurementState =
  | { status: "measuring"; startedAt?: number }
  | { status: "ready"; size: SnapshotSize }
  | { status: "error"; message: string };

/** Sums of the measured snapshots. */
export type SnapshotSizesTotals = {
  /** Sum of the total bytes of every measured snapshot. */
  totalBytes: number;
  /** Sum of the exclusive bytes of every measured snapshot. */
  exclusiveBytes: number;
  /** Number of snapshots listed across all loaded locations. */
  snapshots: number;
  /** Number of snapshots measured successfully. */
  measured: number;
  /** Number of snapshots whose measurement failed. */
  failed: number;
};

/**
 * Adds up the measurements of the listed snapshots. Snapshots without a
 * measurement, or still measuring, contribute no bytes. Shared extents are
 * counted once per snapshot in `totalBytes`, which is why the figure is
 * labelled as a sum of per-snapshot values.
 */
export function summarizeSnapshotSizes(
  measurements: ReadonlyArray<MeasurementState | undefined>,
): SnapshotSizesTotals {
  const totals: SnapshotSizesTotals = {
    totalBytes: 0,
    exclusiveBytes: 0,
    snapshots: measurements.length,
    measured: 0,
    failed: 0,
  };
  for (const measurement of measurements) {
    if (measurement?.status === "ready") {
      totals.totalBytes += measurement.size.totalBytes;
      totals.exclusiveBytes += measurement.size.exclusiveBytes;
      totals.measured += 1;
    } else if (measurement?.status === "error") {
      totals.failed += 1;
    }
  }
  return totals;
}

/**
 * Whole seconds elapsed since a measurement started, or 0 when the start time
 * is unknown. Never negative, so a stale clock sample cannot show a bad value.
 */
export function elapsedSeconds(
  startedAt: number | undefined,
  now: number,
): number {
  if (startedAt === undefined) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
