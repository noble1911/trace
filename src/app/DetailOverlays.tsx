import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AgentDetail } from "@/domains/agent/AgentDetail";
import { useBoardStore } from "@/domains/board/store";
import { useIssuesStore } from "@/domains/issues/store";
import { SessionDetail } from "@/domains/sessions/SessionDetail";
import { useSessionsStore } from "@/domains/sessions/store";

// The detail that overlays the page: an open ticket (on the loaded board) or an open
// session. Back returns to the page, so `backLabel` names it.
export function DetailOverlays({ backLabel }: { backLabel: string }) {
  const data = useBoardStore((s) => s.data);
  const selectedIssueKey = useBoardStore((s) => s.selectedIssueKey);
  const closeIssue = useBoardStore((s) => s.closeIssue);
  const site = useIssuesStore((s) => s.sessions.jira?.site ?? null);
  const sessions = useSessionsStore((s) => s.sessions);
  const selectedSessionId = useSessionsStore((s) => s.selectedId);
  const closeSession = useSessionsStore((s) => s.close);

  const openIssue = selectedIssueKey
    ? (data?.issues.find((i) => i.key === selectedIssueKey) ?? null)
    : null;
  const openSession = selectedSessionId
    ? (sessions.find((s) => s.id === selectedSessionId) ?? null)
    : null;

  return (
    <>
      {openIssue && (
        <ErrorBoundary label={`${openIssue.key} detail crashed`} onBack={closeIssue}>
          <AgentDetail issue={openIssue} site={site} onBack={closeIssue} backLabel={backLabel} />
        </ErrorBoundary>
      )}
      {openSession && (
        <ErrorBoundary label="Session detail crashed" onBack={closeSession}>
          <SessionDetail session={openSession} onBack={closeSession} backLabel={backLabel} />
        </ErrorBoundary>
      )}
    </>
  );
}
