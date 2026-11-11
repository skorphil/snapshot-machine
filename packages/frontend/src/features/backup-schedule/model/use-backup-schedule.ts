import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BackupSchedule,
  ScheduleInterval,
  ScheduleStatus,
  ScheduleUnit,
} from "@snapshot-machine/shared/types.ts";
import {
  isValidScheduleCount,
  SCHEDULE_COUNTS,
  SCHEDULE_UNITS,
} from "@snapshot-machine/shared/schedule-limits.ts";
import { getSchedule, getScheduleStatus, setSchedule } from "../api/index.ts";
import { logger } from "@/shared/logger.ts";

/** Units offered in the UI, in display order. */
export const SCHEDULE_UNIT_OPTIONS: readonly ScheduleUnit[] = SCHEDULE_UNITS;

/** Interval shown before a schedule has been loaded. */
const DEFAULT_INTERVAL: ScheduleInterval = { count: 1, unit: "days" };

/** Status shown before the first answer from the helper. */
const UNKNOWN_STATUS: ScheduleStatus = {
  lastRunTime: "",
  nextRunTime: "",
  lastRunResult: "never",
};

/** Reduces a thrown value to a displayable message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Two intervals are equal when both count and unit match. */
function sameInterval(
  a: ScheduleInterval | null,
  b: ScheduleInterval | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.count === b.count && a.unit === b.unit;
}

/** State and actions of the backup schedule control. */
export type BackupScheduleState = {
  /** Schedule currently applied by the Root Helper. */
  saved: BackupSchedule | null;
  /** Count selected in the form, not yet applied. */
  count: number;
  /** Unit selected in the form, not yet applied. */
  unit: ScheduleUnit;
  /** Selected state of the timer in the form, not yet applied. */
  enabled: boolean;
  /** True when the form holds a count that the helper would accept. */
  countValid: boolean;
  /** Last and next run reported by systemd. */
  status: ScheduleStatus;
  /** True while the initial schedule is loading. */
  loading: boolean;
  /** True while a save request is in flight (including the Polkit prompt). */
  saving: boolean;
  /** True when the form differs from the applied schedule. */
  dirty: boolean;
  /** Error from the last read or save, or null. */
  error: string | null;
  /** Changes the count in the form. */
  setCount: (value: number) => void;
  /** Changes the unit in the form and selects the first count of that unit. */
  selectUnit: (value: ScheduleUnit) => void;
  /** Changes the enabled flag in the form. */
  setEnabled: (value: boolean) => void;
  /** Applies the form values through the Root Helper. */
  save: () => Promise<void>;
  /** Reloads the schedule and the run status. */
  refresh: () => Promise<void>;
};

/**
 * Loads the backup schedule and its run status, and applies changes through the Root Helper.
 * The form is kept separate from the applied schedule until `save` succeeds.
 */
export function useBackupSchedule(): BackupScheduleState {
  const [saved, setSaved] = useState<BackupSchedule | null>(null);
  const [count, setCountState] = useState(DEFAULT_INTERVAL.count);
  const [unit, setUnit] = useState<ScheduleUnit>(DEFAULT_INTERVAL.unit);
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<ScheduleStatus>(UNKNOWN_STATUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getScheduleStatus();
      if (mounted.current) setStatus(next);
    } catch (e) {
      logger.error("getScheduleStatus failed:", e);
      if (mounted.current) setError(errorMessage(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await getSchedule();
      if (!mounted.current) return;
      setSaved(current);
      if (current.interval) {
        setCountState(current.interval.count);
        setUnit(current.interval.unit);
      }
      setEnabledState(current.enabled);
    } catch (e) {
      logger.error("getSchedule failed:", e);
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
    await refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const countValid = isValidScheduleCount(unit, count);

  const setCount = useCallback((value: number) => {
    setCountState(value);
  }, []);

  const selectUnit = useCallback((value: ScheduleUnit) => {
    setUnit(value);
    // The accepted counts differ per unit, so pick one that the unit allows.
    setCountState((current) =>
      isValidScheduleCount(value, current) ? current : SCHEDULE_COUNTS[value][0]
    );
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
  }, []);

  // A paused timer keeps its interval, so the form only has no interval while
  // nothing is scheduled and the timer is off.
  const hasInterval = enabled || saved?.interval != null;
  const formInterval: ScheduleInterval | null = hasInterval
    ? { count, unit }
    : null;

  const dirty = saved === null
    ? true
    : !sameInterval(saved.interval, formInterval) ||
      saved.enabled !== enabled;

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await setSchedule(
        hasInterval ? { count, unit } : null,
        enabled,
      );
      if (!result.ok) {
        setError(result.error ?? "Schedule could not be saved");
      }
      await refresh();
    } catch (e) {
      logger.error("setSchedule failed:", e);
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [count, unit, enabled, hasInterval, refresh]);

  return {
    saved,
    count,
    unit,
    enabled,
    countValid,
    status,
    loading,
    saving,
    dirty,
    error,
    setCount,
    selectUnit,
    setEnabled,
    save,
    refresh,
  };
}
