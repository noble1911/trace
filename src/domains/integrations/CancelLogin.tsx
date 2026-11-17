import { useEffect, useRef } from "react";
import { mcpCancelLogin } from "@/ipc/mcp";

interface CancelLoginProps {
  /** A browser login is being waited on. */
  waiting: boolean;
}

// Beside a "Waiting for your browser…" button: stops waiting on a login that went
// wrong in the browser (wrong details, a refusal that never comes back), which frees
// trace's login port at once rather than at the deadline. Closing the dialog while it
// waits cancels it too. The connect then rejects with `LOGIN_CANCELLED`, which the
// dialog doesn't report.
export function CancelLogin({ waiting }: CancelLoginProps) {
  const waitingNow = useRef(waiting);
  waitingNow.current = waiting;
  useEffect(
    () => () => {
      if (waitingNow.current) void mcpCancelLogin();
    },
    []
  );
  if (!waiting) return null;
  return (
    <button type="button" className="btn" onClick={() => void mcpCancelLogin()}>
      Cancel
    </button>
  );
}
