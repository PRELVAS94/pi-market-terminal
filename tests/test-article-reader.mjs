import { base, r, j } from "./runtime.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { extractFedRelease, isFedRelease, createArticleReader } = await j.import(
  "../article-reader.ts",
);
const html =
  '<div id="article"><div class="col-xs-12 col-sm-8 col-md-8"><p>' +
  "Official economic announcement &amp; data. ".repeat(8) +
  '</p><ul><li>Key finding &#8212; growth.</li></ul><script>bad()</script><div class="panel panel-attachments">excluded';
const text = extractFedRelease(html);
assert.ok(text.includes("& data"));
assert.ok(text.includes("— growth"));
assert.ok(!text.includes("bad()"));
assert.ok(!text.includes("excluded"));
assert.throws(() => extractFedRelease("<html>blocked</html>"));
assert.ok(
  isFedRelease(
    "https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm",
  ),
);
for (const u of [
  "http://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm",
  "https://evil.com/story",
  "https://www.federalreserve.gov.evil.com/story",
])
  assert.ok(!isFedRelease(u));
const original = globalThis.fetch;
let count = 0;
globalThis.fetch = async () => {
  count++;
  return { ok: true, text: async () => html };
};
try {
  const read = createArticleReader(),
    url =
      "https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm";
  await read(url, new AbortController().signal);
  await read(url, new AbortController().signal);
  assert.equal(count, 1);
  await assert.rejects(() =>
    read("https://evil.com", new AbortController().signal),
  );
} finally {
  globalThis.fetch = original;
}
console.log(
  "PASS: full release extraction, paragraphs, entities, script removal, source allowlist and cache",
);
const {
  extractCnbcArticle,
  elementByClass,
  isCnbcArticle,
  createDetailedArticleReader,
} = await j.import("../article-reader.ts");
const cnbc =
  '<script>window.__s_data={"premium":false}</script><div class="RenderKeyPoints-keyPoints"><div><ul><li>Publisher observation &amp; context</li></ul></div></div><div class="ArticleBody-articleBody"><div class="group"><p>' +
  "Public article paragraph &#x27; ".repeat(8) +
  '</p></div><div class="widget">Unrelated promo</div></div>';
assert.ok(
  elementByClass(cnbc, "ArticleBody-articleBody").includes("Public article"),
);
const detail = extractCnbcArticle(cnbc);
assert.equal(detail.points[0], "Publisher observation & context");
assert.ok(!detail.body.includes("Unrelated promo"));
assert.ok(detail.body.includes("'"));
assert.throws(() =>
  extractCnbcArticle(cnbc.replace('"premium":false', '"premium":true')),
);
assert.throws(() =>
  extractCnbcArticle(cnbc + '<script>{"isAccessibleForFree":false}</script>'),
);
assert.ok(isCnbcArticle("https://www.cnbc.com/2026/10/16/markets.html"));
assert.ok(
  !isCnbcArticle("https://www.cnbc.com.evil.com/2026/10/16/story.html"),
);
const savedFetch = globalThis.fetch;
let detailCalls = 0;
globalThis.fetch = async () => {
  detailCalls++;
  return { ok: true, text: async () => cnbc };
};
try {
  const read = createDetailedArticleReader(),
    url = "https://www.cnbc.com/2026/10/16/markets.html";
  assert.equal(
    (await read(url, new AbortController().signal)).points.length,
    1,
  );
  await read(url, new AbortController().signal);
  assert.equal(detailCalls, 1);
} finally {
  globalThis.fetch = savedFetch;
}
console.log(
  "PASS: CNBC public text, publisher Key Points, premium rejection, source allowlist and detailed article cache",
);
