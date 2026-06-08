import type { CSSProperties, ReactNode } from "react";

// Minimal Lucide-style stroked icons, 16x16 by default. Ported from the design's icons.jsx.

export interface IconProps {
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}

interface BaseProps extends IconProps {
  children: ReactNode;
}

function Base({ size = 16, stroke = 1.6, children, style }: BaseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const I = {
  Board: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="7" height="18" rx="1.5" />
      <rect x="14" y="3" width="7" height="12" rx="1.5" />
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
  PR: (p: IconProps) => (
    <Base {...p}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M6 7v10" />
      <path d="M18 11V9a4 4 0 0 0-4-4h-3" />
      <path d="m14 8-3-3 3-3" />
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
  Search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  ),
  Plus: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  ),
  Send: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </Base>
  ),
  X: (p: IconProps) => (
    <Base {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Base>
  ),
  Sparkles: (p: IconProps) => (
    <Base {...p}>
      <path d="m12 3-1.9 5.6L4.5 10.5l5.6 1.9L12 18l1.9-5.6 5.6-1.9-5.6-1.9z" />
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
    </Base>
  ),
  Chevron: (p: IconProps) => (
    <Base {...p}>
      <path d="m9 18 6-6-6-6" />
    </Base>
  ),
  Back: (p: IconProps) => (
    <Base {...p}>
      <path d="m15 18-6-6 6-6" />
    </Base>
  ),
  Archive: (p: IconProps) => (
    <Base {...p}>
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </Base>
  ),
  Chat: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Base>
  ),
  Code: (p: IconProps) => (
    <Base {...p}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Base>
  ),
  Terminal: (p: IconProps) => (
    <Base {...p}>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </Base>
  ),
  Beaker: (p: IconProps) => (
    <Base {...p}>
      <path d="M4.5 3h15" />
      <path d="M6 3v8a6 6 0 0 0 12 0V3" />
      <path d="M6 14h12" />
    </Base>
  ),
  GitPR: (p: IconProps) => (
    <Base {...p}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M6 8v8" />
      <path d="M11 6h4a3 3 0 0 1 3 3v7" />
      <path d="m14 9 3-3-3-3" />
    </Base>
  ),
  Ticket: (p: IconProps) => (
    <Base {...p}>
      <path d="M2 9V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 0 0 4v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4Z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="m20 6-11 11-5-5" />
    </Base>
  ),
  Dot3: (p: IconProps) => (
    <Base {...p}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </Base>
  ),
  Branch: (p: IconProps) => (
    <Base {...p}>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Base>
  ),
  File: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </Base>
  ),
  Clock: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  ),
  Filter: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 6h18M7 12h10M10 18h4" />
    </Base>
  ),
  Bolt: (p: IconProps) => (
    <Base {...p}>
      <path d="M13 2 3 14h8l-1 8 10-12h-8z" />
    </Base>
  ),
};
