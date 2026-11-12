import { Base, type IconProps } from "./iconBase";

// The app's places and the things it names (pages, panels, status), part of `I`
// (Icon.tsx). One meaning per glyph: see the glyph table in the trace-ui skill.

/** The shield outline the permission glyphs share. */
const SHIELD =
  "M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z";

export const NAV_ICONS = {
  Board: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="7" height="18" rx="1.5" />
      <rect x="14" y="3" width="7" height="12" rx="1.5" />
    </Base>
  ),
  /** Boards made in trace (square-kanban): the Boards page. Not `Board`, a tracker's. */
  Kanban: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7v7M12 7v4M16 7v9" />
    </Base>
  ),
  Agents: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="8" r="3" />
      <path d="M3 20c0-2.8 2.7-5 6-5s6 2.2 6 5" />
      <path d="M14 20c0-2.8 2.7-5 6-5" />
    </Base>
  ),
  /** Integrations, connecting a service. */
  Plug: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </Base>
  ),
  Support: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <path d="m4.93 4.93 4.24 4.24" />
      <path d="m14.83 9.17 4.24-4.24" />
      <path d="m14.83 14.83 4.24 4.24" />
      <path d="m9.17 14.83-4.24 4.24" />
    </Base>
  ),
  Activity: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 12h-4l-3 9-6-18-3 9H2" />
    </Base>
  ),
  Settings: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Base>
  ),
  /** An agent's model and effort, as one setting (sliders-horizontal). Not Settings (the page). */
  Sliders: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3" />
      <path d="M14 2v4M8 10v4M16 18v4" />
    </Base>
  ),
  Inbox: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Base>
  ),
  Fleet: (p: IconProps) => (
    <Base {...p}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </Base>
  ),
  Clock: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  ),
  Search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  ),
  Keyboard: (p: IconProps) => (
    <Base {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </Base>
  ),
  /** A window with a right-hand panel — the universal "toggle sidebar" glyph. */
  Sidebar: (p: IconProps) => (
    <Base {...p}>
      <rect width="18" height="16" x="3" y="4" rx="2" />
      <path d="M15 4v16" />
    </Base>
  ),
  /** Open beside: a pane split down the middle. */
  SplitRight: (p: IconProps) => (
    <Base {...p}>
      <rect width="18" height="16" x="3" y="4" rx="2" />
      <path d="M12 4v16" />
    </Base>
  ),
  /** Expand, disclose, forward: rotate it for the other directions. */
  Chevron: (p: IconProps) => (
    <Base {...p}>
      <path d="m9 18 6-6-6-6" />
    </Base>
  ),
  /** Back navigation only. */
  Back: (p: IconProps) => (
    <Base {...p}>
      <path d="m15 18-6-6 6-6" />
    </Base>
  ),
  /** The ⋯ menu: more actions. */
  More: (p: IconProps) => (
    <Base {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Base>
  ),
  /** AI, the assistant. */
  Sparkles: (p: IconProps) => (
    <Base {...p}>
      <path d="m12 3-1.9 5.6L4.5 10.5l5.6 1.9L12 18l1.9-5.6 5.6-1.9-5.6-1.9z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </Base>
  ),
  Chat: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Base>
  ),
  Ticket: (p: IconProps) => (
    <Base {...p}>
      <path d="M2 9V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4Z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </Base>
  ),
  /** A warning (triangle-alert). */
  Alert: (p: IconProps) => (
    <Base {...p}>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </Base>
  ),
  /** An agent asking permission to use a tool (shield). */
  Shield: (p: IconProps) => (
    <Base {...p}>
      <path d={SHIELD} />
    </Base>
  ),
  /** Full access: an agent that runs everything without asking (shield-alert). */
  ShieldAlert: (p: IconProps) => (
    <Base {...p}>
      <path d={SHIELD} />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Base>
  ),
  /** Auto mode: an agent whose permissions are checked for it (shield-check). */
  ShieldCheck: (p: IconProps) => (
    <Base {...p}>
      <path d={SHIELD} />
      <path d="m9 12 2 2 4-4" />
    </Base>
  ),
  /** Ask mode: an agent that asks before it edits or runs (a raised hand). */
  Hand: (p: IconProps) => (
    <Base {...p}>
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Base>
  ),
  /** Started by another agent (corner-down-right). */
  StartedBy: (p: IconProps) => (
    <Base {...p}>
      <path d="m15 10 5 5-5 5" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </Base>
  ),
  /** GitHub (the mark, stroked): signing in with GitHub. */
  GitHub: (p: IconProps) => (
    <Base {...p}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </Base>
  ),
  /** A credential: signing in with a token. */
  Key: (p: IconProps) => (
    <Base {...p}>
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </Base>
  ),
};
