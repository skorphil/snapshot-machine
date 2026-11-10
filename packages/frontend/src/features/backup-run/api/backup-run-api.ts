import type {
  BackupStatus,
  RunBackupResult,
} from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Asks the Root Helper to start a backup run after Polkit authorization. */
export function runBackup(): Promise<RunBackupResult> {
  return getBindings().runBackup();
}

/** Returns the state of the current or most recent backup run. */
export function getBackupStatus(): Promise<BackupStatus> {
  return getBindings().getBackupStatus();
}
