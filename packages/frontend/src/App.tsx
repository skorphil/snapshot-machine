import "./App.css";
import { HistoryView } from "@/features/folder-history/index.ts";
import {
  DependencyBanner,
  useDependencyStatus,
} from "@/features/dependency-status/index.ts";

/** Root application component; reports dependency status and renders the folder history view. */
function App() {
  const dependencies = useDependencyStatus();
  const backupsEnabled = dependencies.status === "ready" &&
    dependencies.report.ok;

  return (
    <main className="app">
      <HistoryView backupsEnabled={backupsEnabled} />
      <DependencyBanner state={dependencies} />
    </main>
  );
}

export default App;
