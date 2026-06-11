// What's being dragged on the Sessions page. HTML5 drag events can't carry
// typed payloads reliably across WKWebView, so sources record themselves here
// (same pattern as the board's draggingRef) and targets read it on drop.
export type SessionsDrag = { kind: "session" | "section" | "tab"; id: string };

export const sessionsDrag: { current: SessionsDrag | null } = { current: null };
