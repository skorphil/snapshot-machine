import type React from "react";
import type {
  SnapshotEntry,
  SnapshotLocation,
} from "@snapshot-machine/shared/types.ts";
import {
  elapsedSeconds,
  type MeasurementState,
  type SnapshotListState,
} from "../model/index.ts";
import { formatBytes } from "@/shared/format/index.ts";

/** Human-readable label of a location kind. */
const KIND_LABEL: Record<SnapshotLocation["kind"], string> = {
  snapshot_dir: "Snapshot directory",
  target: "Target",
};

/** Formats an ISO timestamp for display, or a dash when it is unknown. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Renders the exclusive and total bytes of a measurement. */
function SizeValue({ measurement }: { measurement: MeasurementState }) {
  if (measurement.status !== "ready") return null;
  const { size } = measurement;
  return (
    <span className="snapshot-size-value">
      <span title="Bytes referenced only by this path">
        Exclusive {formatBytes(size.exclusiveBytes)}
      </span>
      <span title="Bytes referenced by this path, including shared data">
        Total {formatBytes(size.totalBytes)}
      </span>
    </span>
  );
}

/** Measurement cell shared by the location header and the snapshot rows. */
function MeasurementCell({
  measurement,
  now,
}: {
  measurement: MeasurementState | undefined;
  now: number;
}) {
  if (!measurement) {
    return <span className="snapshot-sizes-muted">Not measured</span>;
  }
  if (measurement.status === "measuring") {
    return (
      <span className="snapshot-progress" role="status">
        <span className="snapshot-spinner" aria-hidden="true" />
        Calculating... (elapsed {elapsedSeconds(measurement.startedAt, now)}s)
      </span>
    );
  }
  if (measurement.status === "error") {
    return (
      <span className="snapshot-size-error" role="alert">
        {measurement.message}
      </span>
    );
  }
  return <SizeValue measurement={measurement} />;
}

/** Props of one snapshot row. */
type SnapshotRowProps = {
  entry: SnapshotEntry;
  measurement: MeasurementState | undefined;
  now: number;
  onMeasure: (path: string) => void;
};

/** Row of one snapshot inside an expanded location. */
function SnapshotRow(
  { entry, measurement, now, onMeasure }: SnapshotRowProps,
) {
  const measuring = measurement?.status === "measuring";
  const label = !measurement
    ? "Calculate"
    : measurement.status === "error"
    ? "Retry"
    : "Recalculate";
  return (
    <tr>
      <td>
        <code title={entry.path}>{entry.name}</code>
      </td>
      <td>{formatDate(entry.date)}</td>
      <td>
        <MeasurementCell measurement={measurement} now={now} />
      </td>
      <td>
        <button
          type="button"
          className="snapshot-size-action"
          disabled={measuring}
          onClick={() => onMeasure(entry.path)}
        >
          {label}
        </button>
      </td>
    </tr>
  );
}

/** Body of an expanded location: loading, error, empty or the snapshot table. */
function SnapshotList({
  list,
  measurements,
  now,
  onMeasure,
}: {
  list: SnapshotListState | undefined;
  measurements: Record<string, MeasurementState | undefined>;
  now: number;
  onMeasure: (path: string) => void;
}) {
  if (!list || list.status === "idle" || list.status === "loading") {
    return <p role="status">Loading snapshots…</p>;
  }
  if (list.status === "error") {
    return (
      <p className="btrfs-tree-error" role="alert">
        Could not list snapshots: {list.message}
      </p>
    );
  }
  if (list.entries.length === 0) {
    return (
      <p className="btrfs-tree-hint">No snapshots found in this location.</p>
    );
  }
  return (
    <table className="history-table snapshot-sizes-table">
      <thead>
        <tr>
          <th>Snapshot</th>
          <th>Date</th>
          <th>Size</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {list.entries.map((entry) => (
          <SnapshotRow
            key={entry.path}
            entry={entry}
            measurement={measurements[entry.path]}
            now={now}
            onMeasure={onMeasure}
          />
        ))}
      </tbody>
    </table>
  );
}

/** Props of one location panel. */
export type SnapshotLocationPanelProps = {
  location: SnapshotLocation;
  expanded: boolean;
  list: SnapshotListState | undefined;
  locationMeasurement: MeasurementState | undefined;
  snapshotMeasurements: Record<string, MeasurementState | undefined>;
  /** True while any listing or measurement runs; disables location actions. */
  busy: boolean;
  /** Current time in epoch milliseconds, driving the elapsed counters. */
  now: number;
  onToggle: () => void;
  onMeasureLocation: () => void;
  onMeasureSnapshots: () => void;
  onMeasureSnapshot: (path: string) => void;
};

/**
 * One storage location: a header with its own measurement and actions, and
 * the list of its snapshots when expanded.
 */
export function SnapshotLocationPanel({
  location,
  expanded,
  list,
  locationMeasurement,
  snapshotMeasurements,
  busy,
  now,
  onToggle,
  onMeasureLocation,
  onMeasureSnapshots,
  onMeasureSnapshot,
}: SnapshotLocationPanelProps): React.ReactElement {
  const measuring = locationMeasurement?.status === "measuring";
  const regionId = `snapshot-location-${location.kind}-${location.path}`;
  return (
    <section className="snapshot-location">
      <div className="snapshot-location-header">
        <button
          type="button"
          className="btrfs-tree-toggle"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={expanded
            ? `Collapse ${location.path}`
            : `Expand ${location.path}`}
          onClick={onToggle}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <code className="snapshot-location-path">{location.path}</code>
        <span className="snapshot-location-kind">
          {KIND_LABEL[location.kind]}
        </span>
        <span className="snapshot-location-volume">
          Volume {location.volumePath}
        </span>
        <span className="snapshot-location-measure">
          <MeasurementCell measurement={locationMeasurement} now={now} />
        </span>
        <span className="snapshot-location-actions">
          <button
            type="button"
            className="snapshot-size-action"
            disabled={busy || measuring}
            onClick={onMeasureLocation}
          >
            Calculate location
          </button>
          <button
            type="button"
            className="snapshot-size-action"
            disabled={busy}
            onClick={onMeasureSnapshots}
          >
            Calculate snapshots
          </button>
        </span>
      </div>
      {expanded && (
        <div id={regionId} className="snapshot-location-body">
          <SnapshotList
            list={list}
            measurements={snapshotMeasurements}
            now={now}
            onMeasure={onMeasureSnapshot}
          />
        </div>
      )}
    </section>
  );
}
