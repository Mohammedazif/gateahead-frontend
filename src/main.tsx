import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";

import { App } from "./App";
import "./styles.css";
import { retireDevWorker, watchWorkerUpdates } from "./workerLifecycle";

const root = document.getElementById("root");
if (!root) throw new Error("missing root");

async function start() {
  if (import.meta.env.DEV && "serviceWorker" in navigator && "caches" in window) {
    try {
      if (await retireDevWorker(navigator.serviceWorker, window.caches, window.location.origin)) {
        window.location.reload();
        return;
      }
    } catch { /* Development still works when worker/cache access is unavailable. */ }
  }
  createRoot(root!).render(<StrictMode><App /></StrictMode>);
}

void start();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  watchWorkerUpdates(navigator.serviceWorker, () => window.location.reload());
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}
