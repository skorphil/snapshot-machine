import { useState } from "react";
import type { DateMode } from "../model/types.ts";
import { isDateMode } from "../model/types.ts";
import { formatDate, getDisplayDate } from "../model/dates.ts";
import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import { listFolderHistory, pickFolder, restoreFile } from "../api/index.ts";
import { logger } from "@/shared/logger.ts";
import { logFromWebview } from "@/shared/bindings.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Folder history explorer: lets the user pick a folder, scan its btrbk
 * snapshot history, and restore any version of a file.
 */
export function HistoryView() {
  const [path, setPath] = useState("/home/philipp/Documents");
  const [history, setHistory] = useState<FileHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>("arrival");

  const handleBrowse = async () => {
    try {
      const selected = await pickFolder();
      if (selected) {
        setPath(selected);
        setError(null);
      }
    } catch (e) {
      logger.error("handleBrowse pickFolder failed:", e);
      setError("Picker error: " + errorMessage(e));
    }
  };

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await listFolderHistory(path));
    } catch (e) {
      logFromWebview({
        context: "fetchHistory",
        path,
        error: errorMessage(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (
    entry: FileHistoryEntry,
    version: FileVersion,
  ) => {
    try {
      const restored = await restoreFile(entry, version, path);
      if (!restored) return;
      alert("Restored successfully!");
    } catch (e) {
      alert("Restore failed: " + errorMessage(e));
    }
  };

  return (
    <div className="history-view">
      <div className="controls">
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Enter folder path"
        />
        <button type="button" onClick={handleBrowse}>
          Browse...
        </button>
        <button type="button" onClick={fetchHistory} disabled={loading}>
          {loading ? "Loading..." : "Scan History"}
        </button>
        <select
          value={dateMode}
          onChange={(e) => {
            const mode = e.target.value;
            if (isDateMode(mode)) setDateMode(mode);
          }}
          title="Which timestamp to show for each version"
        >
          <option value="arrival">Arrival Date (birth/change)</option>
          <option value="modified">Modification Date (mtime)</option>
        </select>
      </div>

      {error && <div className="error">{error}</div>}

      <table className="history-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th>Latest Date</th>
            <th>Latest Snapshot</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => {
            const latestVersion = entry.versions[0];
            const latestDate = latestVersion
              ? getDisplayDate(latestVersion, dateMode)
              : null;

            return (
              <tr key={entry.ino} className={entry.deleted ? "deleted" : ""}>
                <td>{entry.name}</td>
                <td>{entry.type}</td>
                <td>{entry.deleted ? "Deleted" : "Active"}</td>
                <td>{formatDate(latestDate)}</td>
                <td>{entry.lastSeen}</td>
                <td>
                  <select
                    onChange={(e) => {
                      const ver = entry.versions.find((v) =>
                        v.snapshot === e.target.value
                      );
                      if (ver) {
                        handleRestore(entry, ver);
                      }
                    }}
                  >
                    <option value="">Restore from...</option>
                    {entry.versions.map((v) => (
                      <option key={v.snapshot} value={v.snapshot}>
                        {v.snapshot} ({formatDate(getDisplayDate(v, dateMode))})
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
