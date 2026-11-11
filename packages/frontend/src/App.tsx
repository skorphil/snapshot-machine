import { useState } from "react";
import "./App.css";
import { HistoryView } from "@/features/folder-history/index.ts";
import { ConfigEditor } from "@/features/config-editor/index.ts";
import { BackupRunControl } from "@/features/backup-run/index.ts";
import { BackupScheduleControl } from "@/features/backup-schedule/index.ts";
import {
  DependencyBanner,
  useDependencyStatus,
} from "@/features/dependency-status/index.ts";

/** Top-level views switchable from the tab bar. */
type View = "history" | "config";

/** Root application component; reports dependency status and switches between the history and config editor views. */
function App() {
  const dependencies = useDependencyStatus();
  const backupsEnabled = dependencies.status === "ready" &&
    dependencies.report.ok;
  const [view, setView] = useState<View>("history");

  return (
    <main className="app">
      <nav className="view-tabs" aria-label="Views">
        <button
          type="button"
          className={view === "history" ? "view-tab active" : "view-tab"}
          aria-pressed={view === "history"}
          onClick={() => setView("history")}
        >
          Snapshots History
        </button>
        <button
          type="button"
          className={view === "config" ? "view-tab active" : "view-tab"}
          aria-pressed={view === "config"}
          onClick={() => setView("config")}
        >
          Config Editor
        </button>
      </nav>

      {view === "history" ? <HistoryView backupsEnabled={backupsEnabled} /> : (
        <>
          <BackupScheduleControl />
          <ConfigEditor
            renderExtraControls={({ hasUnsavedChanges }) => (
              <BackupRunControl
                available={backupsEnabled}
                hasUnsavedChanges={hasUnsavedChanges}
              />
            )}
          />
        </>
      )}
      <DependencyBanner state={dependencies} />
    </main>
  );
}

export default App;
