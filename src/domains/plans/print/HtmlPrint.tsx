import { useLayoutEffect, useRef, useState } from "react";
import { fallbackSrcDoc } from "./fallbackDoc";
import { fitToPaper, settle } from "./paperFit";
import { clearDocument, type Rendered, renderDocument } from "./renderDocument";

interface HtmlPrintProps {
  html: string;
  title: string;
  /** Called once the copy is laid out, its images and fonts in, and ready to print. */
  onReady: () => void;
}

// An HTML document's print copy: sanitised and rendered into the page itself
// (a shadow root, `renderDocument.ts`), so the print engine breaks it across
// pages like any other content. If that fails, it prints its text in a frame:
// whole, but plain, and nothing of the document is loaded.
export function HtmlPrint({ html, title, onReady }: HtmlPrintProps) {
  const host = useRef<HTMLDivElement>(null);
  const [inFrame, setInFrame] = useState(false);

  useLayoutEffect(() => {
    const el = host.current;
    if (inFrame || !el) return;
    let rendered: Rendered;
    try {
      rendered = renderDocument(el, html);
    } catch (e) {
      // The error's name only: a message could quote the document.
      console.warn(`Print copy falls back to a frame (${e instanceof Error ? e.name : "error"})`);
      setInFrame(true);
      return;
    }
    let live = true;
    void settle(rendered.root)
      .then(() => {
        if (live) fitToPaper(rendered);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) requestAnimationFrame(onReady);
      });
    return () => {
      live = false;
      clearDocument(rendered.root);
    };
  }, [html, inFrame, onReady]);

  if (inFrame) return <FramePrint html={html} title={title} onReady={onReady} />;
  // Inert: nothing in the copy can be clicked, focused or selected while it's in
  // the page, whatever the document's CSS says (a `visibility: visible` overlay).
  return <div ref={host} className="plan-print-doc" inert />;
}

// The fallback: a frame sized to its full height on load, showing the document's
// text only (`fallbackDoc.ts`). It is reached when the sanitiser threw, so the
// document is never passed on as HTML. Only this copy may be read from here
// (allow-same-origin) to measure it; scripts stay off (no allow-scripts).
function FramePrint({ html, title, onReady }: HtmlPrintProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const onLoad = () => {
    const el = frame.current;
    const height = el?.contentDocument?.documentElement.scrollHeight;
    if (el && height) el.style.height = `${height}px`;
    requestAnimationFrame(onReady);
  };
  return (
    <iframe
      ref={frame}
      className="plan-print-frame"
      sandbox="allow-same-origin"
      srcDoc={fallbackSrcDoc(html)}
      title={title}
      onLoad={onLoad}
    />
  );
}
