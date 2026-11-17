import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Typed wrappers around `commands/gallery.rs`: a workspace's Gallery sets, each
// set's images, and the `trace-img` address each image loads from (served only
// for files inside its set: `gallery::protocol`). Mirrors `gallery::scan`.

export interface GallerySet {
  id: string;
  title: string;
  /** The folders or files it shows, as the user reads them. */
  roots: string[];
  recursive: boolean;
  glob: string | null;
  createdAt: number;
}

export interface GalleryImage {
  path: string;
  name: string;
  /** Below its folder, `/`-separated. */
  rel: string;
  size: number;
  modified: number;
}

export interface Listing {
  images: GalleryImage[];
  tooLarge: number;
  truncated: boolean;
  missing: string[];
}

export type OpenHow = "open" | "reveal";

export function gallerySets(workspaceId: string): Promise<GallerySet[]> {
  return invoke("gallery_sets", { workspaceId });
}

export function galleryShow(
  workspaceId: string,
  paths: string[],
  opts: { title: string | null; recursive: boolean; glob: string | null }
): Promise<{ set: GallerySet; listing: Listing }> {
  return invoke("gallery_show", { workspaceId, paths, ...opts });
}

export function galleryList(workspaceId: string, setId: string): Promise<Listing> {
  return invoke("gallery_list", { workspaceId, setId });
}

export function galleryRemove(workspaceId: string, setId: string): Promise<void> {
  return invoke("gallery_remove", { workspaceId, setId });
}

export function galleryOpen(
  workspaceId: string,
  setId: string,
  path: string,
  how: OpenHow
): Promise<void> {
  return invoke("gallery_open", { workspaceId, setId, path, how });
}

/** UTF-8 → base64url without padding, as `gallery::protocol::token` reads it. */
function base64Url(text: string): string {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Where an image of a set loads from; `v` changes when the file does. */
export function imageSrc(workspaceId: string, setId: string, img: GalleryImage): string {
  const token = base64Url(JSON.stringify([workspaceId, setId, img.path]));
  return `${convertFileSrc(token, "trace-img")}?v=${img.modified}-${img.size}`;
}

/**
 * Where an image an agent's chat reply names loads from (`gallery::inline`): an absolute
 * path (or `~/…`), no set needed. `v` makes a remount fetch the file as it is now, since
 * agents often rewrite the same preview.
 */
export function inlineImageSrc(path: string, v: number): string {
  const token = base64Url(JSON.stringify({ file: path }));
  return `${convertFileSrc(token, "trace-img")}?v=${v}`;
}

/** A workspace's sets changed backend-side (an agent showed images). */
export function onGallerySets(cb: (p: { workspaceId: string }) => void): Promise<UnlistenFn> {
  return listen<{ workspaceId: string }>("gallery-sets", (e) => cb(e.payload));
}
