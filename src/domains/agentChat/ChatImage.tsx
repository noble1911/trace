import { useState } from "react";
import { I } from "@/components/Icon";
import { ICON_SIZE } from "@/components/iconScale";
import { FileLink } from "@/domains/transcript/FileLink";
import { inlineImageSrc } from "@/ipc/gallery";
import { useChatView } from "./chatContext";
import { localImagePath } from "./imagePath";

interface ChatImageProps {
  src?: string;
  alt?: string;
}

// An image in an agent's reply. A local one (a path, `~/…` or `file://`) loads through
// `trace-img`, which serves image files only; a remote one loads as it is. One that
// can't be shown says so and names its file, rather than a broken "?" box.
export function ChatImage({ src, alt }: ChatImageProps) {
  const { workspaceId, root } = useChatView();
  // Fixed per mount: a remount shows the file as it is now (agents rewrite previews).
  const [loadedAt] = useState(() => Date.now());
  const [broken, setBroken] = useState(false);
  const path = src ? localImagePath(src, root) : null;
  const url = path ? inlineImageSrc(path, loadedAt) : src;
  if (!url || broken) {
    return (
      <span className="ac-img-missing">
        <I.Alert size={ICON_SIZE.xs} />
        <span>Couldn't show {alt?.trim() ? `"${alt.trim()}"` : "this image"}</span>
        {path && <FileLink workspaceId={workspaceId} path={path} root={root} />}
      </span>
    );
  }
  return (
    <img
      className="ac-img"
      src={url}
      alt={alt ?? ""}
      title={alt || undefined}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
