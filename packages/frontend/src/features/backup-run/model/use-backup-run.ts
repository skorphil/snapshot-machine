import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupStatus } from "@snapshot-machine/shared/types.ts";
import { getBackupStatus, runBackup } from "../api/index.ts";
import { logger } from "@/shared/logger.ts";

/** Interval between status polls while a backup is running. */
export const STATUS_POLL_INTERVAL_MS = 2000;

/** Status shown before the first answer from the helper. */
const UNKNOWN_STATUS: BackupStatus = {
  state: "idle",
  message: "",
  startedAt: null,
  finishedAt: null,
};

/** Reduces a thrown value to a displayable message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** State and actions of the manual backup trigger. */
export type BackupRunState = {
  /** Latest status reported by the Root Helper. */
  status: BackupStatus;
  /** True while a start request is in flight (including the Polkit prompt). */
  starting: boolean;
  /** Error from the last start request or status read, or null. */
  error: string | null;
  /** Starts a backup run through the Root Helper. */
  start: () => Promise<void>;
};

/**
 * Loads the backup status on mount, starts runs through the Root Helper, and
 * polls the status while a run is in progress.
 */
export function useBackupRun(): BackupRunState {
  const [status, setStatus] = useState<BackupStatus>(UNKNOWN_STATUS);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<BackupStatus | null> => {
    try {
      const next = await getBackupStatus();
      if (mounted.current) setStatus(next);
      return next;
    } catch (e) {
      logger.error("getBackupStatus failed:", e);
      if (mounted.current) setError(errorMessage(e));
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const running = status.state === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await runBackup();
      if (!result.ok) {
        setError(result.error ?? "Backup could not be started");
      }
      await refresh();
    } catch (e) {
      logger.error("runBackup failed:", e);
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setStarting(false);
    }
  }, [refresh]);

  return { status, starting, error, start };
}
