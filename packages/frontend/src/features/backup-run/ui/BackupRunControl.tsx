import type { BackupStatus } from "@snapshot-machine/shared/types.ts";
import { useBackupRun } from "../model/use-backup-run.ts";

/** Props of the manual backup trigger. */
export type BackupRunControlProps = {
  /** False when btrbk or btrfs is missing; backups cannot run then. */
  available: boolean;
  /** True when the configuration has unsaved changes; a run would use the saved file. */
  hasUnsavedChanges: boolean;
};

/** Human-readable label for each lifecycle state. */
const STATE_LABELS: Record<BackupStatus["state"], string> = {
  idle: "Idle",
  running: "Running",
  success: "Success",
  failure: "Failure",
};

/** Formats an ISO timestamp for display in the local time zone. */
function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Manual "Run Now" trigger. Starts `btrbk run` through the Root Helper, which
 * asks for Polkit authorization, and shows the status of the run.
 */
export function BackupRunControl({
  available,
  hasUnsavedChanges,
}: BackupRunControlProps) {
  const backup = useBackupRun();
  const { status, starting, error } = backup;
  const running = status.state === "running";

  const disabledReason = !available
    ? "btrbk or btrfs is not available"
    : running
    ? "A backup is already running"
    : hasUnsavedChanges
    ? "Save the configuration before running a backup"
    : null;

  const finished = formatTime(status.finishedAt);

  return (
    <section className="backup-run" aria-label="Manual backup">
      <div className="backup-run-header">
        <button
          type="button"
          className="backup-run-button"
          onClick={() => void backup.start()}
          disabled={disabledReason !== null || starting}
          title={disabledReason ?? "Start a backup now"}
        >
          {starting ? "Starting..." : running ? "Running..." : "Run Now"}
        </button>
        <span
          className={`backup-run-state backup-run-state-${status.state}`}
          role="status"
          aria-live="polite"
        >
          {STATE_LABELS[status.state]}
          {status.state !== "idle" && finished ? ` · ${finished}` : ""}
        </span>
      </div>

      {disabledReason && !running && (
        <p className="backup-run-hint">{disabledReason}.</p>
      )}

      {error && (
        <p className="error backup-run-error" role="alert">
          {error}
        </p>
      )}

      {status.state === "failure" && status.message && (
        <pre className="backup-run-output" aria-label="Backup failure details">
          {status.message}
        </pre>
      )}
    </section>
  );
}
