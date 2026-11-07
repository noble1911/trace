import { useState } from "react";
import { AgentDefaultsSettings } from "./AgentDefaultsSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AssistantSettings } from "./AssistantSettings";
import { AutoCleanupSettings } from "./AutoCleanupSettings";
import { BuddySettings } from "./BuddySettings";
import { NotificationSettings } from "./NotificationSettings";
import { RepoSettings } from "./RepoSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SidebarSettings } from "./SidebarSettings";
import { UpdateSettings } from "./UpdateSettings";
import { WorktreeSettings } from "./WorktreeSettings";

type SettingsTab =
  | "agents"
  | "notifications"
  | "assistant"
  | "appearance"
  | "sidebar"
  | "shortcuts"
  | "worktrees"
  | "updates";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "notifications", label: "Notifications" },
  { id: "assistant", label: "Assistant" },
  { id: "appearance", label: "Appearance" },
  { id: "sidebar", label: "Sidebar" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "worktrees", label: "Worktrees" },
  { id: "updates", label: "Updates" },
];

// Settings: one tab per concern, so each is a short page rather than one long scroll.
export function SettingsView() {
  const [tab, setTab] = useState<SettingsTab>("agents");
  // Bumped when auto-cleanup removes worktrees, so the list remounts and rescans.
  const [worktreeScan, setWorktreeScan] = useState(0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="desc">Workspace defaults for trace.</div>
        </div>
      </div>
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="page-body">
        <div className="settings-wrap">
          {tab === "agents" && (
            <>
              <RepoSettings />
              <AgentDefaultsSettings />
            </>
          )}
          {tab === "notifications" && <NotificationSettings />}
          {tab === "assistant" && (
            <>
              <AssistantSettings />
              <BuddySettings />
            </>
          )}
          {tab === "appearance" && <AppearanceSettings />}
          {tab === "sidebar" && <SidebarSettings />}
          {tab === "shortcuts" && <ShortcutSettings />}
          {tab === "worktrees" && (
            <>
              <AutoCleanupSettings onCleaned={() => setWorktreeScan((n) => n + 1)} />
              <WorktreeSettings key={worktreeScan} />
            </>
          )}
          {tab === "updates" && <UpdateSettings />}
        </div>
      </div>
    </div>
  );
}
