import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackSrcDoc, plainText } from "./fallbackDoc.ts";

const REMOTE = `<html><head><link rel="stylesheet" href="https://evil.test/a.css">
<style>@import url(https://evil.test/b.css); body{background:url(https://evil.test/c.png)}</style>
<script>fetch("https://evil.test/s")</script></head>
<body style="background:url(https://evil.test/d.png)"><h1>Plan</h1>
<img src="https://evil.test/e.png"><p>Use &lt;b&gt; &amp; more</p>
<svg><image href="https://evil.test/f.png"/></svg><!-- https://evil.test/g --></body></html>`;

describe("the print fallback frame", () => {
  it("carries no remote URL and no markup from the document", () => {
    const doc = fallbackSrcDoc(REMOTE);
    assert.equal(doc.includes("evil.test"), false);
    assert.equal(/<(img|link|script|svg|style|h1)/i.test(doc), false);
    assert.match(doc, /Plan/);
  });

  it("keeps the text and escapes it, even if it decodes to markup", () => {
    const doc = fallbackSrcDoc("<p>Use &lt;img src=https://evil.test/x&gt; &amp; more</p>");
    assert.equal(doc.includes("<img"), false);
    assert.match(doc, /&lt;img src=https:\/\/evil\.test\/x&gt; &amp; more/);
  });

  it("drops unterminated tags and comments rather than leaking them", () => {
    assert.equal(plainText("hi <img src=https://evil.test/x"), "hi");
    assert.equal(plainText("hi <!-- <img src=https://evil.test/x>"), "hi");
    assert.equal(plainText("hi <script>https://evil.test"), "hi");
  });

  it("denies every fetch by policy", () => {
    assert.match(fallbackSrcDoc("x"), /default-src 'none'/);
  });
});
