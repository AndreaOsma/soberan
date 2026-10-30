import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// Modo dev de ágora (dev/lib/dev-overlay): solo actúa dentro de ágora.
import "./vendor/dev-overlay/overlay";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
