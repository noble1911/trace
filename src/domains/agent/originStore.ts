import { create } from "zustand";
import type { CreatedBy } from "@/domains/sessions/types";
import { issueOrigins, setIssueOrigin } from "@/ipc/issueOrigins";

// Who started each ticket's agent, as Fleet shows it ("by Epic PM-5300"). Read
// from disk once and on demand; a start records its creator here and on disk.

interface OriginState {
  origins: Record<string, CreatedBy>;
  /** Re-read every ticket's creator from disk. */
  load: () => Promise<void>;
  /** A ticket's agent was just started by `createdBy`. */
  record: (issueKey: string, createdBy: CreatedBy) => void;
}

export const useIssueOrigins = create<OriginState>((set) => ({
  origins: {},
  async load() {
    const origins = await issueOrigins().catch(() => null);
    if (origins) set({ origins });
  },
  record(issueKey, createdBy) {
    set((s) => {
      const origins = { ...s.origins };
      if (createdBy.kind === "user") delete origins[issueKey];
      else origins[issueKey] = createdBy;
      return { origins };
    });
    void setIssueOrigin(issueKey, createdBy).catch(() => {});
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
