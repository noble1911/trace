import { resolvePath } from "./chatContext.ts";

// Where an image in an agent's reply (`![Preview](…)`) lives on disk, so it can load
// through `trace-img` (`gallery::inline`): the webview can't load a local path or a
// `file://` URL itself. Remote and `data:` images aren't local and load as they are.

const DRIVE = /^[a-zA-Z]:[\\/]/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** The local path an image's `src` names, or null when it isn't a local file. */
export function localImagePath(src: string, root: string | null): string | null {
  const s = src.trim();
  if (!s) return null;
  if (DRIVE.test(s)) return s;
  if (/^file:/i.test(s)) return fileUrlPath(s);
  if (SCHEME.test(s) || s.startsWith("//")) return null;
  if (s === "~" || s.startsWith("~/")) return s;
  return resolvePath(s, root);
}

/** `file:///a/My%20File.png` → `/a/My File.png` (`file:///C:/x.png` → `C:/x.png`). */
function fileUrlPath(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  // A file on another machine (`file://server/share/…`) isn't one trace can read.
  if (url.host && url.host !== "localhost") return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  return /^\/[a-zA-Z]:\//.test(path) ? path.slice(1) : path;
}

/**
 * react-markdown's URL filter, for agent prose: an image's `src` keeps a `file:` URL or a
 * drive path (the default drops both, leaving an empty `src`); everything else gets the
 * default (`defaultUrlTransform`, passed in so this stays free of the renderer).
 */
export function keepLocalImages(fallback: (url: string) => string) {
  return (url: string, key: string, node: { tagName?: string }): string => {
    if (key === "src" && node.tagName === "img" && (/^file:/i.test(url) || DRIVE.test(url))) {
      return url;
    }
    return fallback(url);
  };
}
