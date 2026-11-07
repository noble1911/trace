import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initAppearance } from "@/domains/appearance/apply";
// Stylesheets: tokens + shared first, then one per domain. All imported here
// so the cascade order is explicit in one place.
import "@/styles/tokens.css";
import "@/styles/themes.css";
import "@/styles/globals.css";
import "@/styles/markdown.css";
import "@/styles/code-themes.css";
import "@/components/error-boundary.css";
import "@/components/menu.css";
import "@/components/status-light.css";
import "@/components/side-panel.css";
import "@/app/shell.css";
import "@/domains/board/board.css";
import "@/domains/inbox/inbox.css";
import "@/domains/inbox/inbox-row.css";
import "@/domains/fleet/fleet.css";
import "@/domains/board/card.css";
import "@/domains/agent/detail.css";
import "@/domains/agent/answer.css";
import "@/domains/agent/rail.css";
import "@/domains/agent/files.css";
import "@/domains/quickOpen/quick-open.css";
import "@/domains/agent/panes.css";
import "@/domains/agent/terminal/terminal-extras.css";
import "@/domains/transcript/transcript.css";
import "@/domains/agentChat/chat.css";
import "@/domains/agentChat/cards.css";
import "@/domains/agentChat/composer.css";
import "@/domains/agentChat/transport.css";
import "@/domains/prs/prs.css";
import "@/domains/prs/rail.css";
import "@/domains/prs/checks.css";
import "@/domains/prs/github-md.css";
import "@/domains/sessions/sessions.css";
import "@/domains/sessions/session-list.css";
import "@/domains/sessions/rail-recents.css";
import "@/domains/schedules/schedules.css";
import "@/domains/schedules/share.css";
import "@/domains/schedules/precheck.css";
import "@/domains/integrations/integrations.css";
import "@/domains/github/github.css";
import "@/domains/repos/repos.css";
import "@/domains/settings/settings.css";
import "@/domains/settings/shortcuts.css";
import "@/domains/settings/sidebar.css";
import "@/domains/settings/cleanup.css";
import "@/domains/appearance/appearance.css";
import "@/domains/appearance/previews.css";
import "@/domains/appearance/snippets.css";
import "@/domains/activity/activity.css";
import "@/domains/orchestrator/orchestrator.css";
import "@/domains/orchestrator/chat.css";
import "@/domains/orchestrator/charts.css";
import "@/domains/buddy/buddy.css";

// Dev only: /#/dev/chat shows the chat UI over a fixture journal. The check is
// on `import.meta.env.DEV`, so production builds drop the page and its fixture.
const DevPage =
  import.meta.env.DEV && window.location.hash.startsWith("#/dev/chat")
    ? lazy(() =>
        import("@/domains/agentChat/dev/ChatFixturePage").then((m) => ({
          default: m.ChatFixturePage,
        }))
      )
    : null;

// The saved theme goes on <html> before the first paint, so there is no flash of Dark.
// The dev page runs in a plain browser too, where the native window calls would throw.
if (!DevPage) initAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      label="trace crashed"
      actionLabel="Reload trace"
      onBack={() => window.location.reload()}
    >
      {DevPage ? (
        <Suspense fallback={null}>
          <DevPage />
        </Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
