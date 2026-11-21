import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SnapshotEntry,
  SnapshotLocation,
} from "@snapshot-machine/shared/types.ts";
import {
  getSnapshotSize,
  listSnapshotLocations,
  listSnapshots,
} from "../api/index.ts";
import { logger } from "@/shared/logger.ts";
import {
  type MeasurementState,
  type SnapshotSizesTotals,
  summarizeSnapshotSizes,
} from "./snapshot-sizes.ts";

/** Reduces a thrown value to a displayable message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Progress of a running batch of snapshot measurements, run one snapshot at a time. */
export type BatchProgress = {
  /** 1-based position of the snapshot being measured within the batch. */
  current: number;
  /** Number of snapshots in the batch. */
  total: number;
  /** Name of the snapshot being measured. */
  name: string;
  /** Epoch milliseconds when the snapshot started, used for the elapsed counter. */
  startedAt: number;
};

/** Interval of the elapsed-time ticker, in milliseconds. */
export const ELAPSED_TICK_MS = 1000;

/** Loading state of the snapshots of one location. */
export type SnapshotListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; entries: SnapshotEntry[] }
  | { status: "error"; message: string };

/** Locations, snapshots, measurements and actions of the snapshot sizes tab. */
export type SnapshotSizesState = {
  /** Snapshot locations from the last successful load. */
  locations: SnapshotLocation[];
  /** True while the locations are being loaded. */
  loadingLocations: boolean;
  /** Error from the last failed location load, or null. */
  locationsError: string | null;
  /** True while a listing or measurement is running or queued. */
  busy: boolean;
  /** Progress of the running snapshot batch, or null when no batch is running. */
  batch: BatchProgress | null;
  /** Current time in epoch milliseconds, refreshed once per second while measuring. */
  now: number;
  /** Stops the running batch after the snapshot in progress finishes. */
  cancelBatch: () => void;
  /** Whether the snapshot list of a location is shown, keyed by location path. */
  isExpanded: (path: string) => boolean;
  /** Snapshot listing state keyed by location path. */
  lists: Record<string, SnapshotListState | undefined>;
  /** Measurement of each location directory keyed by its path. */
  locationMeasurements: Record<string, MeasurementState | undefined>;
  /** Measurement of each snapshot keyed by its path. */
  snapshotMeasurements: Record<string, MeasurementState | undefined>;
  /** Sums of the measured snapshots across all loaded locations. */
  totals: SnapshotSizesTotals;
  /** Shows or hides the snapshots of a location, loading them on first display. */
  toggleLocation: (location: SnapshotLocation) => void;
  /** Measures the location directory itself. */
  measureLocation: (location: SnapshotLocation) => void;
  /** Loads (if needed) and measures every snapshot of one location. */
  measureLocationSnapshots: (location: SnapshotLocation) => void;
  /** Measures one snapshot by path. */
  measureSnapshot: (path: string) => void;
  /** Measures every snapshot of every location. */
  measureAll: () => void;
  /** Loads the locations again and discards listings and measurements. */
  reload: () => void;
};

/**
 * Owns the snapshot sizes tab: the configured locations, the snapshots listed
 * inside each location, and their measurements.
 *
 * Measurements run strictly one at a time through a serial queue, because each
 * `btrfs filesystem du` run walks the whole path. A reload or an unmount bumps a
 * generation counter, so results of earlier work are dropped and queued jobs are skipped.
 */
export function useSnapshotSizes(): SnapshotSizesState {
  const [locations, setLocations] = useState<SnapshotLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lists, setLists] = useState<Record<string, SnapshotListState>>({});
  const [locationMeasurements, setLocationMeasurements] = useState<
    Record<string, MeasurementState>
  >({});
  const [snapshotMeasurements, setSnapshotMeasurements] = useState<
    Record<string, MeasurementState>
  >({});

  /** Mirrors `lists` so queued jobs read the latest listing without stale closures. */
  const listsRef = useRef<Record<string, SnapshotListState>>({});
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Set by cancelBatch; checked between snapshots so the snapshot in progress completes. */
  const cancelRequested = useRef(false);
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const isCurrent = useCallback(
    (gen: number) => gen === generation.current,
    [],
  );

  const setList = useCallback((path: string, state: SnapshotListState) => {
    listsRef.current = { ...listsRef.current, [path]: state };
    setLists(listsRef.current);
  }, []);

  const enqueue = useCallback((job: () => Promise<void>) => {
    const gen = generation.current;
    queue.current = queue.current.then(async () => {
      if (!isCurrent(gen)) return;
      try {
        await job();
      } catch (error) {
        logger.error("Snapshot size job failed:", error);
      }
    });
  }, [isCurrent]);

  const loadLocations = useCallback(async () => {
    const gen = generation.current;
    setLoadingLocations(true);
    try {
      const result = await listSnapshotLocations();
      if (!isCurrent(gen)) return;
      setLocations(result);
      setLocationsError(null);
    } catch (error) {
      logger.error("listSnapshotLocations failed:", error);
      if (!isCurrent(gen)) return;
      setLocationsError(errorMessage(error));
    } finally {
      if (isCurrent(gen)) setLoadingLocations(false);
    }
  }, [isCurrent]);

  useEffect(() => {
    void loadLocations();
    return () => {
      generation.current += 1;
    };
  }, [loadLocations]);

  /** Lists a location unless it is already loaded. Resolves with the entries or null. */
  const ensureList = useCallback(async (
    path: string,
  ): Promise<SnapshotEntry[] | null> => {
    const existing = listsRef.current[path];
    if (existing?.status === "ready") return existing.entries;
    const gen = generation.current;
    setList(path, { status: "loading" });
    try {
      const entries = await listSnapshots(path);
      if (!isCurrent(gen)) return null;
      setList(path, { status: "ready", entries });
      return entries;
    } catch (error) {
      logger.error("listSnapshots failed:", error);
      if (isCurrent(gen)) {
        setList(path, { status: "error", message: errorMessage(error) });
      }
      return null;
    }
  }, [isCurrent, setList]);

  /** Runs `getSnapshotSize` and turns the outcome into a measurement state. */
  const measure = useCallback(
    async (path: string): Promise<MeasurementState> => {
      try {
        const size = await getSnapshotSize(path);
        return size.error
          ? { status: "error", message: size.error }
          : { status: "ready", size };
      } catch (error) {
        logger.error("getSnapshotSize failed:", error);
        return { status: "error", message: errorMessage(error) };
      }
    },
    [],
  );

  const measureSnapshotNow = useCallback(async (path: string, gen: number) => {
    setSnapshotMeasurements((prev) => ({
      ...prev,
      [path]: { status: "measuring", startedAt: Date.now() },
    }));
    const result = await measure(path);
    if (!isCurrent(gen)) return;
    setSnapshotMeasurements((prev) => ({ ...prev, [path]: result }));
  }, [isCurrent, measure]);

  const toggleLocation = useCallback((location: SnapshotLocation) => {
    const willExpand = !expanded[location.path];
    setExpanded((prev) => ({ ...prev, [location.path]: willExpand }));
    if (willExpand) {
      void ensureList(location.path);
    }
  }, [expanded, ensureList]);

  const measureLocation = useCallback((location: SnapshotLocation) => {
    const path = location.path;
    setLocationMeasurements((prev) => ({
      ...prev,
      [path]: { status: "measuring", startedAt: Date.now() },
    }));
    enqueue(async () => {
      const gen = generation.current;
      const result = await measure(path);
      if (!isCurrent(gen)) return;
      setLocationMeasurements((prev) => ({ ...prev, [path]: result }));
    });
  }, [enqueue, isCurrent, measure]);

  const measureSnapshot = useCallback((path: string) => {
    setSnapshotMeasurements((prev) => ({
      ...prev,
      [path]: { status: "measuring", startedAt: Date.now() },
    }));
    enqueue(async () => {
      const gen = generation.current;
      await measureSnapshotNow(path, gen);
    });
  }, [enqueue, measureSnapshotNow]);

  /**
   * Measures the given snapshots one after another, publishing "snapshot X of Y"
   * progress. Honours cancelBatch between snapshots and stops when the generation changes.
   */
  const runBatch = useCallback(async (
    entries: SnapshotEntry[],
    gen: number,
  ) => {
    const total = entries.length;
    for (const [index, entry] of entries.entries()) {
      if (!isCurrent(gen) || cancelRequested.current) break;
      const startedAt = Date.now();
      setBatch({
        current: index + 1,
        total,
        name: entry.name,
        startedAt,
      });
      await measureSnapshotNow(entry.path, gen);
    }
    if (isCurrent(gen)) setBatch(null);
  }, [isCurrent, measureSnapshotNow]);

  const measureLocationSnapshots = useCallback((location: SnapshotLocation) => {
    cancelRequested.current = false;
    enqueue(async () => {
      const gen = generation.current;
      const entries = await ensureList(location.path);
      if (!entries || !isCurrent(gen)) return;
      await runBatch(entries, gen);
    });
  }, [enqueue, ensureList, isCurrent, runBatch]);

  /** Lists every location, then measures all snapshots in one sequential batch. */
  const measureAll = useCallback(() => {
    cancelRequested.current = false;
    const targets = locations.map((location) => location.path);
    enqueue(async () => {
      const gen = generation.current;
      const all: SnapshotEntry[] = [];
      for (const path of targets) {
        if (!isCurrent(gen) || cancelRequested.current) return;
        const entries = await ensureList(path);
        if (entries) all.push(...entries);
      }
      if (!isCurrent(gen)) return;
      await runBatch(all, gen);
    });
  }, [enqueue, ensureList, isCurrent, locations, runBatch]);

  const cancelBatch = useCallback(() => {
    cancelRequested.current = true;
  }, []);

  const reload = useCallback(() => {
    generation.current += 1;
    cancelRequested.current = false;
    listsRef.current = {};
    setLists({});
    setExpanded({});
    setLocationMeasurements({});
    setSnapshotMeasurements({});
    setBatch(null);
    void loadLocations();
  }, [loadLocations]);

  const isExpandedPath = useCallback(
    (path: string) => expanded[path] === true,
    [expanded],
  );

  const totals = useMemo(() => {
    const measurements: Array<MeasurementState | undefined> = [];
    for (const list of Object.values(lists)) {
      if (list?.status !== "ready") continue;
      for (const entry of list.entries) {
        measurements.push(snapshotMeasurements[entry.path]);
      }
    }
    return summarizeSnapshotSizes(measurements);
  }, [lists, snapshotMeasurements]);

  const busy =
    Object.values(lists).some((list) => list?.status === "loading") ||
    Object.values(locationMeasurements).some((m) =>
      m?.status === "measuring"
    ) ||
    Object.values(snapshotMeasurements).some((m) => m?.status === "measuring");

  /** Ticks the clock while anything is measuring so elapsed counters update live. */
  const ticking = busy || batch !== null;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);

  return {
    locations,
    loadingLocations,
    locationsError,
    busy,
    batch,
    now,
    cancelBatch,
    isExpanded: isExpandedPath,
    lists,
    locationMeasurements,
    snapshotMeasurements,
    totals,
    toggleLocation,
    measureLocation,
    measureLocationSnapshots,
    measureSnapshot,
    measureAll,
    reload,
  };
}
