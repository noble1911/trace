import type { MouseEvent } from "react";
import { openCreator } from "@/app/openWorkspace";
import { I } from "@/components/Icon";
import { creatorKind, creatorLabel } from "./createdBy";
import type { CreatedBy } from "./types";

interface CreatorChipProps {
  createdBy: CreatedBy;
  /** "row": a quiet "by …" in a list row; "detail": "Started by …" in a header. */
  variant?: "row" | "detail";
}

// Who started a session that you didn't: a link to the parent session, ticket
// or scheduled prompt (the orchestrator and another computer have nothing to open
// here, so they're plain text).
// The label is the parent's name when the session was made, so it still reads
// after the parent is renamed or deleted; opening a gone parent says so.
export function CreatorChip({ createdBy, variant = "row" }: CreatorChipProps) {
  if (createdBy.kind === "user") return null;
  const label = creatorLabel(createdBy);
  const lead = variant === "detail" ? "Started by" : "by";
  const className = `creator-chip ${variant === "detail" ? "in-header" : "in-row"}`;
  if (createdBy.kind === "orchestrator" || createdBy.kind === "peer") {
    const why =
      createdBy.kind === "peer"
        ? `Started from ${label}, another computer running trace. It runs here, so you can carry on with it.`
        : "Started by the orchestrator";
    return (
      <span className={className} title={why}>
        <I.StartedBy size={12} /> {lead} {label}
      </span>
    );
  }
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    openCreator(createdBy);
  };
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      onKeyDown={(e) => e.stopPropagation()}
      title={`Started by ${creatorKind(createdBy).toLowerCase()} “${label}” — open it`}
    >
      <I.StartedBy size={12} /> {lead} <span className="creator-name">{label}</span>
    </button>
  );
}
