import { I } from "@/components/Icon";
import type { NavId } from "./nav";

interface RailProps {
  nav: NavId;
  onNav: (nav: NavId) => void;
  waitingCount: number;
}

export function Rail({ nav, onNav, waitingCount }: RailProps) {
  return (
    <aside className="rail">
      <div className="logo">tr</div>
      <nav className="nav">
        <button
          type="button"
          className={`nav-btn${nav === "board" ? " active" : ""}`}
          onClick={() => onNav("board")}
          title="Board"
        >
          <I.Board size={16} />
          {waitingCount > 0 && <span className="badge" />}
        </button>
        <button
          type="button"
          className={`nav-btn${nav === "sessions" ? " active" : ""}`}
          onClick={() => onNav("sessions")}
          title="Sessions"
        >
          <I.Agents size={16} />
        </button>
        <button
          type="button"
          className={`nav-btn${nav === "pr" ? " active" : ""}`}
          onClick={() => onNav("pr")}
          title="Pull requests"
        >
          <I.PR size={16} />
        </button>
        <button
          type="button"
          className={`nav-btn${nav === "activity" ? " active" : ""}`}
          onClick={() => onNav("activity")}
          title="Activity"
        >
          <I.Activity size={16} />
        </button>
      </nav>
      <button
        type="button"
        className={`nav-btn${nav === "settings" ? " active" : ""}`}
        title="Settings"
        style={{ marginTop: "auto" }}
        onClick={() => onNav("settings")}
      >
        <I.Settings size={16} />
      </button>
      <div className="me" title="you">
        M
      </div>
    </aside>
  );
}
