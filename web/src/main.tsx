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
import { applyLang, detectLang } from "./lib/i18n";
import { applyMotionClasses } from "./lib/motion";

// Reveals are opt-in: without JS, everything is visible and still.
applyMotionClasses();
// Interface language before the first render: ?lang=, a remembered choice, the browser's languages, English.
applyLang(detectLang());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
