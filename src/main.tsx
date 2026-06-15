import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
// Stylesheets: tokens + shared first, then one per domain. All imported here
// so the cascade order is explicit in one place.
import "@/styles/tokens.css";
import "@/styles/globals.css";
import "@/app/shell.css";
import "@/domains/board/board.css";
import "@/domains/board/card.css";
import "@/domains/agent/detail.css";
import "@/domains/agent/rail.css";
import "@/domains/agent/files.css";
import "@/domains/agent/panes.css";
import "@/domains/prs/prs.css";
import "@/domains/sessions/sessions.css";
import "@/domains/settings/settings.css";
import "@/domains/activity/activity.css";
import "@/domains/orchestrator/orchestrator.css";
import "@/domains/orchestrator/chat.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
