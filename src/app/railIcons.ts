import type { JSX } from "react";
import { I, type IconProps } from "@/components/Icon";
import type { NavId } from "./nav";

/** Each page's rail glyph, shared by the rail and Settings → Sidebar. */
export const RAIL_ICONS: Record<NavId, (p: IconProps) => JSX.Element> = {
  inbox: I.Inbox,
  board: I.Board,
  pylon: I.Support,
  fleet: I.Fleet,
  sessions: I.Agents,
  scheduled: I.Clock,
  pr: I.PR,
  activity: I.Activity,
  integrations: I.Plug,
  settings: I.Settings,
};
