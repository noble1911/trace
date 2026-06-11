// Jira reports an epic's colour as an opaque palette key ("color_1" …
// "color_14") on the issue's epic field — the API never exposes hex values.
// Map the keys to hues approximating Jira's palette families; epics without
// a key (team-managed parents) get a stable hue hashed from the epic key, so
// every epic still reads as a distinct colour. Lightness/chroma match the
// app's status hues (same approach as AgentAvatar's hueColor).

const KEY_HUE: Record<string, number> = {
  color_1: 290, // purple
  color_2: 250, // blue
  color_3: 155, // green
  color_4: 200, // teal
  color_5: 90, // yellow
  color_6: 55, // orange
  color_8: 310, // dark purple
  color_9: 230, // dark blue
  color_10: 170, // dark green
  color_11: 120, // lime
  color_12: 30, // red
  color_13: 350, // magenta
  color_14: 270, // violet
};

function hashHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** CSS colour for an epic chip (chip-friendly oklch). */
export function epicColor(
  epicKey: string | null | undefined,
  colorKey: string | null | undefined
): string {
  if (colorKey === "color_7") return "oklch(0.72 0.02 250)"; // Jira's grey
  const hue = (colorKey ? KEY_HUE[colorKey] : undefined) ?? hashHue(epicKey ?? "epic");
  return `oklch(0.72 0.13 ${hue})`;
}
