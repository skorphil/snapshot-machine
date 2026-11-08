/**
 * Application entry point. Mounts the root React tree into the `#root`
 * element of `index.html`.
 *
 * @module
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
