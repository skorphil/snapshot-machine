import "./App.css";
import { HistoryView } from "@/features/folder-history/index.ts";

/** Root application component; renders the folder history view. */
function App() {
  return (
    <main className="app">
      <HistoryView />
    </main>
  );
}

export default App;
