// @ts-types="@/shared/types/css-module.d.ts"
import styles from "./HistoryView.module.css";

import { useEffect, useMemo, useState } from "react";
import { deduplicateVersions } from "../model/file-snippet.ts";
import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import {
  getHomeDirectory,
  listFolderHistory,
  pickFolder,
  restoreFile,
} from "../api/index.ts";
import { logger } from "@/shared/logger.ts";
import { logFromWebview } from "@/shared/bindings.ts";
import { FileSearchBar } from "./FileSearchBar.tsx";
import { FileSnippet } from "./FileSnippet.tsx";
import { FileVersionSnippet } from "./FileVersionSnippet.tsx";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Folder history explorer: lets the user pick a folder, scan its btrbk
 * snapshot history, and restore any version of a file.
 */
export function HistoryView({ backupsEnabled }: HistoryViewProps) {
  const [path, setPath] = useState("");
  const [history, setHistory] = useState<FileHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIno, setSelectedIno] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHomeDirectory()
      .then((home) => {
        if (!cancelled) {
          setPath(home.replace(/\/+$/, "") + "/Documents");
        }
      })
      .catch((e) => {
        logger.error("getHomeDirectory failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEntry = useMemo(
    () => history?.find((entry) => entry.ino === selectedIno) ?? null,
    [history, selectedIno],
  );

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
      const entries = await listFolderHistory(path);
      setHistory(entries);
      setSelectedIno(null);
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
    <div className={styles.historyView}>
      <FileSearchBar
        path={path}
        onPathChange={setPath}
        onBrowse={handleBrowse}
        onScan={fetchHistory}
        scanDisabled={loading || !backupsEnabled || path.trim() === ""}
        scanLabel={loading ? "Loading..." : "Scan"}
      />

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {history === null
        ? (
          <div className={styles.empty}>
            Select a folder to view backups
          </div>
        )
        : (
          <div className={styles.panes}>
            <section className={styles.list} aria-label="Files">
              {history.length === 0 && (
                <div className={styles.empty}>No files found in backups</div>
              )}
              {history.map((entry) => (
                <FileSnippet
                  key={entry.ino}
                  entry={entry}
                  selected={entry.ino === selectedIno}
                  onSelect={() => setSelectedIno(entry.ino)}
                />
              ))}
            </section>

            <section className={styles.versions} aria-label="Versions">
              {selectedEntry
                ? (
                  <>
                    <h2 className={styles.versionsTitle}>
                      <span className={styles.versionsName}>
                        {selectedEntry.name}
                      </span>
                      {selectedEntry.deleted && (
                        <span className={styles.deletedBadge}>Deleted</span>
                      )}
                    </h2>
                    <ul className={styles.versionList}>
                      {deduplicateVersions(selectedEntry.versions).map(
                        (version) => (
                          <FileVersionSnippet
                            key={version.snapshot}
                            version={version}
                            restoreDisabled={!backupsEnabled}
                            onRestore={() =>
                              handleRestore(selectedEntry, version)}
                          />
                        ),
                      )}
                    </ul>
                  </>
                )
                : (
                  <div className={styles.empty}>
                    Select a file to view its versions
                  </div>
                )}
            </section>
          </div>
        )}
    </div>
  );
}

/** Props for {@link HistoryView}. */
export type HistoryViewProps = {
  /** False while required backup dependencies are missing or still being checked. */
  backupsEnabled: boolean;
};
