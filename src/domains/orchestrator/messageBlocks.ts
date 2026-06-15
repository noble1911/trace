// Splitting an assistant reply into renderable parts. The model can embed two
// kinds of fenced spec block in its markdown — ```chart (drawn from
// deterministic data) and ```action (a confirm-gated board mutation). Both ride
// on plain text, so they work in the SDK and CLI (-p) backends alike. The
// frontend owns what each block DOES; the model only ever supplies the spec.

export type MessagePart =
  | { type: "md"; text: string }
  | { type: "chart"; raw: string }
  | { type: "action"; raw: string };

/** Carve text into markdown runs and ```chart / ```action spec blocks. */
export function splitBlocks(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const m of text.matchAll(/```(chart|action)\s*\n([\s\S]*?)```/g)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ type: "md", text: text.slice(last, idx) });
    const raw = (m[2] ?? "").trim();
    if (m[1] === "action") parts.push({ type: "action", raw });
    else parts.push({ type: "chart", raw });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ type: "md", text: text.slice(last) });
  return parts;
}
