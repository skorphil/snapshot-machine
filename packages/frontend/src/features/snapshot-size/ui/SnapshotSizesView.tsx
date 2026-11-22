import type React from "react";
import {
  elapsedSeconds,
  type SnapshotSizesState,
  useSnapshotSizes,
} from "../model/index.ts";
import { formatBytes } from "@/shared/format/index.ts";
import { SnapshotLocationPanel } from "./SnapshotLocationPanel.tsx";

/** Summary of the snapshot storage across all measured snapshots. */
function TotalsSummary({ state }: { state: SnapshotSizesState }) {
  const { totals } = state;
  return (
    <p className="snapshot-sizes-totals">
      <strong title="Sum of the per-snapshot values. Shared extents are counted once per snapshot.">
        Total snapshot storage:
      </strong>{" "}
      Exclusive {formatBytes(totals.exclusiveBytes)} · Total{" "}
      {formatBytes(totals.totalBytes)}
      <span className="snapshot-sizes-muted">
        {" "}
        ({totals.measured} of {totals.snapshots} snapshots measured
        {totals.failed > 0 ? `, ${totals.failed} failed` : ""})
      </span>
    </p>
  );
}

/** Live progress of the running batch: position, snapshot name and elapsed time. */
function BatchStatus({ state }: { state: SnapshotSizesState }) {
  const { batch, now } = state;
  if (!batch) return null;
  const elapsed = elapsedSeconds(batch.startedAt, now);
  return (
    <p className="snapshot-batch-status" role="status">
      <span className="snapshot-spinner" aria-hidden="true" />
      Calculating snapshot {batch.current} of {batch.total} ({batch.name}){" "}
      (elapsed {elapsed}s)...
    </p>
  );
}

/** Body of the view, depending on the loading and location state. */
function Content({ state }: { state: SnapshotSizesState }): React.ReactNode {
  if (state.loadingLocations) {
    return <p role="status">Loading snapshot locations…</p>;
  }
  if (state.locationsError) {
    return (
      <p className="btrfs-tree-error" role="alert">
        Could not read snapshot locations: {state.locationsError}
      </p>
    );
  }
  if (state.locations.length === 0) {
    return (
      <p className="btrfs-tree-hint">
        No snapshot locations are configured. Add a <code>snapshot_dir</code> or
        {" "}
        <code>target</code> to a volume in the Config Editor.
      </p>
    );
  }
  return (
    <>
      <TotalsSummary state={state} />
      <BatchStatus state={state} />
      {state.locations.map((location) => (
        <SnapshotLocationPanel
          key={`${location.kind}\0${location.path}`}
          location={location}
          expanded={state.isExpanded(location.path)}
          list={state.lists[location.path]}
          locationMeasurement={state.locationMeasurements[location.path]}
          snapshotMeasurements={state.snapshotMeasurements}
          busy={state.busy}
          now={state.now}
          onToggle={() => state.toggleLocation(location)}
          onMeasureLocation={() => state.measureLocation(location)}
          onMeasureSnapshots={() => state.measureLocationSnapshots(location)}
          onMeasureSnapshot={state.measureSnapshot}
        />
      ))}
    </>
  );
}

/**
 * Snapshot Sizes tab: lists the snapshot storage locations (`snapshot_dir` and
 * local `target` directories), the snapshots inside each, and their sizes.
 */
export function SnapshotSizesView(): React.ReactElement {
  const state = useSnapshotSizes();

  return (
    <section className="snapshot-sizes">
      <div className="snapshot-sizes-toolbar">
        <h2 className="btrfs-tree-title">Snapshot Sizes</h2>
        <div className="snapshot-sizes-actions">
          <button
            type="button"
            onClick={state.reload}
            disabled={state.loadingLocations || state.busy}
          >
            Reload
          </button>
          {state.batch
            ? (
              <button type="button" onClick={state.cancelBatch}>
                Cancel
              </button>
            )
            : (
              <button
                type="button"
                onClick={state.measureAll}
                disabled={state.loadingLocations || state.busy ||
                  state.locations.length === 0}
              >
                Calculate All
              </button>
            )}
        </div>
      </div>
      <Content state={state} />
    </section>
  );
}
