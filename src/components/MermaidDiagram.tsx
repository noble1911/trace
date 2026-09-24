import { useEffect, useId, useState } from "react";

// A ```mermaid block drawn as a diagram, the way GitHub shows it. mermaid is
// ~1MB, so it's imported on first use (its own chunk) rather than shipped in
// the main bundle for the few comments that carry a diagram.

let ready: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  ready ??= import("mermaid").then(({ default: mermaid }) => {
    // "strict": no click handlers or HTML labels — the source is untrusted
    // (a PR comment), and strict makes mermaid sanitize its own output.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
    return mermaid;
  });
  return ready;
}

/** Render mermaid source; falls back to the source as code if it doesn't parse. */
export function MermaidDiagram({ source }: { source: string }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(id, source))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (failed || svg === null) {
    return (
      <pre className={failed ? undefined : "mermaid-pending"}>
        <code>{source}</code>
      </pre>
    );
  }
  // mermaid's strict mode sanitizes the SVG it generates.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by mermaid (securityLevel "strict")
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
