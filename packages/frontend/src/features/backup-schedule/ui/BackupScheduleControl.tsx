import type {
  ScheduleInterval,
  ScheduleUnit,
} from "@snapshot-machine/shared/types.ts";
import { SCHEDULE_COUNTS } from "@snapshot-machine/shared/schedule-limits.ts";
import { SCHEDULE_UNIT_OPTIONS, useBackupSchedule } from "../model/index.ts";

/** Label of each unit, singular for a count of one. */
const UNIT_LABELS: Record<ScheduleUnit, { one: string; many: string }> = {
  minutes: { one: "minute", many: "minutes" },
  hours: { one: "hour", many: "hours" },
  days: { one: "day", many: "days" },
};

/** Label of each last run result. */
const RESULT_LABELS: Record<
  "never" | "running" | "success" | "failure",
  string
> = {
  never: "Never run",
  running: "Running",
  success: "Success",
  failure: "Failure",
};

/** Formats a systemd time for display, or a dash when there is none. */
function formatRunTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Describes an interval in plain words, for example "every 2 hours". */
function describeInterval(interval: ScheduleInterval): string {
  const label = interval.count === 1
    ? UNIT_LABELS[interval.unit].one
    : UNIT_LABELS[interval.unit].many;
  return `every ${interval.count} ${label}`;
}

/**
 * Automatic backup schedule. Changes are applied through the Root Helper, which
 * writes the systemd timer and service units after Polkit authorization.
 */
export function BackupScheduleControl() {
  const schedule = useBackupSchedule();
  const {
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
  } = schedule;

  const counts = SCHEDULE_COUNTS[unit];
  const formSummary = countValid
    ? `Backups run ${describeInterval({ count, unit })}.`
    : `Choose an interval of ${counts.join(", ")} ${UNIT_LABELS[unit].many}.`;

  const applied = saved === null
    ? "unknown"
    : saved.interval === null
    ? "Not scheduled"
    : saved.enabled
    ? `${describeInterval(saved.interval)} (enabled)`
    : `${describeInterval(saved.interval)} (paused)`;

  return (
    <section className="backup-schedule" aria-label="Automatic backup schedule">
      <div className="backup-schedule-header">
        <h2 className="backup-schedule-title">Automatic backups</h2>
        <span className="backup-schedule-applied">
          Current: {applied}
        </span>
      </div>

      <div className="backup-schedule-interval">
        <label className="backup-schedule-option">
          <input
            type="checkbox"
            checked={enabled}
            disabled={loading || saving}
            onChange={(e) =>
              schedule.setEnabled(e.target.checked)}
          />
          Timer enabled
        </label>

        <fieldset
          className="backup-schedule-fields"
          disabled={loading || saving}
        >
          <legend>Run every</legend>
          <select
            className="backup-schedule-count"
            aria-label="Interval count"
            value={count}
            onChange={(e) =>
              schedule.setCount(Number(e.target.value))}
          >
            {counts.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            className="backup-schedule-unit"
            aria-label="Interval unit"
            value={unit}
            onChange={(e) =>
              schedule.selectUnit(e.target.value as ScheduleUnit)}
          >
            {SCHEDULE_UNIT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {UNIT_LABELS[option].many}
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      <p
        className={`backup-schedule-summary${
          countValid ? "" : " backup-schedule-summary-invalid"
        }`}
      >
        {formSummary}
      </p>

      <div className="backup-schedule-actions">
        <button
          type="button"
          className="backup-schedule-save"
          onClick={() => void schedule.save()}
          disabled={loading || saving || !dirty || !countValid}
        >
          {saving ? "Applying..." : "Apply"}
        </button>
        {dirty && !saving && (
          <span className="backup-schedule-hint">Unapplied changes</span>
        )}
      </div>

      {error && (
        <p className="error backup-schedule-error" role="alert">
          {error}
        </p>
      )}

      <dl className="backup-schedule-status">
        <div>
          <dt>Last run</dt>
          <dd>
            {formatRunTime(status.lastRunTime)}{" "}
            <span
              className={`backup-schedule-badge backup-schedule-badge-${status.lastRunResult}`}
            >
              {RESULT_LABELS[status.lastRunResult]}
            </span>
          </dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd>{formatRunTime(status.nextRunTime)}</dd>
        </div>
      </dl>
    </section>
  );
}
