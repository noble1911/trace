// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepLocalImages, localImagePath } from "./imagePath.ts";

describe("localImagePath", () => {
  const root = "/Users/me/repo";

  it("reads the three ways an agent writes a local image", () => {
    // Angle brackets reach here as the bare path, spaces and all.
    assert.equal(
      localImagePath("/Users/me/previews/My File.png", root),
      "/Users/me/previews/My File.png"
    );
    assert.equal(
      localImagePath("/Users/me/previews/example.png", root),
      "/Users/me/previews/example.png"
    );
    assert.equal(
      localImagePath("file:///Users/me/previews/My%20File.png", root),
      "/Users/me/previews/My File.png"
    );
  });

  it("resolves relative paths against the workspace and keeps ~ for the backend", () => {
    assert.equal(localImagePath("previews/a.png", root), "/Users/me/repo/previews/a.png");
    assert.equal(localImagePath("./a.png", root), "/Users/me/repo/a.png");
    assert.equal(localImagePath("~/Desktop/a.png", root), "~/Desktop/a.png");
  });

  it("handles Windows paths", () => {
    assert.equal(localImagePath("C:\\out\\a.png", null), "C:\\out\\a.png");
    assert.equal(localImagePath("file:///C:/out/a%20b.png", null), "C:/out/a b.png");
  });

  it("leaves remote and inline images alone", () => {
    assert.equal(localImagePath("https://example.com/a.png", root), null);
    assert.equal(localImagePath("data:image/png;base64,AAAA", root), null);
    assert.equal(localImagePath("//cdn.example.com/a.png", root), null);
    assert.equal(localImagePath("file://server/share/a.png", root), null);
    assert.equal(localImagePath("  ", root), null);
  });
});

describe("keepLocalImages", () => {
  const dropped = () => "";
  const keep = keepLocalImages(dropped);
  it("keeps file URLs and drive paths only on an image's src", () => {
    assert.equal(keep("file:///a.png", "src", { tagName: "img" }), "file:///a.png");
    assert.equal(keep("C:\\a.png", "src", { tagName: "img" }), "C:\\a.png");
    assert.equal(keep("file:///a.png", "href", { tagName: "a" }), "");
    assert.equal(keep("javascript:alert(1)", "src", { tagName: "img" }), "");
  });
});
