import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (OFL-1.1), latin subset (covers Portuguese), bundled with relative paths.
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./index.css";
import App from "./App";
import { applyMotionClasses } from "./lib/motion";

// Reveals and ambient motion are opt-in: without JS, or when the visitor's motion preference resolves
// to off (by default, the system's reduced-motion setting), everything is visible and still.
applyMotionClasses();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
