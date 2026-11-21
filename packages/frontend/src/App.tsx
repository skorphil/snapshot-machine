import "./App.css";
import { useViewRoute } from "@/shared/view-route/index.ts";
import { NavSidebar } from "@/shared/ui/nav-sidebar/index.ts";
import { HistoryView } from "@/features/folder-history/index.ts";
import { ConfigEditor } from "@/features/config-editor/index.ts";
import { BackupRunControl } from "@/features/backup-run/index.ts";
import { BackupScheduleControl } from "@/features/backup-schedule/index.ts";
import { BtrfsTree } from "@/features/btrfs-tree/index.ts";
import { SnapshotSizesView } from "@/features/snapshot-size/index.ts";
import {
  DependencyBanner,
  useDependencyStatus,
} from "@/features/dependency-status/index.ts";

/** Root application component; reports dependency status and switches between the history and config editor views. */
function App() {
  const dependencies = useDependencyStatus();
  const backupsEnabled = dependencies.status === "ready" &&
    dependencies.report.ok;
  const [view, setView] = useViewRoute();

  return (
    <div className="app">
      <NavSidebar view={view} onSelectView={setView} />
      <main className="app-content">
        {view === "history" && <HistoryView backupsEnabled={backupsEnabled} />}
        {view === "sizes" && <SnapshotSizesView />}
        {view === "config" && (
          <>
            <BackupScheduleControl />
            <BtrfsTree />
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
    </div>
  );
}

export default App;
